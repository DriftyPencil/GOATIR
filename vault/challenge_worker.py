"""Validate AI-authored challenge code inside a constrained worker.

The code is parsed and compiled, then inspected for dangerous primitives. It is never
imported into the web process. Modal runs this worker with networking blocked.
"""

import ast
import os
import sys
import time
from pathlib import PurePosixPath
from typing import Literal

from pydantic import BaseModel, Field

from vault.models import CodebaseFile, EvalCase, EvalReport, GeneratedChallenge


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

SAFE_IMPORT_ROOTS = {
    "base64",
    "fastapi",
    "hashlib",
    "hmac",
    "json",
    "logging",
    "pydantic",
    "typing",
}


def _inspect(label: str, code: str) -> list[EvalCase]:
    try:
        tree = ast.parse(code)
        compile(tree, f"<{label}>", "exec")
    except (SyntaxError, ValueError, RecursionError):
        return [
            EvalCase(
                name=f"{label} compiles",
                passed=False,
                detail="Generated source could not be parsed or compiled.",
            )
        ]

    dangerous: set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".", 1)[0] not in SAFE_IMPORT_ROOTS:
                    dangerous.add("disallowed import")

        elif isinstance(node, ast.ImportFrom):
            if (
                node.level != 0
                or node.module is None
                or node.module.split(".", 1)[0] not in SAFE_IMPORT_ROOTS
                or any(alias.name == "*" for alias in node.names)
            ):
                dangerous.add("disallowed import")

        elif isinstance(node, ast.Name):
            if node.id in BANNED_NAMES or node.id.startswith("__"):
                dangerous.add("disallowed name")

        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__"):
                dangerous.add("dunder access")

    return [
        EvalCase(
            name=f"{label} compiles",
            passed=True,
            detail="Valid Python syntax; runtime behavior has not been tested.",
        ),
        EvalCase(
            name=f"{label} passes static source policy",
            passed=not dangerous,
            detail=(
                "No prohibited syntax patterns detected. "
                "This check does not establish safe execution."
                if not dangerous
                else "Prohibited syntax patterns detected; revision rejected."
            ),
        ),
    ]

def _declares_endpoint(
    files: list[CodebaseFile], method: str, path: str
) -> bool:
    app_file = next((file for file in files if file.path == "app.py"), None)
    if app_file is None:
        return False

    try:
        tree = ast.parse(app_file.content)
    except (SyntaxError, ValueError, RecursionError):
        return False

    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue

        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue

            function = decorator.func
            if not (
                isinstance(function, ast.Attribute)
                and isinstance(function.value, ast.Name)
                and function.value.id == "app"
                and function.attr == method.lower()
            ):
                continue

            route = decorator.args[0] if decorator.args else next(
                (
                    keyword.value
                    for keyword in decorator.keywords
                    if keyword.arg == "path"
                ),
                None,
            )
            if isinstance(route, ast.Constant) and route.value == path:
                return True

    return False

def _safe_source_path(path: str) -> bool:
    if (
        not path
        or "\\" in path
        or ":" in path
        or any(ord(char) < 32 or ord(char) == 127 for char in path)
    ):
        return False

    parsed = PurePosixPath(path)
    return (
        not parsed.is_absolute()
        and all(part not in {"", ".", ".."} for part in path.split("/"))
        and str(parsed) == path
    )


def _inspect_codebase(label: str, files: list[CodebaseFile]) -> list[EvalCase]:
    paths = [file.path for file in files]
    required = {"app.py", "web/index.html", "README.md"}

    valid = (
        3 <= len(files) <= 4
        and all(_safe_source_path(path) for path in paths)
        and len(set(paths)) == len(paths)
        and required.issubset(paths)
    )

    cases = [
        EvalCase(
            name=f"{label} has a valid file manifest",
            passed=valid,
            detail=(
                "Required files exist at unique, canonical relative paths."
                if valid
                else "Missing required files, duplicate paths, or unsafe paths."
            ),
        )
    ]

    for file in files:
        if file.path.endswith(".py"):
            cases.extend(_inspect(f"{label}: {file.path}", file.content))

    return cases


async def validate_challenge(payload: ChallengeValidationInput) -> EvalReport:
    started = time.monotonic()
    challenge = payload.challenge

    vulnerable_python = {
        file.path: file.content.strip()
        for file in challenge.vulnerable_files
        if file.path.endswith(".py")
    }
    patched_python = {
        file.path: file.content.strip()
        for file in challenge.patched_files
        if file.path.endswith(".py")
    }
    implementation_changed = vulnerable_python != patched_python

    no_literal_flag = "SIMPLY{" not in challenge.model_dump_json()

    cases = [
        *_inspect("Vulnerable excerpt", challenge.vulnerable_code),
        *_inspect("Patch excerpt", challenge.patched_code),
        *_inspect_codebase("Vulnerable codebase", challenge.vulnerable_files),
        *_inspect_codebase("Patched codebase", challenge.patched_files),
        EvalCase(
            name="Patch changes Python source files",
            passed=implementation_changed,
            detail=(
                "Python source files differ; behavioral tests are still required."
                if implementation_changed
                else "Python source files are unchanged."
            ),
        ),
        EvalCase(
            name="No literal game flag marker",
            passed=no_literal_flag,
            detail=(
                "No literal SIMPLY{ marker detected; this is not a complete secret scan."
                if no_literal_flag
                else "A literal game flag marker was found."
            ),
        ),
    ]

    for label, files, tokens in (
        (
            "Vulnerable codebase",
            challenge.vulnerable_files,
            payload.vulnerable_required,
        ),
        (
            "Patched codebase",
            challenge.patched_files,
            payload.patched_required,
        ),
    ):
        declared = _declares_endpoint(
            files, challenge.endpoint.method, challenge.endpoint.path
        )
        cases.append(
            EvalCase(
                name=f"{label} declares the endpoint",
                passed=declared,
                detail=(
                    "app.py declares the expected literal route and HTTP method."
                    if declared
                    else "app.py does not declare the expected route and HTTP method."
                ),
            )
        )

        source = "\n".join(
            file.content for file in files if file.path.endswith(".py")
        )
        tokens_present = all(token in source for token in tokens)
        cases.append(
            EvalCase(
                name=f"{label} contains requested source markers",
                passed=tokens_present,
                detail=(
                    "Requested markers are present; this is not a behavior test."
                    if tokens_present
                    else "Requested source markers are missing from Python files."
                ),
            )
        )

    return EvalReport(
        backend=payload.backend,
        passed=bool(cases) and all(case.passed for case in cases),
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
