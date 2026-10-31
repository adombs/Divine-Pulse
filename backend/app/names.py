"""Known game names (characters, classes, abilities) and fuzzy matching against them.

Used for names typed by hand and names in saved data.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from functools import lru_cache

from .domain.text import normalize as normalize, clean_text as clean_text
from .infrastructure import game_tables

# Similar characters mapped to one representative so they compare equal.
_CONFUSABLE = str.maketrans({"0": "o", "1": "l", "i": "l", "|": "l", "5": "s", "8": "b", "’": "'", "`": "'"})
_RN = re.compile(r"rn")




def _shape(text: str) -> str:
    """Compare confusable letters together and drop spaces."""
    return _RN.sub("m", normalize(text).translate(_CONFUSABLE)).replace(" ", "")


def _numbers(text: str) -> list[str]:
    """Real numbers ("Lv 2", "+5", "Lv2"), not digits used in place of a letter ("Hi1da", "B0w", "1ord"):
    a digit run followed by a letter is taken to be part of a word."""
    return re.findall(r"\d+(?![a-z])", text)


def similarity(a: str, b: str) -> float:
    """0..1. Tolerant of similar characters, case, spacing and small typos; numbers must agree exactly (so
    "Lance Prowess Lv 2" never matches "Lv 3", nor "HP +5" "HP +3")."""
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if _numbers(na) != _numbers(nb):
        return 0.0
    sa, sb = _shape(a), _shape(b)
    if sa == sb:
        return 0.97
    return max(SequenceMatcher(None, na, nb).ratio(), SequenceMatcher(None, sa, sb).ratio() * 0.98)


@dataclass(frozen=True)
class Match:
    value: str
    score: float


def best_match(text: str, choices, threshold: float = 0.75) -> Match | None:
    """The closest choice to `text`, if it's at least `threshold` similar."""
    best: Match | None = None
    for choice in choices:
        s = similarity(text, choice)
        if s > (best.score if best else 0.0):
            best = Match(choice, s)
            if s >= 1.0:
                break
    return best if best and best.score >= threshold else None


def snap(text: str, choices, threshold: float = 0.75) -> str:
    """`text` replaced by the closest known name, or tidied but unchanged if nothing is close."""
    text = clean_text(text)
    if not text:
        return ""
    m = best_match(text, choices, threshold)
    return m.value if m else text




def known() -> dict:
    # Include the selected names in the cache key so changing language takes effect immediately.
    categories = ("character_given", "class", "ability")
    try:
        texts = tuple(tuple(game_tables.game_assets().text(category).items()) for category in categories)
    except (AttributeError, TypeError):
        texts = ()
    return _known(game_tables.generation(), texts)


@lru_cache(maxsize=2)
def _known(_generation: tuple, texts: tuple = ()) -> dict:
    result = {}
    for index, (key, category) in enumerate((("characters", "character_given"), ("classes", "class"),
                          ("abilities", "ability"))):
        try:
            imported = dict(texts[index]) if texts else game_tables.game_assets().text(category)
        except (AttributeError, TypeError):
            imported = {}
        if isinstance(imported, dict) and imported:
            result[key] = list(dict.fromkeys(imported.values()))
    return result


def characters() -> list[str]:
    return list(known().get("characters", []))


def classes() -> list[str]:
    return list(known().get("classes", []))


def abilities() -> list[str]:
    return list(known().get("abilities", []))

