"""Asset families. Each module has `extract(ctx: Context) -> None`, writes through ctx.out, and raises nothing for a
missing optional part (a DLC, the ExeFS): it logs what it skipped instead.

Output layout (relative to the output folder):
    data/exe/          item icon selections                                                         exe_tables
    text/<LANG>.json   names and descriptions per language                                           text
    data/*.json        characters, classes, items, abilities, supports, gifts, ...                  data
    images/portraits/  characters/, generic/, faces/<portrait id>/<expression>.png                  portraits
    images/icons/      abilities/, crests/, items/, items-native/                                   exe_tables
    images/icons/      combat-arts/, magic/, weapons/, skills/; images/houses/     icons
    images/map/        class sprites, map heads, minimaps/, minimap-pieces/; data/maps.json, terrain map
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from functools import cached_property
import importlib

from .. import msgdata, tables
from ..archive import Archive
from ..dump import GameDump
from ..nso import Executable
from ..output import Output

# Stable family order for extraction progress and per-family manifest summaries.
FAMILIES = ("exe_tables", "text", "data", "portraits", "icons", "map")
ENGLISH = msgdata.LANGUAGES.index("ENG_U")


@dataclass
class Context:
    dump: GameDump
    out: Output
    log: Callable[[str], None] = print
    shared: dict = field(default_factory=dict)  # parsed text cache shared across families
    skipped: list[str] = field(default_factory=list)  # what could not be extracted, and why

    @cached_property
    def base(self) -> Archive:
        return Archive(self.dump.romfs, self.dump.updates)

    @cached_property
    def main(self) -> Executable | None:
        path = self.dump.main_path
        return Executable(path) if path and path.is_file() else None

    def dlc(self, name: str) -> Archive | None:
        romfs = self.dump.dlc.get(name)
        return Archive(romfs) if romfs else None

    @cached_property
    def msgdata(self) -> bytes:
        return self.base.read_file(f"{msgdata.MSGDATA}") if self.base.resolve(msgdata.MSGDATA) else self.base.read(0)

    def text(self, language: int = ENGLISH) -> list[list[str]]:
        cache = self.shared.setdefault("_text", {})
        if language not in cache:
            cache[language] = msgdata.files(self.msgdata, language)
        return cache[language]

    def table(self, name: str, section: int) -> list[bytes]:
        """Rows of nx/data/<name> (newest patch), e.g. table("fixed_persondata.bin", 0)."""
        return tables.rows(self.base.read_file(f"nx/data/{name}"), section)

    def skip(self, what: str) -> None:
        self.skipped.append(what)
        self.log(f"  skipped: {what}")


def run(ctx: Context, only: list[str] | None = None) -> dict[str, dict]:
    """Run each family's extractor; returns per-family file counts and skips for the manifest."""
    summary = {}
    for name in FAMILIES:
        if only and name not in only:
            continue
        module = importlib.import_module(f"{__name__}.{name}")
        before, skipped = len(ctx.out.files), len(ctx.skipped)
        ctx.log(f"{name}:")
        module.extract(ctx)
        summary[name] = {"files": len(ctx.out.files) - before, "skipped": ctx.skipped[skipped:]}
    return summary
