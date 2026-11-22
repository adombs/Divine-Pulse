"""Reading Eden and Ryubing on Linux (system/memory_linux.py): their mappings and names from made-up /proc files, and on
Linux itself the whole reader against stand-ins that map memory as the emulators do (helpers/fake_emulator.py)."""

import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from app.gamemem import fe3h
from app.gamemem import history as h
from app.gamemem.emulators import EMULATORS, FOUR_GIB, Fastmem, running
from app.gamemem.fe3h import GameMemory, GameMemoryError
from app.gamemem.readers import emulators_for
from app.gamemem.ryujinx import BLOCK, RYUJINX, RYUJINX_EMULATORS, runs
from app.system import memory_linux
from app.system.memory import AccessDenied, Region, matches
from helpers.synthetic_roster import NAME, ROSTER

from test_history import unit
from test_ryujinx_reader import FIRST, FIRST_PA, HEAP_PA, MAIN_PA, MAIN_VA, TURN2, TURN2_PA, ryujinx_ram

on_linux = pytest.mark.skipif(sys.platform != "linux", reason="needs Linux")
posix = pytest.mark.skipif(sys.platform == "win32", reason="makes symbolic links")

EDEN_MAPS = b"""\
00400000-00452000 r-xp 00000000 08:02 173521                             /usr/bin/eden
7f0000000000-7f0100000000 rw-s 00000000 00:01 2061                       /memfd:HostMemory (deleted)
7f0180000000-7f0180004000 r--s 34000000 00:01 2061                       /memfd:HostMemory (deleted)
7f0180004000-7f0181000000 rw-s 34004000 00:01 2061                       /memfd:HostMemory (deleted)
7f0200000000-7f0200001000 ---p 00000000 00:00 0
7f0300000000-7f0300100000 rw-s 00000000 00:1a 77                         /Ryujinx-a1B2c3 (deleted)
7f0400000000-7f0400010000 rw-s 100000000 00:06 411                       /dev/dri/renderD128
7f0500000000-7f0500010000 rw-p 00000000 00:00 0                          [heap]
"""


# Mappings


@posix
def test_mappings_are_read_from_proc():
    maps = memory_linux.parse_maps(EDEN_MAPS)
    assert len(maps) == 8
    block, view = maps[1], maps[3]
    assert (block.base, block.end - block.base, block.shared, block.writable) == (0x7F0000000000, 4 << 30, True, True)
    assert view.offset == 0x34004000 and view.key == block.key == (1, 2061)
    assert (maps[2].readable, maps[2].writable) == (True, False)
    # The emulators' memory, also as a sandbox's own /dev/shm is named from outside it; not a graphics card's.
    assert [m.shared_memory for m in maps] == [False, True, True, True, False, True, False, False]


def test_regions_of_the_same_memory_are_joined_and_neighbours_are_not():
    """Linux places unrelated memory right beside Ryujinx's RAM block: `locate` counts from the block's own start."""
    ram = [Region(0x2000, 0x1000, True, True, "1:5", 0), Region(0x3000, 0x1000, True, False, "1:5", 0x1000)]
    below = Region(0x1000, 0x1000, False, True, "")
    above = [Region(0x4000, 0x1000, True, True, "1:6", 0x2000), Region(0x5000, 0x1000, True, True, "1:6", 0)]
    assert runs([below, *ram, *above]) == [(0x1000, 0x2000), (0x2000, 0x4000), (0x4000, 0x5000), (0x5000, 0x6000)]
    anonymous = [Region(0, 0x10, False, True, ""), Region(0x10, 0x10, False, True, "")]
    assert runs(anonymous) == [(0, 0x10), (0x10, 0x20)]


def test_matches_far_apart_are_found_without_looking_at_every_byte():
    data = bytes(0x800) + b"MOD0" + bytes(0x7FC) + b"MOD0" + bytes(0x800)
    assert list(matches(data, b"MOD0")) == [0x800, 0x1000]
    assert list(matches(data, b"MOD0", base=0, alignment=0x1000)) == [0x1000]
    assert list(matches(data, b"MOD0", base=0x800, alignment=0x1000)) == [0x800]


def test_eden_s_main_program_is_found_when_linux_lists_it_with_the_module_before_it():
    class Merged:
        pid = 1

        def regions(self):
            return iter([Region(0x10000, FOUR_GIB, True, True, "1:1", 0),  # the whole block
                         Region(0x200000000, 0x10000, True, True, "1:1", 0x10000),
                         Region(0x300000000, 0x10000, True, False, "1:1", 0x50000)])

        def read(self, address, size):
            data = bytearray(0x10000)
            data[0x4000 : 0x4000 + len(fe3h.MODULE_HEADER)] = fe3h.MODULE_HEADER
            at = address - 0x300000000
            return bytes(data[at : at + size]) if 0 <= at and at + size <= len(data) else None

    found = list(Fastmem().main_candidates(Merged(), fe3h.MODULE_HEADER))
    assert found == [0x10000, 0x200000000, 0x300000000, 0x300004000]  # the regions' starts, then the header itself


# Finding the emulators


def process(proc: Path, pid: int, exe: str, argv: list[str], comm: str, environ: str = "", cwd: str = "/") -> None:
    entry = proc / str(pid)
    entry.mkdir()
    (entry / "exe").symlink_to(exe)
    (entry / "cwd").symlink_to(cwd)
    (entry / "cmdline").write_bytes(b"\0".join(a.encode() for a in argv) + b"\0")
    (entry / "comm").write_text(comm + "\n")
    (entry / "environ").write_bytes(environ.encode())


@pytest.fixture
def proc(tmp_path, monkeypatch, as_platform):
    as_platform("linux")
    folder = tmp_path / "proc"
    folder.mkdir()
    monkeypatch.setattr(memory_linux, "PROC", folder)
    return folder


@posix
@pytest.mark.parametrize(("exe", "argv", "comm", "expected"), [
    ("/usr/bin/eden", ["eden"], "eden", "Eden"),
    ("/app/bin/eden", ["/app/bin/eden"], "eden", "Eden"),  # Flatpak
    ("/opt/eden/bin/eden (deleted)", ["./eden"], "eden", "Eden"),  # updated while it runs
    ("/tmp/.mount_Eden/sharun", ["/tmp/.mount_Eden/bin/eden"], "sharun", "Eden"),  # an AppImage's loader
    ("/tmp/.mount_Eden/shared/lib/ld-linux-x86-64.so.2", ["ld-linux-x86-64"], "eden", "Eden"),
    ("/nix/store/x-eden/bin/.eden-wrapped", ["eden"], ".eden-wrapped", "Eden"),
    ("/usr/bin/eden-cli", ["eden-cli", "game.nsp"], "eden-cli", "Eden"),
    ("/opt/Ryubing/Ryujinx", ["/opt/Ryubing/Ryujinx"], "Ryujinx", RYUJINX.name),
    ("/usr/share/dotnet/dotnet", ["dotnet", "/usr/lib/ryujinx/Ryujinx.dll"], "dotnet", RYUJINX.name),
    ("/home/me/Eden-Linux.AppImage", ["Eden-Linux.AppImage"], "Eden-Linux.AppI", None),  # what mounts the AppImage
    ("/usr/bin/dotnet", ["dotnet", "Other.dll"], "dotnet", None),
    ("/usr/bin/edenfs", ["edenfs"], "edenfs", None),
])
def test_emulators_are_found_however_they_were_installed(proc, exe, argv, comm, expected):
    process(proc, 42, exe, argv, comm)
    (proc / "43").mkdir()  # another user's: its exe can't be read
    (proc / "self").mkdir()
    found = running(emulators_for("auto"))
    assert [(e.name, pid) for e, pid in found] == ([(expected, 42)] if expected else [])


@posix
def test_a_program_that_may_be_an_emulator_is_noted_in_the_log(proc, caplog):
    process(proc, 42, "/opt/x/ryujinx-canary-launcher", ["x"], "x")
    process(proc, 43, "/usr/bin/bash", ["bash"], "bash")
    memory = GameMemory(emulators_for("auto"))
    with caplog.at_level("INFO"):
        for _ in range(3):
            with pytest.raises(GameMemoryError):
                memory.read()
    assert [r.message for r in caplog.records] == ["Not recognised as an emulator: ryujinx-canary-launcher, x"]  # once


@posix
def test_windows_programs_are_not_looked_for_on_linux(proc):
    process(proc, 42, "/usr/bin/wine64-preloader", ["C:\\eden\\eden.exe"], "eden.exe")
    assert running(EMULATORS) == []
    assert [e.name for e in emulators_for("auto")] == ["Eden", RYUJINX.name]


def test_a_mac_is_not_told_to_start_eden(as_platform):
    as_platform("darwin")
    assert [e.name for e in emulators_for("auto")] == [RYUJINX.name]


@posix
def test_portable_folders_are_beside_the_appimage_or_where_it_was_started(proc):
    process(proc, 42, "/tmp/.mount_Eden/bin/eden", ["eden"], "eden", "HOME=/home/me\0APPIMAGE=/games/Eden.AppImage\0",
            cwd="/home/me/start")
    process(proc, 43, "/opt/Ryubing/Ryujinx", ["Ryujinx"], "Ryujinx", cwd="/opt/Ryubing")
    assert memory_linux.process_paths({"eden"}) == ["/tmp/.mount_Eden/bin/eden", "/games/eden", "/home/me/start/eden"]
    assert memory_linux.process_paths({"ryujinx"}) == ["/opt/Ryubing/Ryujinx"]


# Reading stand-in emulators


class Stand:
    """A stand-in emulator, started so that it isn't this process's child (a real emulator isn't): Yama's ptrace_scope
    then applies to it."""

    def __init__(self, kind: str, name: str, image: Path, views=()):
        script = Path(__file__).parent / "helpers" / "fake_emulator.py"
        command = [sys.executable, str(script), kind, name, str(image)]
        for address, offset, size, access in views:
            command += [hex(address), hex(offset), hex(size), access]
        theirs, self.input = os.pipe()
        out, out_theirs = os.pipe()
        # This one ends at once, leaving the stand-in to init.
        fork = "import os, sys; os._exit(0) if os.fork() else os.execv(sys.argv[1], sys.argv[1:])"
        subprocess.run([sys.executable, "-c", fork, *command], stdin=theirs, stdout=out_theirs, check=True, timeout=30)
        os.close(out_theirs)
        os.close(theirs)
        with os.fdopen(out) as lines:
            first = lines.readline().strip()
        assert first, "the stand-in didn't start"
        self.pid = int(first)

    def stop(self):
        if self.input is not None:
            os.close(self.input)
            self.input = None
            deadline = time.monotonic() + 10
            while Path(f"/proc/{self.pid}").exists() and time.monotonic() < deadline:
                time.sleep(0.02)


@pytest.fixture
def stand(tmp_path, monkeypatch):
    started = []

    def start(kind: str, image: bytes, views=()) -> Stand:
        path = tmp_path / "ram"
        path.write_bytes(image)
        name = "ryujinx" if kind.startswith("ryujinx") else "eden"
        started.append(Stand(kind, name, path, views))
        # Only the stand-in, not an emulator this computer happens to run.
        real = memory_linux.find_processes
        monkeypatch.setattr(memory_linux, "find_processes", lambda names: [x for x in real(names) if x[0] == started[-1].pid])
        return started[-1]

    yield start
    for s in started:
        s.stop()


MAIN_SIZE = 0x02BD0000 - MAIN_PA  # up to the history's heap
EDEN_VIEWS = [
    (MAIN_VA - 0x4000, MAIN_PA - 0x8000, 0x4000, "rw"),  # the module before it, elsewhere in the block
    (MAIN_VA, MAIN_PA, 0x1000000, "r"),
    (MAIN_VA + 0x1000000, MAIN_PA + 0x1000000, MAIN_SIZE - 0x1000000, "rw"),
    (FIRST // BLOCK * BLOCK, FIRST_PA // BLOCK * BLOCK, BLOCK, "rw"),
    (TURN2 // BLOCK * BLOCK, TURN2_PA // BLOCK * BLOCK, BLOCK, "rw"),
    (0x2200000000, HEAP_PA // BLOCK * BLOCK, BLOCK, "rw"),
]
# The module before it is right before it in the block too, and may be written as well: Linux lists them as one.
MERGED_VIEWS = [(MAIN_VA - 0x4000, MAIN_PA - 0x4000, MAIN_SIZE + 0x4000, "rw"), *EDEN_VIEWS[3:]]


def check_the_game_is_read(memory: GameMemory) -> None:
    snapshot = memory.read(battle=False)
    assert snapshot.roster == ROSTER and snapshot.player_name == NAME
    copies = memory._find_battle_copies(snapshot.roster)
    assert len(copies) == 1
    memory._copies = copies
    units = [unit(500, True, 1, 27, 33, character=22), unit(520, False, 1, 8, 41)]
    entries, start = memory.battle_history(units)
    assert [(e.turn, e.phase_start) for e in entries] == [(1, True), (1, False), (2, True)]
    assert entries[2].units[1] == h.HistoryUnit(None, 20, 41, 1, 8) and start == 500


def allocated(pid: int) -> int:
    """Bytes of shared memory the process's RAM block takes up."""
    maps = memory_linux.parse_maps(Path(f"/proc/{pid}/maps").read_bytes())
    key = next(m.key for m in maps if m.shared_memory and m.end - m.base == 4 << 30)
    for fd in os.listdir(f"/proc/{pid}/fd"):
        found = os.stat(f"/proc/{pid}/fd/{fd}")
        if (memory_linux._device(found.st_dev), found.st_ino) == key:
            return found.st_blocks * 512
    raise AssertionError("no RAM block")


def refuse(*_args):
    raise PermissionError(1, "Operation not permitted")


@on_linux
@pytest.mark.parametrize("direct", [True, False], ids=["allowed", "refused"])
@pytest.mark.parametrize(("kind", "views", "emulators"), [
    ("eden", EDEN_VIEWS, EMULATORS), ("eden-merged", MERGED_VIEWS, EMULATORS), ("ryujinx", EDEN_VIEWS, RYUJINX_EMULATORS),
])
def test_the_game_is_read_from_the_emulator_s_shared_memory(stand, monkeypatch, kind, views, emulators, direct):
    """Also when the system refuses to read its memory directly, as most distributions do (ptrace_scope 1), and without
    making the emulator's untouched memory take up room."""
    if not direct:
        monkeypatch.setattr(memory_linux, "_process_vm_readv", refuse)
    emulator = stand(kind, ryujinx_ram(), views)
    before = allocated(emulator.pid)
    memory = GameMemory(emulators)
    check_the_game_is_read(memory)
    assert memory.emulator is emulators[0]
    assert allocated(emulator.pid) == before < 128 << 20
    memory.close()


@on_linux
def test_a_program_that_is_not_a_child_is_read_whatever_ptrace_scope_is(stand):
    emulator = stand("eden", ryujinx_ram(), EDEN_VIEWS)
    process = memory_linux.Process(emulator.pid)
    scope = Path("/proc/sys/kernel/yama/ptrace_scope")
    if scope.exists() and int(scope.read_text()) >= 1 and os.geteuid() != 0:
        assert not process._direct  # the system does refuse: only the shared memory is read
        assert all(r.mapped for r in process.regions())
    assert any(r.mapped and r.size == 4 << 30 for r in process.regions())
    process.close()
    check_the_game_is_read(GameMemory(EMULATORS))


@on_linux
def test_ryubing_s_software_memory_mode_is_explained_when_it_cannot_be_read(stand, monkeypatch):
    stand("ryujinx-software", ryujinx_ram())
    monkeypatch.setattr(memory_linux, "_process_vm_readv", refuse)
    with pytest.raises(GameMemoryError, match="Memory Manager Mode"):
        GameMemory(RYUJINX_EMULATORS).read()


@on_linux
def test_an_emulator_without_the_game_is_not_a_permission_problem(stand, monkeypatch, caplog):
    stand("eden", b"", [(0x8000000, 0, 0x1000, "r")])
    monkeypatch.setattr(memory_linux, "_process_vm_readv", refuse)
    memory = GameMemory(EMULATORS)
    with caplog.at_level("INFO"):
        for _ in range(2):
            with pytest.raises(GameMemoryError, match="isn't running in Eden"):
                memory.read()
    # Enough in the log to see why, in a player's report.
    (noted,) = [r.message for r in caplog.records if "wasn't found" in r.message]
    assert "eden" in noted and "direct reads refused" in noted
    assert "/memfd:HostMemory (deleted) (4096 MiB in 2 mapping(s), opened)" in noted


@on_linux
def test_the_emulator_ending_is_noticed_and_its_memory_let_go(stand, monkeypatch):
    emulator = stand("eden", ryujinx_ram(), EDEN_VIEWS)
    process = memory_linux.Process(emulator.pid)
    region = next(r for r in process.regions() if r.mapped)
    assert process.alive() and process.read(region.base, 16) is not None
    assert any(fd is not None for fd in process._files.values())
    emulator.stop()
    assert not process.alive()
    monkeypatch.setattr(memory_linux, "MAPS_TTL_S", 0.0)
    assert process.read(region.base, 16) is None
    assert process._files == {} and list(process.regions()) == []
    process.close()
    with pytest.raises(OSError):
        memory_linux.Process(emulator.pid)


@on_linux
def test_another_user_s_process_is_refused():
    if os.geteuid() == 0:
        pytest.skip("root can read every process")
    with pytest.raises(AccessDenied):
        memory_linux.Process(1)


@on_linux
def test_reads_span_mappings_and_stop_at_gaps(stand):
    emulator = stand("eden", ryujinx_ram(), EDEN_VIEWS)
    process = memory_linux.Process(emulator.pid)
    main = next(r for r in process.regions() if r.mapped and r.offset == MAIN_PA)
    whole = process.read(main.base + main.size - 8, 16)  # the code's view and the data's
    image = ryujinx_ram()
    at = MAIN_PA + main.size - 8
    assert whole == image[at : at + 16]
    assert process.read(main.base, 0) == b"" and process.read(-1, 4) is None
    assert process.read(0, 16) is None
    assert process.search(main.base, main.size, fe3h.MODULE_HEADER, 0x1000) == [main.base]
    process.close()
    assert process.read(main.base, 4) is None and not process.alive()
