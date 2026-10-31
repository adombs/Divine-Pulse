"""The Windows system interface."""

from pathlib import Path

from app import system
from app.gamemem.emulators import EMULATORS, running


def test_data_dir(monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", "C:/Users/me/AppData/Local")
    assert system.data_dir("Divine Pulse") == Path("C:/Users/me/AppData/Local/Divine Pulse")


def test_every_emulator_has_a_name_here():
    for emulator in EMULATORS:
        assert emulator.executables and emulator.requirement
    assert [emulator.name for emulator in EMULATORS if emulator.tested] == ["Eden"]


def test_running_matches_names_to_emulators(monkeypatch):
    monkeypatch.setattr("app.gamemem.emulators.find_processes", lambda exes: [(42, "citron.exe")] if "citron.exe" in exes else [])
    assert [(emulator.name, pid) for emulator, pid in running()] == [("Citron", 42)]

