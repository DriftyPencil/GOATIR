"""Candidate patch evaluation with explicit local and Modal execution backends."""

import asyncio
import time

from vault.config import Settings
from vault.eval_worker import EvalInput, run_evaluation
from vault.models import Defense, EvalReport

MODAL_STARTUP_TIMEOUT_SECONDS = 180
MODAL_CLEANUP_TIMEOUT_SECONDS = 10


async def _run_modal(payload: EvalInput, settings: Settings) -> EvalReport:
    sandbox = None
    report = None
    started = time.monotonic()
    try:
        import modal

        async with asyncio.timeout(MODAL_STARTUP_TIMEOUT_SECONDS + payload.timeout_seconds + 15):
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
                .pip_install(
                    "pydantic-ai-slim[google]>=1.0,<2",
                    "pydantic>=2.10,<3",
                    "pydantic-settings>=2.7,<3",
                )
                .add_local_python_source("vault")
            )
            key = settings.gemini_api_key.get_secret_value()
            secrets = [modal.Secret.from_dict({"GEMINI_API_KEY": key})] if key else []
            sandbox = await modal.Sandbox.create.aio(
                "python", "-m", "vault.eval_worker",
                app=app,
                client=client,
                image=image,
                secrets=secrets,
                env={"VAULT_EVAL_BACKEND": "modal"},
                timeout=payload.timeout_seconds + 30,
                cpu=1,
                memory=512,
                block_network=payload.mode == "demo",
            )
            # Neither API credentials nor the game secret appear in a command line.
            sandbox.stdin.write(payload.model_dump_json().encode())
            sandbox.stdin.write_eof()
            await sandbox.stdin.drain.aio()
            stdout = await sandbox.stdout.read.aio()
            await sandbox.wait.aio()
            if sandbox.returncode != 0:
                raise RuntimeError("Evaluation worker exited unsuccessfully")
            report = EvalReport.model_validate_json(stdout)
            if report.backend != "modal":
                raise ValueError("Unexpected evaluation backend")
            if report.passed and (
                report.error or not report.cases or not all(case.passed for case in report.cases)
            ):
                raise ValueError("Inconsistent evaluation report")
            report = report.model_copy(
                update={
                    "sandbox_id": sandbox.object_id,
                    "duration_ms": round((time.monotonic() - started) * 1000),
                }
            )
    except Exception as exc:
        # Never downgrade a failed cloud check to a passing local run.
        report = EvalReport(
            backend="modal",
            passed=False,
            cases=[],
            duration_ms=round((time.monotonic() - started) * 1000),
            sandbox_id=getattr(sandbox, "object_id", None),
            error=(
                f"Modal evaluation failed ({type(exc).__name__}). "
                "Check Modal authentication, connectivity and sandbox availability."
            ),
        )
    finally:
        if sandbox is not None:
            cleanup_failed = False
            for operation in (sandbox.terminate, sandbox.detach):
                try:
                    await asyncio.wait_for(
                        operation.aio(), timeout=MODAL_CLEANUP_TIMEOUT_SECONDS
                    )
                except Exception:
                    cleanup_failed = True
            if cleanup_failed and report is not None:
                report = report.model_copy(update={
                    "passed": False,
                    "error": "Modal sandbox cleanup could not be confirmed; patch rejected.",
                })
    return report


async def evaluate_patch(
    *, secret: str, defenses: list[Defense], attack: str, mode: str, settings: Settings
) -> EvalReport:
    """A patch is adoptable only if every regression and helpfulness check passes."""
    started = time.monotonic()
    try:
        payload = EvalInput(
            secret=secret,
            defenses=defenses,
            attack=attack,
            mode=mode,
            model_name=settings.gemini_model,
            timeout_seconds=max(1, min(settings.agent_timeout_seconds, 120)),
            backend=settings.eval_backend,
        )
        if settings.eval_backend == "modal":
            return await _run_modal(payload, settings)
        return await run_evaluation(payload, api_key=settings.gemini_api_key.get_secret_value())
    except Exception as exc:
        return EvalReport(
            backend=settings.eval_backend,
            passed=False,
            cases=[],
            duration_ms=round((time.monotonic() - started) * 1000),
            error=f"Evaluation could not complete ({type(exc).__name__}).",
        )
