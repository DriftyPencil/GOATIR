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

## UI: Terraria-style pixel game (2026-09-19, session 3)

- `static/index.html` and `static/styles.css` were rewritten as a pixel-art world: sky, drifting clouds, stepped hills, and grass/dirt/stone tiles. All tiles and sprites are inline SVG; no images were generated.
- Goatir and Botir use pixelated copies of the supplied portraits (`static/assets/*-px.png`, downscaled with `sips`) shown in NPC frames. The player and the vault door are pixel sprites drawn in `app.js` (`pixelSvg`).
- Speech bubbles above each character show their latest line, typing dots while an agent works, and a red bubble when the passcode leaks.
- The HUD shows attacks, breaches, guard level and status. Hearts show vault integrity and blue stars show suspicion. The chat log uses Terraria colors. Example attacks form a numbered hotbar. The right panel is "Botir's Workbench".
- Effects (`renderScene` in `app.js`): screen shake, blood-moon sky, open vault with gold and a coin burst on breach; "BLOCKED!" and a hit flash on a blocked attack; golden sky, "LEVEL UP!" and sparkles on a patch. Effects fire only on state changes, never on reload, and bubbles dim while big text shows.
- All element IDs used by the existing logic were kept. Checked on desktop (1280px) and mobile (375px, no horizontal overflow, player bubble hidden on phones). Full rehearsal loop with the Modal runner: breach, patch to v2.0, replay blocked. No console errors.

## UI simplification and the school trip (2026-09-19, session 4)

- Removed the chat-history panel, Botir's Workbench (log, defenses and tests tabs), hearts, stars and extra HUD stats. The page is now the header, the world scene, and one attack bar (numbered hotbar, input, replay ↻ and Send). The conversation lives only in speech bubbles, plus an `aria-live` line for screen readers.
- The HUD shows only Goatir's level and your breach count.
- Dialogue was made short and casual: the demo lines in `vault/policy.py`, the greeting and patch lines in `vault/engine.py`, and the demo coach line in `vault/agents.py`. The live Gemini prompts now ask for one or two casual sentences, and a coach line under 15 words.
- New school trip (`schoolTrip` in `static/app.js`), fired when the breach count goes up: red sky, open vault and coins. Botir then says his coach line, Goatir says "Aww, man…" and walks (stepped `left` transition) into a pixel schoolhouse. A screen wipe (iris) switches to the classroom: chalkboard lesson per attack type (`LESSONS`), Botir teaching, then a "Pop quiz!". The quiz ticks through the real regression cases once the backend finishes. If he passes: LEVEL UP, sparkles, graduation cap and `Goatir LvN`. Then a wipe back outside, the walk to the vault, and "back on duty". If he fails, he returns without levelling up.
- The sequence runs on its own timers and waits for backend status (`waitFor`), so it plays at a readable pace even though Rehearsal finishes in about 2 seconds. Input stays locked while it plays (`cinematic`). Reloading mid-trip skips the animation and shows the current state.
- Verified on desktop (1280) and mobile (375): full trip, replay blocked, level counts 1→2→3 across two breaches, no horizontal overflow, 32 tests pass.

## Remaining work

1. Modal backend is still not exercised. It needs `uv run modal setup` and `EVAL_BACKEND=modal`.
2. Live mode clicked through in the browser UI: a roleplay attack was refused by Gemini, with no errors. Added an inline SVG favicon to stop a favicon.ico 404.
3. README screenshots (`docs/*.png`, captured with Playwright plus the installed Chrome) and a 60-second demo script are done.
4. Modal is DONE. There are two local profiles: `driftypencil` (active) and `pranavreddy471`. `EVAL_BACKEND=modal` passed a live round on 2026-09-19: 6/6 checks ran in a Modal sandbox and the replay was blocked. The local `.env` now defaults to `modal`.
5. `Start Vault.command` is a double-click macOS launcher for non-coders. It installs uv if missing, runs the server, and opens the browser.
6. Public deployment: `deploy/modal_web.py` is written but NOT deployed yet. It needs a Modal secret named `evolving-vault` holding `GEMINI_API_KEY`. The assistant was not permitted to write secrets, so the user creates it (command in the README). Then run `uv run modal deploy deploy/modal_web.py`. It uses one container because sessions are in memory.
7. Logfire is optional and still unset (`LOGFIRE_TOKEN`).
8. Known cosmetic issue: the chat scroll area clips the top message under the mission banner once the chat grows. It's a normal scroll clip, not an overlap bug.

## Known scope limits

- This is a local hackathon prototype; sessions live in one server process and reset on restart.
- Behavioral patches reduce demonstrated failure modes; small regression suites do not prove general prompt-injection immunity.
- Rehearsal outcomes are simulated and must remain visibly labeled.
- Modal cloud execution requires user credentials/account setup and has not yet been exercised.
