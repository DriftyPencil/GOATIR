"""Run generated challenge validation locally or in an isolated Modal sandbox."""

import asyncio
import time

from vault.challenge_worker import ChallengeValidationInput, validate_challenge
from vault.config import Settings
from vault.models import EvalReport, GeneratedChallenge


async def _run_modal(payload: ChallengeValidationInput, settings: Settings) -> EvalReport:
    import modal

    sandbox = None
    started = time.monotonic()
    try:
        client = None
        if settings.modal_token_id and settings.modal_token_secret.get_secret_value():
            client = await modal.Client.from_credentials.aio(
                settings.modal_token_id, settings.modal_token_secret.get_secret_value()
            )
        app = await modal.App.lookup.aio(
            "evolving-vault-evaluations", create_if_missing=True, client=client
        )
        image = (
            modal.Image.debian_slim(python_version="3.12")
            .pip_install("pydantic>=2.10,<3")
            .add_local_python_source("vault")
        )
        sandbox = await modal.Sandbox.create.aio(
            "python",
            "-m",
            "vault.challenge_worker",
            app=app,
            client=client,
            image=image,
            env={"VAULT_CHALLENGE_BACKEND": "modal"},
            timeout=payload.timeout_seconds + 15,
            cpu=0.25,
            memory=256,
            block_network=True,
        )
        sandbox.stdin.write(payload.model_dump_json().encode())
        sandbox.stdin.write_eof()
        await sandbox.stdin.drain.aio()
        stdout = await sandbox.stdout.read.aio()
        await sandbox.wait.aio()
        if sandbox.returncode != 0:
            raise RuntimeError("Challenge worker exited unsuccessfully")
        report = EvalReport.model_validate_json(stdout)
        if report.backend != "modal":
            raise ValueError("Unexpected challenge validation backend")
        return report.model_copy(
            update={
                "sandbox_id": sandbox.object_id,
                "duration_ms": round((time.monotonic() - started) * 1000),
            }
        )
    except Exception as exc:
        return EvalReport(
            backend="modal",
            passed=False,
            cases=[],
            duration_ms=round((time.monotonic() - started) * 1000),
            sandbox_id=getattr(sandbox, "object_id", None),
            error=f"Modal challenge validation failed ({type(exc).__name__}).",
        )
    finally:
        if sandbox is not None:
            for operation in (sandbox.terminate, sandbox.detach):
                try:
                    await asyncio.wait_for(operation.aio(), timeout=10)
                except Exception:
                    pass


async def evaluate_generated_challenge(
    challenge: GeneratedChallenge,
    settings: Settings,
    vulnerable_required: list[str] | None = None,
    patched_required: list[str] | None = None,
) -> EvalReport:
    payload = ChallengeValidationInput(
        challenge=challenge,
        vulnerable_required=vulnerable_required or [],
        patched_required=patched_required or [],
        backend=settings.eval_backend,
        timeout_seconds=max(1, min(settings.agent_timeout_seconds, 120)),
    )
    if settings.eval_backend == "modal":
        return await _run_modal(payload, settings)
    return await validate_challenge(payload)
