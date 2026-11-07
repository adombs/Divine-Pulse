"""The Windows system interface."""

from pathlib import Path

from app import system
from app.gamemem.emulators import running


def test_data_dir(monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", "C:/Users/me/AppData/Local")
    assert system.data_dir("Divine Pulse") == Path("C:/Users/me/AppData/Local/Divine Pulse")


def test_running_only_looks_for_eden(monkeypatch):
    def processes(names):
        assert names == {"eden.exe"}
        return [(42, "eden.exe")]

    monkeypatch.setattr("app.gamemem.emulators.find_processes", processes)
    assert [(emulator.name, pid) for emulator, pid in running()] == [("Eden", 42)]
