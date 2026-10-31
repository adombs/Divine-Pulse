"""Pure text normalization shared by naming rules and adapters."""

import re
import unicodedata


def normalize(text: str) -> str:
    """Lowercase, accents and punctuation dropped, whitespace collapsed (digits and '+' kept: they matter)."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    text = re.sub(r"[^a-z0-9+ ]+", " ", text)
    return " ".join(text.split())


def clean_text(text: str) -> str:
    """Control characters removed and whitespace collapsed."""
    text = "".join(" " if c.isspace() else c for c in text if c.isspace() or unicodedata.category(c)[0] != "C")
    return " ".join(text.split())
