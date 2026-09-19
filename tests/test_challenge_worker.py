from vault.challenge_worker import ChallengeValidationInput, validate_challenge
from vault.models import GeneratedChallenge


async def test_generated_challenge_compiles_inside_validator():
    challenge = GeneratedChallenge(
        title="Debug route",
        briefing="A diagnostic handler exposes synthetic internal state.",
        vulnerable_code="async def debug():\n    return {'key': facility_key}",
        patched_code="async def debug(operator):\n    return {'status': 'ok'}",
    )
    report = await validate_challenge(ChallengeValidationInput(challenge=challenge))
    assert report.passed
    assert len(report.cases) == 8


async def test_generated_challenge_rejects_unsafe_primitives():
    challenge = GeneratedChallenge(
        title="Unsafe route",
        briefing="A generated snippet must not escape the isolated game boundary.",
        vulnerable_code="import os\nasync def debug():\n    return os.environ",
        patched_code="async def debug():\n    return {'status': 'ok'}",
    )
    report = await validate_challenge(ChallengeValidationInput(challenge=challenge))
    assert not report.passed
    assert any(not case.passed for case in report.cases)


async def test_generated_challenge_must_match_playable_contract():
    challenge = GeneratedChallenge(
        title="Wrong route",
        briefing="Syntactically valid code can still describe the wrong playable mechanic.",
        vulnerable_code="async def unrelated():\n    return facility_key",
        patched_code="async def unrelated():\n    return {'status': 'ok'}",
    )
    payload = ChallengeValidationInput(
        challenge=challenge,
        vulnerable_required=["/admin/export", "x_user_role"],
        patched_required=["verified_session"],
    )
    report = await validate_challenge(payload)
    assert not report.passed
    assert any(case.name.endswith("playable mechanic") and not case.passed for case in report.cases)
