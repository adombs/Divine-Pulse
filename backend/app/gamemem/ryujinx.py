"""Locate the game in Ryujinx and its forks: Ryubing (Windows, macOS, Linux) and Astris (macOS).

Ryujinx emulates the Switch's RAM as one block of its own memory (4 GiB, or 6/8/12 GiB with the expanded-DRAM
setting): a Switch *physical* address `pa` is at host address `ram + pa`. How the game's *virtual* addresses map
onto it depends on the CPU backend: Apple's Hypervisor (the default on Apple silicon, so Astris's) keeps the page
tables to itself, and the "software" and "host mapped" modes keep their own. None is a single offset like Eden's
fastmem, so the tracker works from the RAM block alone, which every mode has:

- The main program is found by searching the block for its header (it doesn't start a region). It is loaded into
  one physically contiguous run, so its global data and the roster are read at fixed offsets from it, as on Eden.
- The units' battle copies are found by searching the block, as on Eden.
- The battle history is a linked list of virtual addresses. The Switch kernel maps the game's heap in 2 MiB blocks
  (a virtual address and its physical address agree below 2 MiB), so each 2 MiB block of virtual addresses has one
  offset to the RAM block, found once by trying every 2 MiB-aligned place an entry could be (`locate`) and kept
  while the game runs.

Seen live on Astris 1.0.32 (macOS, Hypervisor): the RAM block at host 0x7000000000 (4 GiB, in 128 MiB regions whose
macOS share mode varies with use), FE3H 1.2.0's main program at RAM + 0x34004000 for virtual 0x8004000, history
entries at virtual 0x21_4510_xxxx.

On Linux the RAM block is one mapping of an unlinked /dev/shm/Ryujinx-* file (the default "host" memory modes; from
Ryubing's MemoryManagementUnix.cs), read through the file (memory_linux.py). The modes' second views of it, at the
game's virtual addresses, are smaller, so the block is found first.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterable

from ..system.memory import ProcessMemory, Region, search
from .emulators import Emulator

GIB = 1 << 30
PAGE = 0x1000
BLOCK = 1 << 21  # the Switch kernel's large page: virtual and physical addresses agree below it
SMALL_BLOCK = 1 << 16  # the next size down, tried when an address isn't found at BLOCK alignment
LARGEST_RAM = 12 * GIB
# Regions larger than this are address-space reservations (Ryujinx's own 39-bit guest address space when host
# mapped, .NET's), not memory to search.
LARGEST_REGION = 64 * GIB


def runs(regions: Iterable[Region]) -> list[tuple[int, int]]:
    """(start, end) of each stretch of back-to-back regions that are parts of the same memory. (Linux places unrelated
    memory right beside the RAM block, whose start `locate` counts from: Region.continues tells them apart.)"""
    out: list[tuple[int, int]] = []
    before: Region | None = None
    for r in regions:
        if before is not None and r.continues(before):
            out[-1] = (out[-1][0], r.base + r.size)
        else:
            out.append((r.base, r.base + r.size))
        before = r
    return out


class GuestRam:
    """Ryujinx's emulated RAM (module docstring). Remembers, per process, where the RAM block is once the main
    program has been found in it."""

    paged = True  # virtual addresses are found block by block (locate), not at one arena offset

    def __init__(self) -> None:
        self._ram: dict[int, tuple[int, int]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _searchable(process: ProcessMemory) -> list[Region]:
        return [r for r in process.regions() if r.writable is not False and r.size <= LARGEST_REGION]

    def ram(self, process: ProcessMemory) -> tuple[int, int] | None:
        """(start, end) of the RAM block, once main_candidates has found the main program in it."""
        with self._lock:
            return self._ram.get(process.pid)

    def main_candidates(self, process: ProcessMemory, header: bytes) -> Iterable[int]:
        """Page-aligned places the main program's header is, those in the largest stretch of memory first: the RAM
        block itself rather than a view of part of it (Ryujinx's host-mapped modes map the game's memory a second
        time at its virtual addresses). The stretch of each candidate is kept as the RAM block, so the one the
        caller settles on (the last yielded) is the one heap_regions and locate use. Searched lazily, largest
        stretch first, so the search usually ends in the first one."""
        regions = self._searchable(process)
        for start, end in sorted(runs(regions), key=lambda s: s[0] - s[1]):
            for r in regions:
                if not start <= r.base < end:
                    continue
                for address in search(process, r.base, r.size, header, PAGE):
                    with self._lock:
                        self._ram[process.pid] = (start, min(end, start + LARGEST_RAM))
                    yield address

    def module_regions(self, process: ProcessMemory) -> Iterable[Region]:
        start_end = self.ram(process)
        return [] if start_end is None else [Region(start_end[0], start_end[1] - start_end[0], True)]

    def heap_regions(self, process: ProcessMemory) -> Iterable[Region]:
        """The parts of the RAM block that can be read (searched for the battle copies)."""
        found = self.ram(process)
        if found is None:
            return []
        start, end = found
        out = []
        for r in process.regions():
            low, high = max(r.base, start), min(r.base + r.size, end)
            if low < high:
                out.append(Region(low, high - low, r.mapped, r.writable))
        return out

    def arena_candidates(self, process: ProcessMemory) -> Iterable[int]:
        return []  # no single offset: see locate

    def locate(self, process: ProcessMemory, address: int, size: int, check: Callable[[bytes], bool]) -> int | None:
        """The host address of virtual `address`: the first place in the RAM block, at the same offset within a
        2 MiB block (then within a 64 KiB one), whose `size` bytes pass `check`. None if nothing does."""
        found = self.ram(process)
        if found is None:
            return None
        start, end = found
        for granule in (BLOCK, SMALL_BLOCK):
            within = address % granule
            for host in range(start + within, end - size + 1, granule):
                data = process.read(host, size)
                if data is not None and check(data):
                    return host
        return None

    def hidden(self, process: ProcessMemory) -> bool:
        """Whether the RAM block seems to be there but can't be read: memory as large as a Switch's that the system
        keeps from this program (Linux, with Ryujinx's "software" memory mode: its RAM isn't shared memory)."""
        regions = getattr(process, "hidden_regions", None)
        return regions is not None and any(r.writable and 4 * GIB <= r.size <= LARGEST_REGION for r in regions())

    def forget(self, process: ProcessMemory) -> None:
        with self._lock:
            self._ram.pop(process.pid, None)


RYUJINX = Emulator(
    "Astris or Ryubing",
    # Astris (macOS), and Ryubing and the original Ryujinx (Ryujinx.exe on Windows, Ryujinx on macOS and Linux).
    frozenset({"astris", "astris.exe", "ryujinx", "ryujinx.exe"}),
    GuestRam(),
    "it must run game version 1.2.0",
)

RYUJINX_EMULATORS = (RYUJINX,)
