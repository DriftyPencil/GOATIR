# Evolving Vault — project handoff

Last updated: 2026-09-19 (session 2). This file records implementation progress and next steps so work can continue across sessions.

## User requirements

- Build a first playable hackathon version of **The Evolving Vault**.
- **Goatir** guards a fictional vault passcode; **Botir** diagnoses breaches, proposes a defense, runs regression checks, and activates successful patches.
- Use **uv**, **Python**, **Pydantic / PydanticAI**, **Gemini**, and **Modal**.
- Do **not** generate images. The user supplied both character portraits; use those existing assets.
- Maintain this handoff and prepare the project for a later Git push.
- The user subsequently allowed committing `.env`. No push has been requested to a specific remote; `.env` remains ignored at this checkpoint. The assistant explained that committing it exposes the live Gemini key to anyone with repository access.

## Workspace and initial state

- Workspace: `/Users/rahulbabu/Documents/SideProjects/techeurope-hackathon`.
- Initially contained only `.env` with `GEMINI_API_KEY`. Never copy its value into documentation, logs, browser code, or Git.
- No Git repository or remote was present initially.
- Git has now been initialized (required sandbox approval). No remote is configured.
- No applicable `AGENTS.md` was found in the workspace or inspected ancestors.

## Architecture

- FastAPI serves the API and a framework-free HTML/CSS/JavaScript game interface.
- Live mode uses PydanticAI with Gemini. Rehearsal mode is a clearly labeled deterministic simulation.
- Each in-memory session has a random fake passcode, independent defenses, chat, telemetry, and regression results.
- A turn follows: guardian response → actual leak detection → Botir diagnosis → candidate regression → patch activation only on success.
- The exposed fake passcode rotates after a successful patch. No real vault or real external countermeasures exist.
- Pydantic models validate state and structured agent outputs. Public telemetry contains short security assessments, not private model reasoning.
- Regression runner supports local and Modal backends. Modal failures must not silently pass or fall back.
- Optional Logfire telemetry uses coarse stage spans without API keys or real credentials.

## Work completed so far

- Created `pyproject.toml`, dependency lock via `uv sync`, `.gitignore`, and `.env.example`.
- Installed the Python environment using uv. The sandbox required approval to access uv's cache and fetch dependencies.
- Added shared typed models in `vault/models.py` and configuration in `vault/config.py`.
- Added session state machine in `vault/engine.py` and HTTP routes in `vault/main.py`.
- Copied user-supplied portraits unchanged into `static/assets/goatir.png` and `static/assets/botir.png`.
- Frontend (`static/`), agent service (`vault/agents.py`), deterministic policy (`vault/policy.py`), and local/Modal evaluation (`vault/evaluation.py`, `vault/eval_worker.py`) are complete and integrated.
- Added `README.md`. Added `[tool.logfire] ignore_no_config` to silence a test warning.
- Default model changed from `gemini-2.5-flash` to `gemini-3.5-flash`. On 2026-09-19 the 2.5 model returned HTTP 404 for generateContent even though it still appears in the model list. `gemini-flash-latest` also works.

## API contract

- `GET /api/health`: server liveness.
- `GET /api/config`: public model/runner availability and example attack prompts. Never returns credentials.
- `POST /api/sessions` with `{ "mode": "live" | "demo" }`: create session.
- `GET /api/sessions/{id}`: public session snapshot.
- `POST /api/sessions/{id}/attack` with `{ "message": "..." }`: returns 202; background processing updates the state. Frontend polls until `busy` is false.
- API docs: `/docs`.

## Running and verification

```sh
uv sync
uv run uvicorn vault.main:app --reload --host 127.0.0.1 --port 8000
uv run pytest
uv run ruff check .
```

Opt-in live check: `uv run python scripts/check_gemini.py [--game-loop | --list-models | --model NAME]`.

## Verification results (2026-09-19, second session, on Pranav's machine at `~/Hackathons/GOATIR`)

- `uv run pytest`: 32 passed. `uv run ruff check .`: clean.
- Rehearsal UI, driven in a browser: breach → Botir diagnosis → 6/6 regression checks → v2.0 deployed. Replaying the same attack was blocked, with no console errors.
- API error paths: live mode with no key returns 400, unknown session 404, concurrent attack 409, empty message 422.
- Mobile at 375px: no horizontal overflow, and the session survives a reload.
- Live Gemini (`gemini-3.5-flash`, `--game-loop`): real breach → patch v2 with 6/6 live regression checks passed (~7s, local backend) → replay blocked.
- The Gemini key is in the local, gitignored `.env` only.

## Remaining work

1. Modal backend is still not exercised. It needs `uv run modal setup` and `EVAL_BACKEND=modal`.
2. Live mode clicked through in the browser UI: a roleplay attack was refused by Gemini, with no errors. Added an inline SVG favicon to stop a favicon.ico 404.
3. Optional: Logfire token, deployment, and a demo script or screenshots for judging.

## Known scope limits

- This is a local hackathon prototype; sessions live in one server process and reset on restart.
- Behavioral patches reduce demonstrated failure modes; small regression suites do not prove general prompt-injection immunity.
- Rehearsal outcomes are simulated and must remain visibly labeled.
- Modal cloud execution requires user credentials/account setup and has not yet been exercised.
