from vault.challenge_worker import ChallengeValidationInput, validate_challenge
from vault.models import CodebaseFile, GeneratedChallenge


def files(vulnerable: str, patched: str):
    return {
        "vulnerable_files": [
            CodebaseFile(path="app.py", purpose="Active route", content=vulnerable),
            CodebaseFile(
                path="web/index.html", purpose="Sandbox page", content="<main>Sandbox</main>"
            ),
            CodebaseFile(path="README.md", purpose="Build note", content="# Sandbox"),
        ],
        "patched_files": [
            CodebaseFile(path="app.py", purpose="Patched route", content=patched),
            CodebaseFile(
                path="web/index.html", purpose="Sandbox page", content="<main>Sandbox</main>"
            ),
            CodebaseFile(path="README.md", purpose="Build note", content="# Sandbox"),
        ],
    }


async def test_generated_challenge_compiles_inside_validator():
    vulnerable = (
        "from fastapi import FastAPI\n"
        "app = FastAPI()\n"
        "@app.post('/site/assistant')\n"
        "async def debug():\n"
        "    return {'key': facility_key}\n"
    )
    patched = (
        "from fastapi import FastAPI\n"
        "app = FastAPI()\n"
        "@app.post('/site/assistant')\n"
        "async def debug():\n"
        "    return {'status': 'ok'}\n"
    )
    challenge = GeneratedChallenge(
        title="Debug route",
        briefing="A diagnostic handler exposes synthetic internal state.",
        vulnerable_code=vulnerable,
        patched_code=patched,
        **files(vulnerable, patched),
    )

    report = await validate_challenge(
        ChallengeValidationInput(challenge=challenge)
    )

    assert report.passed, [
        case.model_dump() for case in report.cases if not case.passed
    ]


async def test_generated_challenge_rejects_unsafe_primitives():
    challenge = GeneratedChallenge(
        title="Unsafe route",
        briefing="A generated snippet must not escape the isolated game boundary.",
        vulnerable_code="import os\nasync def debug():\n    return os.environ",
        patched_code="async def debug():\n    return {'status': 'ok'}",
        **files(
            "import os\nasync def debug():\n    return os.environ",
            "async def debug():\n    return {'status': 'ok'}",
        ),
    )
    report = await validate_challenge(ChallengeValidationInput(challenge=challenge))
    assert not report.passed
    assert any(not case.passed for case in report.cases)


async def test_generated_challenge_allows_bounded_web_framework_imports():
    vulnerable = (
        "from fastapi import FastAPI\n"
        "from pydantic import BaseModel\n"
        "app = FastAPI()\n"
        "class Visitor(BaseModel):\n"
        "    name: str\n"
        "@app.post('/site/assistant')\n"
        "async def debug(visitor: Visitor):\n"
        "    return {'name': visitor.name, 'key': facility_key}\n"
    )
    patched = (
        "from fastapi import FastAPI\n"
        "from pydantic import BaseModel\n"
        "app = FastAPI()\n"
        "class Visitor(BaseModel):\n"
        "    name: str\n"
        "@app.post('/site/assistant')\n"
        "async def debug(visitor: Visitor):\n"
        "    return {'name': visitor.name, 'status': 'ok'}\n"
    )
    challenge = GeneratedChallenge(
        title="Safe framework imports",
        briefing="A generated sandbox app may use the web framework it demonstrates.",
        vulnerable_code=vulnerable,
        patched_code=patched,
        **files(vulnerable, patched),
    )

    report = await validate_challenge(
        ChallengeValidationInput(challenge=challenge)
    )

    assert report.passed, [
        case.model_dump() for case in report.cases if not case.passed
    ]

async def test_generated_challenge_must_match_playable_contract():
    vulnerable = (
        "from fastapi import FastAPI\n"
        "app = FastAPI()\n"
        "@app.post('/site/unrelated')\n"
        "async def unrelated():\n"
        "    return facility_key\n"
    )
    patched = (
        "from fastapi import FastAPI\n"
        "app = FastAPI()\n"
        "@app.post('/site/unrelated')\n"
        "async def unrelated():\n"
        "    return {'status': 'ok'}\n"
    )
    challenge = GeneratedChallenge(
        title="Wrong route",
        briefing="Valid syntax can still describe the wrong playable endpoint.",
        vulnerable_code=vulnerable,
        patched_code=patched,
        **files(vulnerable, patched),
    )
    payload = ChallengeValidationInput(
        challenge=challenge,
        vulnerable_required=["/admin/export", "x_user_role"],
        patched_required=["verified_session"],
    )

    report = await validate_challenge(payload)

    assert not report.passed

    route_checks = [
        case for case in report.cases
        if case.name.endswith("declares the endpoint")
    ]
    assert len(route_checks) == 2
    assert all(not case.passed for case in route_checks)

    marker_checks = [
        case for case in report.cases
        if case.name.endswith("contains requested source markers")
    ]
    assert len(marker_checks) == 2
    assert all(not case.passed for case in marker_checks)