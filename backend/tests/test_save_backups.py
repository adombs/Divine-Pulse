"""Backup Game Saves (infrastructure/save_backups.py): copies of each save, keeping N older versions."""

import os
from pathlib import Path

from app.domain.settings import Settings
from app.infrastructure.save_backups import TITLE_ID, SaveBackups, eden_save_folders, program_save_folders


class FakeSettings:
    def __init__(self, **values):
        self.value = Settings(**values)

    def get(self):
        return self.value


def write(path, data: bytes, mtime: int):
    path.write_bytes(data)
    os.utime(path, (mtime, mtime))


def copies(dest):
    return sorted(p.read_bytes() for p in dest.iterdir())


def test_finds_fe3h_saves_in_edens_user_folder(tmp_path):
    folder = tmp_path / "eden/nand/user/save/0000000000000000/5E31A69F7D0B95C5E5DFF1BC99BB27C7" / TITLE_ID
    folder.mkdir(parents=True)
    (folder.parent / "0100000000000000").mkdir()  # another game
    assert eden_save_folders(str(tmp_path)) == [folder]
    assert eden_save_folders(str(tmp_path / "missing")) == []


def test_keeps_the_current_save_and_n_older_versions(tmp_path):
    saves, out = tmp_path / "saves", tmp_path / "backups"
    saves.mkdir()
    backups = SaveBackups(FakeSettings(save_backups=2), out, lambda: [saves])
    save = saves / "data00.bin"
    for n in range(1, 5):
        write(save, b"v%d" % n, 1_000_000 + n * 100)
        assert backups.back_up() == 1
        assert backups.back_up() == 0  # unchanged: nothing new
    dest = out / f"{tmp_path.name} - saves" / "data00.bin"
    assert copies(dest) == [b"v2", b"v3", b"v4"]  # the save as it is now, and 2 older versions


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
    assert copies(tmp_path / "backups" / "FE3H Recomp - save" / "save_0" / "slot00") == [b"s"]


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


def test_ryujinx_data_folders_on_each_platform(tmp_path, monkeypatch):
    from app.infrastructure.save_backups import ASTRIS_CONTAINER, ryujinx_roots

    monkeypatch.setattr("sys.platform", "darwin")
    support = Path("Library") / "Application Support" / "Ryujinx"
    assert ryujinx_roots(tmp_path) == [tmp_path / support, tmp_path / ASTRIS_CONTAINER / support]
    monkeypatch.setattr("sys.platform", "win32")
    assert ryujinx_roots(tmp_path, appdata="C:/Users/me/AppData/Roaming") == [Path("C:/Users/me/AppData/Roaming/Ryujinx")]


def test_finds_a_portable_ryujinx_s_saves_beside_it(tmp_path):
    portable = tmp_path / "Ryubing" / "portable"
    index = portable / "bis/system/save/8000000000000000/0/imkvdb.arc"
    index.parent.mkdir(parents=True)
    index.write_bytes(imkvdb((int(TITLE_ID, 16), 0x7)))
    saves = portable / "bis/user/save/0000000000000007/0"
    saves.mkdir(parents=True)
    assert program_save_folders([str(tmp_path / "Ryubing" / "Ryujinx.exe")]) == [saves]


def test_finders_files_are_not_backed_up_and_dont_count_as_versions(tmp_path):
    saves, out = tmp_path / "saves", tmp_path / "backups"
    saves.mkdir()
    backups = SaveBackups(FakeSettings(save_backups=1), out, lambda: [saves])
    write(saves / ".DS_Store", b"Bud1", 1_000_000)
    write(saves / "._data00.bin", b"\0\5\x16\7", 1_000_000)
    write(saves / "data00.bin", b"v1", 1_000_000)
    assert backups.back_up() == 1
    dest = out / f"{tmp_path.name} - saves"
    assert sorted(p.name for p in dest.iterdir()) == ["data00.bin"]
    # Finder shows the copies: its .DS_Store is newer than every copy, and mustn't look like the latest version.
    write(dest / "data00.bin" / ".DS_Store", b"Bud1", 2_000_000)
    write(saves / "data00.bin", b"v1", 1_000_100)  # touched, not changed
    assert backups.back_up() == 0
    write(saves / "data00.bin", b"v2", 1_000_200)
    assert backups.back_up() == 1
    write(saves / "data00.bin", b"v3", 1_000_300)
    assert backups.back_up() == 1
    kept = dest / "data00.bin"
    assert sorted(p.read_bytes() for p in kept.iterdir() if p.name != ".DS_Store") == [b"v2", b"v3"]
    assert (kept / ".DS_Store").read_bytes() == b"Bud1"
