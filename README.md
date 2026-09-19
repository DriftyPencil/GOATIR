# The Evolving Vault

An adversarial AI game. **Goatir** guards a fictional vault passcode. Try to trick it into leaking the code. When you succeed, **Botir** works out how the attack got through, proposes a new defense, replays your attack plus helpfulness checks against it, and ships the patch only if every check passes. The passcode then rotates, so replaying the same attack fails.

Stack: Python 3.11+, uv, FastAPI, Pydantic / PydanticAI, Gemini, Modal (optional regression runner), Logfire (optional tracing). The frontend is plain HTML/CSS/JS with no framework.

## Quick start

```sh
uv sync
cp .env.example .env          # add GEMINI_API_KEY for Live mode (optional)
uv run uvicorn vault.main:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. With no key, only **Rehearsal mode** is available. It is a deterministic, clearly labeled simulation of the full loop.

## Modes

| Mode | Guardian / coach | Regression runner |
|------|------------------|-------------------|
| Rehearsal (`demo`) | Deterministic policy (`vault/policy.py`) | local |
| Live (`live`) | Gemini via PydanticAI (`vault/agents.py`) | `EVAL_BACKEND=local` or `modal` |

Modal: run `uv run modal setup`, then set `EVAL_BACKEND=modal`. If Modal fails, the patch is withheld. It never silently falls back.

## Turn loop

attack → Goatir replies → leak detector (`contains_secret`) → on breach: Botir diagnosis → candidate defense → regression suite → activate + rotate passcode only on pass.

## Checks

```sh
uv run pytest
uv run ruff check .
uv run python scripts/check_gemini.py   # opt-in real Gemini smoke test
```

## Limits

- Sessions live in memory in one server process and reset on restart.
- A small regression suite shows that specific failure modes were fixed. It does not prove general prompt-injection immunity.
- The passcode is fictional. There is no real vault and there are no real countermeasures.
