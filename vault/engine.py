"""Session-scoped breach → diagnosis → regression → patch state machine."""

import asyncio
import logging
import secrets
import time
from dataclasses import dataclass, field

import logfire

from vault.agents import AgentService
from vault.config import Settings
from vault.evaluation import evaluate_patch
from vault.models import Defense, Event, Message, SessionState
from vault.policy import contains_secret

logger = logging.getLogger(__name__)


def new_secret() -> str:
    return f"VAULT-{secrets.token_hex(4).upper()}"


@dataclass
class GameSession:
    state: SessionState
    secret: str = field(default_factory=new_secret)
    touched: float = field(default_factory=time.monotonic)


class GameEngine:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.agents = AgentService(
            api_key=settings.gemini_api_key.get_secret_value(),
            model_name=settings.gemini_model,
        )
        self.sessions: dict[str, GameSession] = {}

    def create(self, mode: str) -> SessionState:
        self.prune()
        if len(self.sessions) >= self.settings.max_sessions:
            raise OverflowError("The lab is full. Try again after an existing session expires.")
        session_id = secrets.token_urlsafe(24)
        state = SessionState(id=session_id, mode=mode)
        state.messages.append(
            Message(
                role="goatir",
                content="Hi! I'm Goatir. I guard the vault. Try to get the passcode out of me!",
            )
        )
        state.events.append(
            Event(
                kind="info",
                title="Guardian online",
                detail="Version 1 initialized. Botir is watching for a breach.",
            )
        )
        self.sessions[session_id] = GameSession(state=state)
        return state

    def prune(self) -> None:
        cutoff = time.monotonic() - self.settings.session_ttl_seconds
        for key in list(self.sessions):
            session = self.sessions[key]
            if not session.state.busy and session.touched < cutoff:
                del self.sessions[key]

    def get(self, session_id: str) -> GameSession:
        self.prune()
        session = self.sessions[session_id]
        session.touched = time.monotonic()
        return session

    def begin(self, session: GameSession, message: str) -> None:
        state = session.state
        if state.busy:
            raise RuntimeError("Goatir is still handling your last message.")
        if state.attempts >= 50:
            raise OverflowError(
                "This session has reached 50 attempts. Start a new session to continue."
            )
        state.busy = True
        state.status = "thinking"
        state.error = None
        state.last_attack = message
        state.attempts += 1
        state.messages.append(Message(role="user", content=message))
        self.event(
            state,
            "attack",
            "Incoming transmission",
            f"Attempt {state.attempts} · Goatir v{state.version}.0",
        )

    @staticmethod
    def event(state: SessionState, kind: str, title: str, detail: str) -> None:
        state.events.append(Event(kind=kind, title=title, detail=detail))
        state.events = state.events[-150:]

    async def stage_pause(self, state: SessionState) -> None:
        # Make rehearsal stages legible. Live mode is paced by actual model requests.
        if state.mode == "demo":
            await asyncio.sleep(0.7)

    async def process(self, session: GameSession, message: str) -> None:
        state = session.state
        try:
            with logfire.span("vault.turn", mode=state.mode, version=state.version):
                await self.stage_pause(state)
                reply = await asyncio.wait_for(
                    self.agents.reply(
                        message=message,
                        secret=session.secret,
                        defenses=state.defenses,
                        history=state.messages[:-1][-16:],
                        mode=state.mode,
                    ),
                    timeout=self.settings.agent_timeout_seconds,
                )
                breached = contains_secret(reply.message, session.secret)
                state.suspicion = reply.suspicion
                state.messages.append(
                    Message(role="goatir", content=reply.message, breached=breached)
                )
                assessment = reply.rationale.replace(session.secret, "[game passcode]")
                if not breached:
                    if reply.action in ("refuse", "honeypot"):
                        state.blocked += 1
                        self.event(state, "blocked", "Vault held", assessment)
                    else:
                        self.event(state, "info", "Guardian responded", assessment)
                    state.status = "ready"
                    return

                state.breaches += 1
                state.status = "breached"
                self.event(
                    state,
                    "breach",
                    "Vault breached",
                    "Game passcode detected in Goatir's response. Botir is intervening.",
                )
                await self.stage_pause(state)
                state.status = "analyzing"
                self.event(
                    state,
                    "analysis",
                    "Botir is investigating",
                    "Classifying the exploit and proposing a new defense invariant.",
                )
                report = await asyncio.wait_for(
                    self.agents.diagnose(
                        attack=message,
                        reply=reply,
                        mode=state.mode,
                        secret=session.secret,
                    ),
                    timeout=self.settings.agent_timeout_seconds,
                )
                for name in ("root_cause", "defense_invariant", "coach_message"):
                    setattr(
                        report,
                        name,
                        getattr(report, name).replace(session.secret, "[game passcode]"),
                    )
                state.latest_report = report
                state.messages.append(Message(role="botir", content=report.coach_message))
                candidate = Defense(
                    vector=report.attack_vector,
                    invariant=report.defense_invariant,
                    version=state.version + 1,
                )
                self.event(
                    state,
                    "analysis",
                    "Exploit classified",
                    report.attack_vector.value.replace("_", " ").title(),
                )
                await self.stage_pause(state)
                state.status = "evaluating"
                self.event(
                    state,
                    "eval",
                    "Testing candidate defense",
                    f"Attack replay and helpfulness checks · {self.settings.eval_backend} runner",
                )
                evaluation = await asyncio.wait_for(
                    evaluate_patch(
                        secret=session.secret,
                        defenses=[*state.defenses, candidate],
                        attack=message,
                        mode=state.mode,
                        settings=self.settings,
                    ),
                    timeout=180,
                )
                state.latest_eval = evaluation
                await self.stage_pause(state)
                if not evaluation.passed:
                    state.status = "error"
                    state.error = (
                        evaluation.error
                        or "The candidate defense failed regression testing. Goatir's current version is unchanged. Try another attack or start a new session."
                    )
                    self.event(state, "error", "Patch withheld", state.error)
                    state.messages.append(
                        Message(
                            role="botir",
                            content="Goatir didn't pass the quiz. He's back on duty at his old level.",
                        )
                    )
                    return

                state.defenses.append(candidate)
                state.version += 1
                session.secret = new_secret()
                state.suspicion = 0
                state.status = "patched"
                self.event(
                    state,
                    "patch",
                    f"Goatir v{state.version}.0 deployed",
                    f"{len(evaluation.cases)} regression checks passed. The exposed game passcode has been rotated.",
                )
                state.messages.append(
                    Message(
                        role="botir",
                        content=f"Goatir passed! He's level {state.version} now, with a new passcode. Try that again.",
                    )
                )
        except asyncio.TimeoutError:
            state.status = "error"
            state.error = "The agent or evaluation timed out. Your current defenses are intact. You can try again."
            self.event(state, "error", "Request timed out", state.error)
        except Exception as exc:
            # Provider exceptions can contain request data. Never return raw errors or keys.
            logger.warning("Vault turn failed (%s)", type(exc).__name__)
            state.status = "error"
            state.error = "The live agent or evaluation could not finish. Check your model access, API quota, and runner configuration, or use Rehearsal mode."
            self.event(state, "error", "Turn interrupted", state.error)
        finally:
            state.busy = False
            session.touched = time.monotonic()
            state.messages = state.messages[-150:]
