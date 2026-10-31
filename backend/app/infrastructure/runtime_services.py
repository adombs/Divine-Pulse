"""Operating-system and one-shot memory adapters used by application operations."""

from __future__ import annotations

from pathlib import Path

from .. import system
from ..gamemem.fe3h import GameMemory, GameMemoryError, decode_roster


class MemoryCheck:
    def check(self) -> dict:
        memory = GameMemory()
        try:
            snapshot = memory.read(battle=False)
            count = len(decode_roster(snapshot.roster))
            where = memory.emulator.name if memory.emulator else "the emulator"
            return {
                "ok": True,
                "message": f"Connected to FE3H {memory.version.name} in {where}: {count} unit{'s' if count != 1 else ''} in your army.",
            }
        except GameMemoryError as exc:
            return {"ok": False, "message": str(exc)}
        except OSError as exc:
            return {"ok": False, "message": f"Can't read game memory: {exc}"}
        finally:
            memory.close()


class SystemAdapter:
    @staticmethod
    def open_folder(folder: Path) -> None:
        folder.mkdir(parents=True, exist_ok=True)
        system.open_folder(folder)
