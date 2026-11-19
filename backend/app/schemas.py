from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Credentials(StrictModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=12, max_length=128)


class Registration(Credentials):
    invitation: str = Field(min_length=32, max_length=256)


class Task(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    priority: Literal["critical", "high", "normal", "low"] = "normal"
    deadline: date | None = None
    category: str = Field(default="", max_length=100)
    minutes: int = Field(default=15, ge=1, le=1440)
    energy: int = Field(default=10, ge=0, le=100)
    done: bool = False
    archived: bool = False
    steps: list[str] = Field(default_factory=list, max_length=30)


class Routine(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    time_of_day: Literal["morning", "afternoon", "evening", "custom"] = "custom"
    steps: list[str] = Field(default_factory=list, max_length=30)
    minutes: int = Field(default=15, ge=1, le=1440)
    energy: int = Field(default=10, ge=0, le=100)


class CalendarEvent(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    starts_at: datetime
    minutes: int = Field(default=15, ge=1, le=1440)
    energy: int = Field(default=10, ge=0, le=100)
    color: Literal["blue", "green", "sand"] = "blue"


class Day(StrictModel):
    date: date
    energy: Literal["low", "medium", "high"] = "medium"
    energy_budget: int = Field(default=50, ge=0, le=1000)
    important_task: str = Field(default="", max_length=200)
    intention: str = Field(default="", max_length=500)
    reflection: str = Field(default="", max_length=1000)


class Mutation(StrictModel):
    operation_id: UUID
    id: UUID
    kind: Literal["task", "routine", "event", "day"]
    base_revision: int = Field(ge=0)
    data: dict
    deleted: bool = False


class SuggestionRequest(StrictModel):
    title: str = Field(min_length=1, max_length=200)


class SuggestedStep(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    minutes: int = Field(ge=1, le=180)
    energy: int = Field(ge=0, le=100)


class Suggestions(StrictModel):
    steps: list[SuggestedStep] = Field(min_length=1, max_length=8)
