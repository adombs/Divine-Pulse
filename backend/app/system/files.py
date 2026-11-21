"""Files the operating system adds to folders, which code that walks or compares folders ignores.

macOS's Finder writes a .DS_Store into a folder it shows, a .localized or an "Icon\\r" (a custom folder icon), and on
volumes without extended attributes (exFAT, FAT, network shares) an AppleDouble "._<name>" beside each file. Indexing
and trash folders are made at a volume's root (and ~/.Trash), and zips made on a Mac carry a __MACOSX folder. None of
them are the user's or the game's files. They're ignored on every platform: a folder copied from a Mac keeps them.
"""

from __future__ import annotations

from pathlib import Path, PurePath

METADATA_FILES = frozenset({".DS_Store", ".localized", "Icon\r", ".VolumeIcon.icns"})
METADATA_FOLDERS = frozenset({
    "__MACOSX", ".Spotlight-V100", ".Trash", ".Trashes", ".fseventsd", ".TemporaryItems", ".DocumentRevisions-V100",
})


def is_os_metadata(name: str) -> bool:
    """A file or folder name the operating system made (see the module's docstring)."""
    return name in METADATA_FILES or name in METADATA_FOLDERS or name.startswith("._")


def in_os_metadata(path: PurePath, root: PurePath | None = None) -> bool:
    """A path that is, or is inside, an operating system's file or folder (only its parts below `root` count)."""
    parts = path.relative_to(root).parts if root is not None else path.parts
    return any(is_os_metadata(part) for part in parts)


def user_files(root: Path, pattern: str = "*") -> list[Path]:
    """root.rglob(pattern)'s files, without the operating system's files and folders."""
    return [p for p in root.rglob(pattern) if not in_os_metadata(p, root) and p.is_file()]


def has_entries(folder: Path) -> bool:
    """A folder holds anything other than the operating system's files."""
    return any(not is_os_metadata(p.name) for p in folder.iterdir())
