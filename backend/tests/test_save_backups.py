"""Game Saves (infrastructure/save_backups.py): snapshots of the whole save folder, kept and restored together."""

import os
from pathlib import Path

from app.domain.settings import Settings
import pytest

from app.infrastructure.save_backups import (
    LEGACY_FOLDER,
    TITLE_ID,
    GameRunning,
    SaveBackups,
    SnapshotError,
    eden_save_folders,
    program_save_folders,
)


class FakeSettings:
    def __init__(self, **values):
        self.value = Settings(**values)

    def get(self):
        return self.value


def write(path, data: bytes, mtime: int):
    path.write_bytes(data)
    os.utime(path, (mtime, mtime))


def snapshots(dest):
    """Each snapshot's kind and files, oldest first."""
    found = []
    for folder in sorted(p for p in dest.iterdir() if p.is_dir() and p.name != LEGACY_FOLDER):
        files = {f.relative_to(folder).as_posix(): f.read_bytes() for f in folder.rglob("*")
                 if f.is_file() and f.name != "snapshot.json"}
        found.append((folder.name.split(" ", 2)[2], files))
    return found


def make(tmp_path, keep=3, running=False, clock=None):
    """A save folder, where its snapshots go, and backups of it whose game is `running` (state["running"])."""
    saves, out = tmp_path / "saves", tmp_path / "backups"
    saves.mkdir(exist_ok=True)
    state = {"running": running}
    backups = SaveBackups(FakeSettings(save_backups=keep), out, lambda: [saves], clock=clock or (lambda: 2_000_000_000),
                          game_running=lambda: state["running"], sleep=lambda s: None)
    return saves, out / f"{tmp_path.name} - saves", backups, state


def test_finds_fe3h_saves_in_edens_user_folder(tmp_path):
    folder = tmp_path / "eden/nand/user/save/0000000000000000/5E31A69F7D0B95C5E5DFF1BC99BB27C7" / TITLE_ID
    folder.mkdir(parents=True)
    (folder.parent / "0100000000000000").mkdir()  # another game
    assert eden_save_folders(str(tmp_path)) == [folder]
    assert eden_save_folders(str(tmp_path / "missing")) == []


def test_finds_eden_s_saves_where_each_os_keeps_them(tmp_path, monkeypatch, as_platform):
    """macOS: Eden's own folder in Application Support, or the XDG data folder older builds used."""
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    as_platform("darwin")
    profile = "nand/user/save/0000000000000000/5E31A69F7D0B95C5E5DFF1BC99BB27C7"
    mac = tmp_path / "Library/Application Support/eden" / profile / TITLE_ID
    xdg = tmp_path / ".local/share/eden" / profile / TITLE_ID
    mac.mkdir(parents=True)
    xdg.mkdir(parents=True)
    assert eden_save_folders() == [mac, xdg]
    as_platform("linux")
    assert eden_save_folders() == [xdg]
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))
    as_platform("win32")
    assert eden_save_folders() == []


def test_zero_turns_backups_off_and_custom_folder_wins(tmp_path):
    saves, out = tmp_path / "mine", tmp_path / "backups"
    saves.mkdir()
    write(saves / "slot.bin", b"x", 1_000_000)
    settings = FakeSettings(save_backups=0, save_folder=str(saves))
    backups = SaveBackups(settings, out, lambda: [])
    assert backups.sources() == [saves]
    assert backups.back_up() == 0 and not out.exists()
    settings.value = Settings(save_backups=1, save_folder=str(saves))
    assert backups.back_up() == 1


def test_blank_save_folder_means_automatic():
    assert Settings(save_folder="  ").save_folder is None
    assert Settings().save_backups == 3


def test_finds_recomp_and_portable_eden_saves_beside_the_running_program(tmp_path):
    recomp = tmp_path / "FE3H Recomp" / "save" / "save_0"
    recomp.mkdir(parents=True)
    eden = tmp_path / "Eden" / "user/nand/user/save/0000000000000000/ABCD" / TITLE_ID
    eden.mkdir(parents=True)
    programs = [str(tmp_path / "FE3H Recomp" / "fe3hrecomp.exe"), str(tmp_path / "Eden" / "eden.exe")]
    assert program_save_folders(programs) == [recomp.parent, eden]


def test_remembers_save_folders_found_while_the_game_ran(tmp_path):
    saves = tmp_path / "FE3H Recomp" / "save"
    (saves / "save_0").mkdir(parents=True)
    write(saves / "save_0" / "slot00", b"s", 1_000_000)
    running = [[saves]]
    backups = SaveBackups(FakeSettings(), tmp_path / "backups", lambda: running[0])
    assert backups.back_up() == 1
    running[0] = []  # the game was closed
    assert SaveBackups(FakeSettings(), tmp_path / "backups", lambda: []).sources() == [saves]
    assert snapshots(tmp_path / "backups" / "FE3H Recomp - save") == [("Automatic", {"save_0/slot00": b"s"})]


def imkvdb(*entries: tuple[int, int]) -> bytes:
    """A Ryujinx save index with (program ID, save data ID) entries, 0x40-byte keys and values as Ryujinx writes."""
    import struct

    out = b"IMKV" + struct.pack("<II", 0, len(entries))
    for program, save in entries:
        out += b"IMEN" + struct.pack("<II", 0x40, 0x40)
        out += struct.pack("<Q", program).ljust(0x40, b"\0") + struct.pack("<Q", save).ljust(0x40, b"\0")
    return out


def test_finds_fe3h_in_a_ryujinx_save_index(tmp_path):
    from app.infrastructure.save_backups import _label, ryujinx_save_folders

    index = tmp_path / "bis/system/save/8000000000000000/0/imkvdb.arc"
    index.parent.mkdir(parents=True)
    index.write_bytes(imkvdb((0x0100000000001000, 0x2), (int(TITLE_ID, 16), 0x1)))
    fe3h = tmp_path / "bis/user/save/0000000000000001/0"
    fe3h.mkdir(parents=True)
    (tmp_path / "bis/user/save/0000000000000002/0").mkdir(parents=True)  # another game's
    assert ryujinx_save_folders(tmp_path) == [fe3h]
    assert _label(fe3h) == "Ryujinx - 0000000000000001"
    index.write_bytes(b"IMKV" + b"\0" * 4 + b"\x05\0\0\0" + b"IMEN")  # cut short: nothing, no error
    assert ryujinx_save_folders(tmp_path) == []
    assert ryujinx_save_folders(tmp_path / "missing") == []


def test_ryujinx_data_folders_on_each_platform(tmp_path, as_platform):
    from app.infrastructure.save_backups import ryujinx_roots
    from app.system.platform.macos import ASTRIS_CONTAINER

    as_platform("darwin")
    support = Path("Library") / "Application Support" / "Ryujinx"
    assert ryujinx_roots(tmp_path) == [tmp_path / support, tmp_path / ASTRIS_CONTAINER / support]
    as_platform("win32")
    assert ryujinx_roots(tmp_path, appdata="C:/Users/me/AppData/Roaming") == [Path("C:/Users/me/AppData/Roaming/Ryujinx")]


def test_finds_a_portable_ryujinx_s_saves_beside_it(tmp_path):
    portable = tmp_path / "Ryubing" / "portable"
    index = portable / "bis/system/save/8000000000000000/0/imkvdb.arc"
    index.parent.mkdir(parents=True)
    index.write_bytes(imkvdb((int(TITLE_ID, 16), 0x7)))
    saves = portable / "bis/user/save/0000000000000007/0"
    saves.mkdir(parents=True)
    assert program_save_folders([str(tmp_path / "Ryubing" / "Ryujinx.exe")]) == [saves]


def test_a_portable_eden_on_linux_is_found_once(tmp_path):
    saves = tmp_path / "start" / "user/nand/user/save/0000000000000000/ABCD" / TITLE_ID
    saves.mkdir(parents=True)
    programs = [str(tmp_path / "mount" / "eden"), str(tmp_path / "start" / "eden"), str(tmp_path / "start" / "eden")]
    assert program_save_folders(programs) == [saves]


def test_a_snapshot_holds_the_whole_folder_and_n_older_ones_are_kept(tmp_path):
    saves, dest, backups, _ = make(tmp_path, keep=2)
    write(saves / "system", b"sys", 1_000_000)
    for n in range(1, 5):
        write(saves / "slot00", b"v%d" % n, 1_000_000 + n * 100)
        assert backups.back_up() == 1
        assert backups.back_up() == 0  # unchanged: nothing new
    # The saves as they are now, and 2 older snapshots: each with every file in the folder.
    assert snapshots(dest) == [("Automatic", {"slot00": b"v%d" % n, "system": b"sys"}) for n in (2, 3, 4)]


def test_zero_turns_automatic_snapshots_off_but_back_up_now_still_works(tmp_path):
    saves, dest, backups, _ = make(tmp_path, keep=0)
    write(saves / "slot00", b"a", 1_000_000)
    assert backups.back_up() == 0 and not dest.exists()
    backups.take(backups.status()["saves"][0]["id"])
    assert snapshots(dest) == [("Manual", {"slot00": b"a"})]


def test_finders_files_are_not_backed_up(tmp_path):
    saves, dest, backups, _ = make(tmp_path, keep=1)
    write(saves / ".DS_Store", b"Bud1", 1_000_000)
    write(saves / "._data00.bin", b"\0\5\x16\7", 1_000_000)
    write(saves / "data00.bin", b"v1", 1_000_000)
    assert backups.back_up() == 1
    assert snapshots(dest) == [("Automatic", {"data00.bin": b"v1"})]
    write(saves / "data00.bin", b"v1", 1_000_100)  # touched, not changed
    assert backups.back_up() == 0
    write(saves / "data00.bin", b"v2", 1_000_200)
    assert backups.back_up() == 1
    write(saves / "data00.bin", b"v3", 1_000_300)
    assert backups.back_up() == 1
    assert [files for _, files in snapshots(dest)] == [{"data00.bin": b"v2"}, {"data00.bin": b"v3"}]


def test_waits_until_the_game_has_finished_writing(tmp_path):
    now = [1_000_001.0]
    saves, dest, backups, _ = make(tmp_path, clock=lambda: now[0])
    write(saves / "slot00", b"a", 1_000_000)
    assert backups.back_up() == 0  # written a second ago: the system file may follow
    write(saves / "system", b"s", 1_000_001)
    now[0] = 1_000_010
    assert backups.back_up() == 1
    assert snapshots(dest) == [("Automatic", {"slot00": b"a", "system": b"s"})]


def test_back_up_now_is_kept_and_restore_puts_the_whole_folder_back(tmp_path):
    saves, dest, backups, _ = make(tmp_path, keep=1)
    write(saves / "slot00", b"chapter 1", 1_000_000)
    write(saves / "suspend", b"bookmark 1", 1_000_000)
    write(saves / "system", b"sys 1", 1_000_000)
    source = backups.status()["saves"][0]["id"]
    manual = backups.take(source)
    assert manual["kind"] == "manual" and manual["files"] == ["slot00", "suspend", "system"]
    # Play on: of the automatic snapshots only 2 stay, and the manual one is still there.
    for n in (2, 3, 4):
        write(saves / "slot00", b"chapter %d" % n, 1_000_000 + n)
        write(saves / "suspend", b"bookmark %d" % n, 1_000_000 + n)
        write(saves / "slot01", b"new slot", 1_000_000 + n)
        assert backups.back_up() == 1
    kinds = [kind for kind, _ in snapshots(dest)]
    assert kinds.count("Manual") == 1 and kinds.count("Automatic") == 2

    result = backups.restore(source, manual["id"])
    assert {p.name: p.read_bytes() for p in saves.iterdir()} == {
        "slot00": b"chapter 1", "suspend": b"bookmark 1", "system": b"sys 1"}  # slot01 came later: gone
    assert (saves / "slot00").stat().st_mtime == 1_000_000
    # The saves as they stood just before are kept, until deleted.
    kept = next(files for kind, files in snapshots(dest) if kind == "Before restore")
    assert kept == {"slot00": b"chapter 4", "suspend": b"bookmark 4", "slot01": b"new slot", "system": b"sys 1"}
    assert result["kept"]["kind"] == "restore" and result["restored"]["id"] == manual["id"]
    # A restore isn't a new state to snapshot.
    assert backups.back_up() == 0
    backups.restore(source, result["kept"]["id"])
    assert (saves / "slot01").read_bytes() == b"new slot"


def test_the_page_lists_snapshots_newest_first_with_what_changed(tmp_path):
    saves, dest, backups, _ = make(tmp_path)
    write(saves / "slot00", b"a", 1_000_000)
    write(saves / "system", b"s", 1_000_000)
    backups.back_up()
    write(saves / "slot00", b"b", 1_000_100)
    backups.back_up()
    status = backups.status()
    assert status["game_running"] is False
    [save] = status["saves"]
    assert save["found"] and save["path"] == str(saves)
    newest, oldest = save["snapshots"]
    assert newest["changed"] == ["slot00"] and oldest["changed"] is None
    assert newest["size"] == 2 and newest["files"] == ["slot00", "system"]
    # The folder holds the newest now; a new slot is told apart from a changed one.
    assert newest["current"] and not oldest["current"]
    assert save["current"]["files"] == ["slot00", "system"] and save["current"]["time"]
    write(saves / "slot01", b"n", 1_000_200)
    backups.back_up()
    added = backups.status()["saves"][0]["snapshots"][0]
    assert added["added"] == ["slot01"] and added["removed"] == [] and added["changed"] == ["slot01"]


def test_no_restore_while_the_game_runs(tmp_path):
    saves, dest, backups, state = make(tmp_path)
    write(saves / "slot00", b"a", 1_000_000)
    source = backups.status()["saves"][0]["id"]
    snap = backups.take(source)
    state["running"] = True
    write(saves / "slot00", b"b", 1_000_100)
    with pytest.raises(GameRunning):
        backups.restore(source, snap["id"])
    assert (saves / "slot00").read_bytes() == b"b"


def test_a_damaged_snapshot_restores_nothing(tmp_path):
    saves, dest, backups, _ = make(tmp_path)
    write(saves / "slot00", b"a", 1_000_000)
    write(saves / "system", b"s", 1_000_000)
    source = backups.status()["saves"][0]["id"]
    snap = backups.take(source)
    write(saves / "slot00", b"b", 1_000_100)
    (dest / snap["id"] / "system").write_bytes(b"corrupt")
    with pytest.raises(SnapshotError, match="damaged"):
        backups.restore(source, snap["id"])
    assert (saves / "slot00").read_bytes() == b"b"


def test_unknown_snapshots_and_folders_are_refused(tmp_path):
    saves, dest, backups, _ = make(tmp_path)
    write(saves / "slot00", b"a", 1_000_000)
    source = backups.status()["saves"][0]["id"]
    backups.take(source)
    for bad in ("..", "../..", "nope", ""):
        with pytest.raises(SnapshotError):
            backups.restore(source, bad)
        with pytest.raises(SnapshotError):
            backups.delete(source, bad)
    with pytest.raises(SnapshotError):
        backups.take("../elsewhere")


def test_delete_removes_one_snapshot(tmp_path):
    saves, dest, backups, _ = make(tmp_path)
    write(saves / "slot00", b"a", 1_000_000)
    source = backups.status()["saves"][0]["id"]
    snap = backups.take(source)
    backups.delete(source, snap["id"])
    assert backups.status()["saves"][0]["snapshots"] == []


def test_single_file_copies_from_1_5_2_are_moved_aside(tmp_path):
    saves, dest, backups, _ = make(tmp_path)
    old = dest / "slot00"
    old.mkdir(parents=True)
    write(old / "2026-11-18 101010 slot00", b"old", 1_000_000)
    write(saves / "slot00", b"a", 1_000_000)
    assert backups.back_up() == 1
    assert (dest / LEGACY_FOLDER / "slot00" / "2026-11-18 101010 slot00").read_bytes() == b"old"
    assert [kind for kind, _ in snapshots(dest)] == ["Automatic"]


def test_snapshots_through_the_api(tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    saves = tmp_path / "saves"
    saves.mkdir()
    write(saves / "slot00", b"one", 1_000_000)
    app = create_app(tmp_path / "data", background=False)
    running = {"now": False}
    app.state.runtime.save_backups._game_running = lambda: running["now"]
    with TestClient(app) as c:
        assert c.put("/api/settings", json={"save_folder": str(saves)}).status_code == 200
        [save] = c.get("/api/save-backups").json()["saves"]
        taken = c.post("/api/save-backups/snapshots", json={"save": save["id"]}).json()
        assert taken["kind"] == "manual"
        write(saves / "slot00", b"two", 1_000_100)
        running["now"] = True
        refused = c.post("/api/save-backups/restore", json={"save": save["id"], "snapshot": taken["id"]})
        assert refused.status_code == 409 and "Close the game" in refused.json()["detail"]
        running["now"] = False
        done = c.post("/api/save-backups/restore", json={"save": save["id"], "snapshot": taken["id"]}).json()
        assert (saves / "slot00").read_bytes() == b"one" and done["kept"]["kind"] == "restore"
        assert c.post("/api/save-backups/delete", json={"save": save["id"], "snapshot": "../x"}).status_code == 409
        assert c.post("/api/save-backups/delete", json={"save": save["id"], "snapshot": taken["id"]}).status_code == 200
        kinds = [s["kind"] for s in c.get("/api/save-backups").json()["saves"][0]["snapshots"]]
        assert kinds == ["restore"]
