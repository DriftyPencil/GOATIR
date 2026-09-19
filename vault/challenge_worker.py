"""Validate AI-authored challenge code inside a constrained worker.

The code is parsed and compiled, then inspected for dangerous primitives. It is never
imported into the web process. Modal runs this worker with networking blocked.
"""

import ast
import os
import sys
import time
from typing import Literal

from pydantic import BaseModel, Field

from vault.models import EvalCase, EvalReport, GeneratedChallenge


class ChallengeValidationInput(BaseModel):
    challenge: GeneratedChallenge
    vulnerable_required: list[str] = Field(default_factory=list, max_length=20)
    patched_required: list[str] = Field(default_factory=list, max_length=20)
    backend: Literal["local", "modal"] = "local"
    timeout_seconds: int = Field(default=30, ge=1, le=120)


BANNED_NAMES = {
    "__import__",
    "compile",
    "eval",
    "exec",
    "open",
    "os",
    "pathlib",
    "requests",
    "socket",
    "subprocess",
}


def _inspect(label: str, code: str) -> list[EvalCase]:
    cases: list[EvalCase] = []
    try:
        tree = ast.parse(code)
        compile(tree, f"<{label}>", "exec")
        cases.append(EvalCase(name=f"{label} compiles", passed=True, detail="Valid Python syntax."))
    except SyntaxError:
        return [
            EvalCase(
                name=f"{label} compiles", passed=False, detail="Generated code is not valid Python."
            )
        ]

    dangerous = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            dangerous.append("imports")
        if isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            dangerous.append(node.id)
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            dangerous.append("dunder access")
    cases.append(
        EvalCase(
            name=f"{label} stays inside the game boundary",
            passed=not dangerous,
            detail="No file, process, import, network, or dynamic-execution primitives found."
            if not dangerous
            else "Unsafe primitives found; generated level rejected.",
        )
    )
    return cases


async def validate_challenge(payload: ChallengeValidationInput) -> EvalReport:
    started = time.monotonic()
    challenge = payload.challenge
    cases = [
        *_inspect("Vulnerable build", challenge.vulnerable_code),
        *_inspect("Secure patch", challenge.patched_code),
        EvalCase(
            name="Patch changes the implementation",
            passed=challenge.vulnerable_code.strip() != challenge.patched_code.strip(),
            detail="The secure version differs from the vulnerable version.",
        ),
        EvalCase(
            name="Synthetic secret is not embedded",
            passed="SIMPLY{" not in challenge.model_dump_json(),
            detail="No session flag was written into generated source.",
        ),
    ]
    for label, code, tokens in (
        ("Vulnerable build", challenge.vulnerable_code, payload.vulnerable_required),
        ("Secure patch", challenge.patched_code, payload.patched_required),
    ):
        cases.append(
            EvalCase(
                name=f"{label} matches the playable mechanic",
                passed=all(token in code for token in tokens),
                detail="Required route and behavior tokens are present."
                if all(token in code for token in tokens)
                else "Generated code drifted away from the playable challenge contract.",
            )
        )
    return EvalReport(
        backend=payload.backend,
        passed=all(case.passed for case in cases),
        cases=cases,
        duration_ms=round((time.monotonic() - started) * 1000),
    )


def main() -> None:
    try:
        raw = sys.stdin.read(131_073)
        if len(raw) > 131_072:
            raise ValueError("Challenge input too large")
        payload = ChallengeValidationInput.model_validate_json(raw)
        import asyncio

        report = asyncio.run(validate_challenge(payload))
    except Exception as exc:
        report = EvalReport(
            backend="modal" if os.environ.get("VAULT_CHALLENGE_BACKEND") == "modal" else "local",
            passed=False,
            cases=[],
            duration_ms=0,
            error=f"Challenge validation failed ({type(exc).__name__}).",
        )
    sys.stdout.write(report.model_dump_json() + "\n")


if __name__ == "__main__":
    main()
