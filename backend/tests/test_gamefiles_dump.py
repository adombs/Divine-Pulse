"""Dump detection uses only synthetic headers and indexes."""

import hashlib

from app.gamefiles import dump
from app.infrastructure.game_assets_import import scan


def test_detects_arbitrary_names_and_prefers_supported_build(tmp_path, monkeypatch):
    base = tmp_path / "chosen" / "base"
    (base / "nx").mkdir(parents=True)
    (base / "DATA0.bin").write_bytes(b"index")
    (base / "DATA1.bin").write_bytes(b"")
    update = tmp_path / "chosen" / "update"
    (update / "patch4").mkdir(parents=True)
    index = b"a" * 33920
    dlc = tmp_path / "chosen" / "dlc"
    dlc.mkdir()
    (dlc / "DATA0.bin").write_bytes(index)
    (dlc / "DATA1.bin").write_bytes(b"")
    monkeypatch.setitem(dump.DLC_INDEX_HASHES, hashlib.sha256(index).hexdigest().upper(),
                        "010055D009F79001")
    for folder, build in (("a", "00" * 16), ("z", next(iter(dump.SUPPORTED_BUILDS)))):
        path = tmp_path / folder
        path.mkdir()
        (path / "main").write_bytes(b"NSO0" + b"\0" * 60 + bytes.fromhex(build))
    found = dump.find(tmp_path)
    assert found.romfs == base
    assert found.exefs == tmp_path / "z"
    assert found.dlc["cindered_shadows"] == dlc
    assert update in found.updates
    report = scan(str(tmp_path))
    assert report["importable"] and not report["problems"]
    assert next(p for p in report["parts"] if p["id"] == "update")["detail"] == "1.2.0"


def test_unsupported_build_reports_problem(tmp_path):
    (tmp_path / "nx").mkdir()
    (tmp_path / "DATA0.bin").write_bytes(b"")
    (tmp_path / "DATA1.bin").write_bytes(b"")
    (tmp_path / "main").write_bytes(b"NSO0" + b"\0" * 60 + b"x" * 16)
    report = scan(str(tmp_path))
    assert not report["importable"]
    assert "787878" in report["problems"][0]


def test_missing_base_returns_parts(tmp_path):
    (tmp_path / "patch4").mkdir()
    report = scan(str(tmp_path))
    assert report["romfs"] is None
    assert not report["importable"]
    assert "Base game not found" in report["problems"]
    assert not next(p for p in report["parts"] if p["id"] == "base")["found"]
    assert next(p for p in report["parts"] if p["id"] == "update")["found"]
