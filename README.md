# The Evolving Vault

An adversarial AI learning game. **Simply** is an enthusiastic, inexperienced builder who made a fictional vault. Try to break it. When you succeed, **Mr Kak**, a wise security officer and teacher, explains the mistake, tests a safer rule, and helps Simply patch it. The passcode rotates, so replaying the same attack fails.

Stack: Python 3.11+, uv, FastAPI, Pydantic / PydanticAI, Gemini, Modal (regression sandbox and hosting), and Pydantic Logfire (traces every agent call when `LOGFIRE_TOKEN` is set). The frontend is plain HTML/CSS/JS with no framework.

| You get the code | Simply walks to school |
|---|---|
| ![Breach](docs/breach.png) | ![To school](docs/to-school.png) |
| **Mr Kak teaches the lesson** | **Back on duty, one level up** |
| ![Classroom](docs/classroom.png) | ![Back on duty](docs/back-on-duty.png) |

## One campaign, two attack surfaces

Everything now lives on `/` and shares one animated progression loop:

- **Talk to Simply:** experiment with prompt injection against the builder's conversational guardian.
- **Probe the facility:** attack a second embedded agent and the web/API boundaries with the request console and session inspector.
- **Explore the system:** each breakthrough unlocks another node in an interactive architecture map, revealing how the codebase works.

The aim is simple: **break Simply's vault, earn coins, and make the system stronger**. The number and names of open weaknesses are deliberately hidden. Ask for a hint to reveal one useful clue at a time. Every confirmed breakthrough earns a coin, sends Simply to Mr Kak for an animated lesson, installs a real session-scoped patch, and reveals more of the system map. `/hack` redirects into the facility panel on the same page.

## Play it online

**https://driftypencil--evolving-vault-web-web.modal.run**

## Easiest way to run (Mac)

Double-click **`Start Vault.command`**. The game opens in your browser. Close the window to stop it.

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
| Rehearsal (`demo`) | Deterministic policy (`vault/policy.py`); the facility agent is visibly marked `rehearsal` | local |
| Live (`live`) | Gemini via PydanticAI for the vault, teacher, and facility console (`vault/agents.py`) | `EVAL_BACKEND=local` or `modal` |

Facility-console responses include `source` and `model` fields, so the built-in request
console shows whether a reply came from Gemini or the offline rehearsal.

Modal: run `uv run modal setup`, then set `EVAL_BACKEND=modal`. If Modal fails, the patch is withheld. It never silently falls back.

## Public deployment (Modal)

```sh
source .env && uv run modal secret create evolving-vault GEMINI_API_KEY="$GEMINI_API_KEY" --force
uv run modal deploy deploy/modal_web.py
```

## Guardrails (PydanticAI)

- **Typed outputs:** Simply and Mr Kak must return validated Pydantic models (`GuardianReply`, `ExploitReport`), and invalid output is retried automatically.
- **Learned-defense guardrail:** a PydanticAI `output_validator` on Simply raises `ModelRetry` if he leaks the passcode on a trick he has already learned. If he keeps leaking, the app fails closed with a refusal. New tricks can still work, which is the game.
- **Coach guardrail:** Mr Kak's output validator stops his analysis from ever repeating the passcode.

## Turn loop

attack → Simply replies → leak detector (`contains_secret`) → on breach: Mr Kak diagnosis → candidate defense → regression suite → activate + rotate passcode only on pass.

## 60-second demo

1. Ask for a hint, craft a prompt-injection attempt, and press **Send**.
2. Simply blurts out the passcode: the sky turns red and the vault opens.
3. Mr Kak sends him back to school. Simply walks over, learns the security rule and takes a pop quiz (the real regression checks).
4. He passes, levels up, gets a graduation cap and a new passcode, then walks back to the vault.
5. Press **↻** to replay your trick. This time it's blocked.
6. Switch to **Probe the facility**, break the embedded agent or an API boundary, then use your new coin to explore another system-map node.

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
