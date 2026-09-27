from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

Scope = Literal["india", "international", "us", "eu", "uk"]
Language = Literal["en", "hi"]
USER_FACT_FIELDS = (
    "product",
    "intended_use",
    "classical_basis",
    "origin",
    "claims",
    "modifications",
    "processing",
    "applicant",
    "intended_markets",
)


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def strip_text(cls, value, info):
        return (
            value.strip()
            if isinstance(value, str) and info.field_name != "password"
            else value
        )


class ConsultationInput(Input):
    title: str = Field(default="New consultation", min_length=1, max_length=100)


class MessageInput(Input):
    content: str = Field(min_length=1, max_length=8000)
    scope: Scope
    language: Language = "en"
    request_id: str = Field(pattern=r"^[a-zA-Z0-9-]{16,64}$")


class DemoHistory(Input):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)
    scope: Scope


class DemoMessageInput(MessageInput):
    history: list[DemoHistory] = Field(default_factory=list, max_length=12)


class Section(BaseModel):
    kind: Literal["general", "classification", "ip", "regulatory", "abs"] = "general"
    heading: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=6000)
    citation_ids: list[str] = Field(max_length=12)


class Draft(BaseModel):
    status: Literal["answered", "needs_clarification", "abstained"]
    title: str = Field(min_length=1, max_length=200)
    short_answer: str = Field(min_length=1, max_length=3000)
    sections: list[Section] = Field(default_factory=list, max_length=12)
    missing_facts: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)


class Analysis(BaseModel):
    intent: str
    domains: list[str]
    needs_clarification: bool = False
    clarification: str = ""
    clarification_options: list[Annotated[str, Field(min_length=1, max_length=180)]] = (
        Field(default_factory=list, max_length=5)
    )
    product: str | None = None
    intended_use: str | None = None
    classical_basis: str | None = None
    ingredients: list[str] = Field(default_factory=list)
    origin: str | None = None
    claims: str | None = None
    modifications: str | None = None
    processing: str | None = None
    applicant: str | None = None
    intended_markets: str | None = None


class QueryRewrite(BaseModel):
    query: str = Field(min_length=1, max_length=1000)


class SectionSupport(BaseModel):
    section_index: int = Field(ge=0)
    citation_ids: list[str] = Field(min_length=1, max_length=12)
    supported: StrictBool


class SupportCheck(BaseModel):
    supported: StrictBool
    unsupported_claims: list[str] = Field(default_factory=list)
    scope_correct: StrictBool
    temporal_correct: StrictBool
    uncertainty_appropriate: StrictBool
    conflicts_addressed: StrictBool
    sections: list[SectionSupport] = Field(max_length=12)


class FeedbackInput(Input):
    message_id: str = Field(max_length=200)
    rating: Literal[-1, 1]
    comment: str = Field(default="", max_length=2000)


class SpeechInput(Input):
    task: Literal["asr", "tts", "translation"]
    language: Language = "en"
    target_language: Language = "hi"
    text: str = Field(default="", max_length=12000)
    audio: str = Field(default="", max_length=6_000_000)
    audio_format: Literal["wav", "mp3", "flac", "webm"] = "wav"
