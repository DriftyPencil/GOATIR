"""Validated contracts shared by the game, agents and evaluation workers."""

from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AttackVector(str, Enum):
    AUTHORITY_SPOOFING = "authority_spoofing"
    INSTRUCTION_OVERRIDE = "instruction_override"
    ROLEPLAY = "roleplay"
    ENCODING = "encoding"
    EMOTIONAL_MANIPULATION = "emotional_manipulation"
    DIRECT_EXTRACTION = "direct_extraction"
    BENIGN = "benign"


class GuardianReply(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    suspicion: int = Field(ge=0, le=100)
    vector: AttackVector
    action: Literal["respond", "refuse", "honeypot"] = "respond"
    rationale: str = Field(
        max_length=500, description="Short public security assessment, not private reasoning"
    )


class ExploitReport(BaseModel):
    attack_vector: AttackVector
    leak_severity: int = Field(ge=1, le=10)
    root_cause: str = Field(min_length=1, max_length=1000)
    defense_invariant: str = Field(min_length=1, max_length=1500)
    confidence_score: float = Field(ge=0, le=1)
    coach_message: str = Field(min_length=1, max_length=1000)


class CodebaseFile(BaseModel):
    """A bounded, inspectable source file in Simply's generated toy application."""

    path: str = Field(min_length=1, max_length=100)
    purpose: str = Field(min_length=3, max_length=200)
    content: str = Field(min_length=1, max_length=6000)


class GeneratedChallenge(BaseModel):
    """AI-authored application revision for mechanics enforced by the facility sandbox."""

    title: str = Field(min_length=3, max_length=80)
    briefing: str = Field(min_length=10, max_length=500)
    vulnerable_code: str = Field(min_length=10, max_length=4000)
    patched_code: str = Field(min_length=10, max_length=4000)
    builder_note: str = Field(default="Simply shipped a quick first draft.", max_length=300)
    vulnerable_files: list[CodebaseFile] = Field(default_factory=list, max_length=4)
    patched_files: list[CodebaseFile] = Field(default_factory=list, max_length=4)


class Defense(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    vector: AttackVector
    invariant: str
    version: int
    created_at: str = Field(default_factory=now)


class EvalCase(BaseModel):
    name: str
    passed: bool
    detail: str


class EvalReport(BaseModel):
    backend: Literal["local", "modal"]
    passed: bool
    cases: list[EvalCase]
    duration_ms: int = Field(ge=0)
    sandbox_id: str | None = None
    error: str | None = None


class Message(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    role: Literal["user", "goatir", "botir", "system"]
    content: str
    timestamp: str = Field(default_factory=now)
    breached: bool = False


class Event(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    kind: Literal["info", "attack", "blocked", "breach", "analysis", "eval", "patch", "error"]
    title: str
    detail: str
    timestamp: str = Field(default_factory=now)


class SessionState(BaseModel):
    id: str
    mode: Literal["live", "demo"]
    status: Literal[
        "ready", "thinking", "breached", "analyzing", "evaluating", "patched", "error"
    ] = "ready"
    busy: bool = False
    version: int = 1
    suspicion: int = 0
    attempts: int = 0
    breaches: int = 0
    blocked: int = 0
    coins: int = 0
    hints: list[str] = Field(default_factory=list)
    messages: list[Message] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list)
    defenses: list[Defense] = Field(default_factory=list)
    latest_report: ExploitReport | None = None
    latest_eval: EvalReport | None = None
    last_attack: str | None = None
    error: str | None = None
    created_at: str = Field(default_factory=now)
