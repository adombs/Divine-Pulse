"""Request bodies: everything the API accepts from outside, validated in one place.

Every body rejects unknown fields, text is cleaned (control characters dropped, whitespace collapsed) and
length-limited, and numbers are range-checked.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from ..domain.text import clean_text
from ..domain.settings import WindowMode
from ..domain.ebst import OTHER_KEYS, EbstType, ordered_others


def _text(max_len: int, *, required: bool = True, what: str = "This"):
    def check(value: str) -> str:
        value = clean_text(value)
        if required and not value:
            raise ValueError(f"{what} can't be empty")
        if len(value) > max_len:
            raise ValueError(f"{what} must be at most {max_len} characters")
        return value

    return Annotated[str, AfterValidator(check)]


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GameNspsIn(Body):
    nsps: list[str] = Field(min_length=1, max_length=64)
    keys: str = Field(min_length=1, max_length=4096)
    keep_dumps: str | None = Field(None, min_length=1, max_length=4096)


class GameDumpIn(Body):
    dump: str = Field(min_length=1)


class RunName(Body):
    name: _text(60, what="Run name")  # type: ignore[valid-type]


class EbstIn(Body):
    """Change a unit's eBST setup. Fields left out keep their current value."""

    offense: EbstType | None = None
    defense: EbstType | None = None
    stats: list[str] | None = Field(None, max_length=len(OTHER_KEYS))

    @field_validator("stats")
    @classmethod
    def _stats(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        bad = [k for k in v if k not in OTHER_KEYS]
        if bad:
            raise ValueError(f"Only HP, Mv, Dex, Spd, Lck and Cha can be toggled (got {', '.join(bad)})")
        return ordered_others(list(dict.fromkeys(v)))

    @model_validator(mode="after")
    def _something(self) -> EbstIn:
        if self.offense is None and self.defense is None and self.stats is None:
            raise ValueError("Give an offense or defense type, or the stats to count")
        return self


class SettingsIn(Body):
    max_recordings: int | None = Field(None, ge=0, le=1000)
    window_mode: WindowMode | None = None


def describe_errors(errors: list[dict]) -> str:
    """Pydantic errors as one readable sentence for the UI."""
    parts = []
    for e in errors:
        loc = [str(p) for p in e.get("loc", ()) if p not in ("body", "query", "path")]
        field = loc[0].replace("_", " ") if loc else ""
        msg = e.get("msg", "invalid").removeprefix("Value error, ")
        if e.get("type") == "extra_forbidden":
            msg = f"unexpected field '{loc[-1] if loc else '?'}'"
            field = ""
        elif e.get("type") == "missing":
            msg = f"{field or 'a value'} is required"
            field = ""
        elif field and not msg[:1].isupper():
            msg = f"{field}: {msg}"
        parts.append(msg)
    text = "; ".join(dict.fromkeys(parts)) or "Invalid request"
    return text[:1].upper() + text[1:] + ("" if text.endswith(".") else ".")
