"""Dump detection uses only synthetic headers and indexes."""

import hashlib

from app.gamefiles import dump
from app.gamefiles.__main__ import main
from app.infrastructure.game_assets_import import scan
from helpers.fake_import import fake_dump


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


def test_a_1_2_dump_without_dlc_can_be_imported(tmp_path):
    fake_dump(tmp_path)
    report = scan(str(tmp_path))
    assert report["importable"] and report["supported"] and not report["problems"]
    assert not any(report["dlc"].values())
    assert not any(p["required"] for p in report["parts"] if p["id"] not in ("base", "update", "exefs"))


def test_another_version_of_the_game_is_refused(tmp_path):
    fake_dump(tmp_path)
    (tmp_path / "main").write_bytes(b"NSO0" + b"\0" * 60 + b"x" * 16)
    report = scan(str(tmp_path))
    assert not report["importable"] and not report["supported"]
    assert len(report["problems"]) == 1 and "787878" in report["problems"][0]


def test_a_dump_without_the_update_is_refused(tmp_path):
    fake_dump(tmp_path)
    (tmp_path / "patch4").rmdir()
    assert "Update 1.2.0 not found" in scan(str(tmp_path))["problems"][0]


def test_an_older_update_is_refused(tmp_path):
    fake_dump(tmp_path)
    (tmp_path / "patch4").rename(tmp_path / "patch3")
    assert "Update 1.2.0 not found" in scan(str(tmp_path))["problems"][0]


def test_a_dump_without_the_exefs_is_refused(tmp_path):
    fake_dump(tmp_path)
    (tmp_path / "main").unlink()
    report = scan(str(tmp_path))
    assert not report["importable"] and not report["supported"]
    assert "ExeFS not found" in report["problems"][0]


def test_the_command_line_stops_on_an_incomplete_dump(tmp_path, capsys):
    source = tmp_path / "dump"
    fake_dump(source)
    (source / "main").unlink()
    assert main(["extract", str(source), "--out", str(tmp_path / "out")]) == 2
    assert "ExeFS not found" in capsys.readouterr().err
    assert not (tmp_path / "out").exists()


def test_missing_base_returns_parts(tmp_path):
    (tmp_path / "patch4").mkdir()
    report = scan(str(tmp_path))
    assert report["romfs"] is None
    assert not report["importable"]
    assert "Base game not found" in report["problems"]
    assert not next(p for p in report["parts"] if p["id"] == "base")["found"]
    assert next(p for p in report["parts"] if p["id"] == "update")["found"]
