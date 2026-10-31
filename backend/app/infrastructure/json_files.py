"""Small JSON-file primitives shared by persistence adapters."""

from __future__ import annotations

import os
import json
import logging
import tempfile
from collections.abc import Callable
from pathlib import Path

log = logging.getLogger(__name__)
_warned: set[Path] = set()
_damaged: set[Path] = set()


#: Recovery notices the UI shows once (never a native dialog: it would pop up during tests and at odd moments).
NOTICES: list[str] = []


def _notify(message: str) -> None:
    log.warning(message)
    if message not in NOTICES:
        NOTICES.append(message)


def take_notices() -> list[str]:
    """The recovery notices not yet shown, cleared as they are taken."""
    taken = NOTICES[:]
    NOTICES.clear()
    return taken


def read_with_backup[T](path: Path, decode: Callable[[str], T]) -> T:
    """Decode a save, recovering from its last good backup when necessary."""
    try:
        return decode(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as error:
        _damaged.add(path)
        backup = path.with_suffix(path.suffix + ".bak")
        try:
            result = decode(backup.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            if path not in _warned:
                _warned.add(path)
                _notify(f"Could not read {path}. The file has been kept for recovery.")
            raise error
        if path not in _warned:
            _warned.add(path)
            _notify(f"Could not read {path}. The last backup was loaded instead.")
        return result


def preserve_original(path: Path, *, suffix: str | None = None) -> Path:
    """Copy a file to a one-time backup without replacing an earlier backup."""
    base = path.with_suffix(path.suffix + ".bak" if suffix is None else suffix)
    backup = base
    sequence = 2
    while True:
        try:
            with path.open("rb") as source, backup.open("xb") as target:
                target.write(source.read())
                target.flush()
                os.fsync(target.fileno())
            return backup
        except FileExistsError:
            backup = base.with_name(f"{base.stem}.{sequence}{base.suffix}")
            sequence += 1


def atomic_write_text(path: Path, contents: str, *, backup: bool = False) -> None:
    atomic_write_bytes(path, contents.encode("utf-8"), backup=backup)


def atomic_write_bytes(path: Path, contents: bytes, *, backup: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not backup:
        _replace_bytes(path, contents)
        return
    backup = path.with_suffix(path.suffix + ".bak")
    if path.exists() and path not in _damaged:
        try:
            previous = path.read_bytes()
            json.loads(previous)
        except (OSError, ValueError):
            pass  # Never replace a good backup with damaged data.
        else:
            _replace_bytes(backup, previous)
    _replace_bytes(path, contents)
    _damaged.discard(path)
    if not backup.exists():
        _replace_bytes(backup, contents)


def _replace_bytes(path: Path, contents: bytes) -> None:
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        name = temporary.name
        try:
            temporary.write(contents)
            temporary.flush()
            os.fsync(temporary.fileno())
        except BaseException:
            temporary.close()
            Path(name).unlink(missing_ok=True)
            raise
    try:
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)
