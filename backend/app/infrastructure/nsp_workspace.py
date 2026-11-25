"""Own only a fresh extraction directory; never clean a user's existing folder."""

from __future__ import annotations

import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path

from ..system import platform


def validate_destination(destination: Path, protected: tuple[Path, ...] = ()) -> None:
    """Check a new child of an existing parent without modifying existing files."""
    if not destination.is_absolute() or ".." in destination.parts:
        raise ValueError("Choose an absolute path for a new dump folder inside an existing folder.")
    if problem := platform.current().folder_name_problem(destination.parts[1:]):
        raise ValueError(problem)
    if destination.exists() or destination.is_symlink() or destination.is_junction():
        raise ValueError("The dump destination already exists. Choose a new child folder; existing folders are never reused.")
    if not destination.parent.is_dir():
        raise ValueError("The dump destination's parent folder must already exist. Browse to it, then add a new folder name.")
    if any(parent.is_symlink() or parent.is_junction() for parent in destination.parents):
        raise ValueError("Choose a dump destination outside linked folders or junctions.")
    resolved = destination.resolve()
    if any(resolved.is_relative_to(path.resolve()) for path in protected):
        raise ValueError("Save raw dumps outside the application's installation and data folders.")
    # Exclusive random probe: no existing file is opened, overwritten or removed.
    with tempfile.TemporaryFile(dir=destination.parent):
        pass


@contextmanager
def extraction_workspace(destination: Path | None = None, *, protected: tuple[Path, ...] = ()):
    """Keep a requested new directory only when extraction AND verified import finish."""
    if destination is None:
        with tempfile.TemporaryDirectory(prefix="divine-pulse-nsp-") as temp:
            yield Path(temp)
        return
    validate_destination(destination, protected)
    # Atomic ownership claim also catches a folder created since validation.
    destination.mkdir(exist_ok=False)
    completed = False
    try:
        yield destination
        completed = True
    finally:
        if not completed:
            shutil.rmtree(destination)
