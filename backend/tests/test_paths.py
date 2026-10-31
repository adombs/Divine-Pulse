"""Data folder selection."""

from app.infrastructure import paths


def test_data_dir_override(tmp_path, monkeypatch):
    monkeypatch.setenv("DIVINE_PULSE_DATA_DIR", str(tmp_path))
    assert paths.default_data_dir() == tmp_path


def test_frozen_data_dir(tmp_path, monkeypatch):
    monkeypatch.delenv("DIVINE_PULSE_DATA_DIR", raising=False)
    monkeypatch.setattr(paths, "FROZEN", True)
    monkeypatch.setattr(paths, "INSTALL_DIR", tmp_path)
    monkeypatch.setattr(paths, "data_dir", lambda name: tmp_path / name)
    assert paths.default_data_dir() == tmp_path / "Divine Pulse"
    (tmp_path / "data").mkdir()
    assert paths.default_data_dir() == tmp_path / "data"


def test_source_data_dir(monkeypatch):
    monkeypatch.delenv("DIVINE_PULSE_DATA_DIR", raising=False)
    monkeypatch.setattr(paths, "FROZEN", False)
    assert paths.default_data_dir() == paths.PROJECT_ROOT / "data"
