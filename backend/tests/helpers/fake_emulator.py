"""A stand-in for an emulator on Linux, which maps a made-up Switch's memory as the real one does. Run as a program:

    python fake_emulator.py eden|eden-merged|ryujinx|ryujinx-software <process name> <RAM image> [<address> <offset> <size> <rw|r>]...

It prints its pid once everything is mapped, and runs until its input closes. The RAM image is the start of the Switch's
physical memory, and each group maps a part of it at a Switch address. Standard library only.

eden              Eden's host_memory.cpp: a memfd "HostMemory" mapped whole, a 512 GiB reservation, and shared views of
                  the memfd in it at the Switch's addresses
ryujinx           Ryubing's MemoryManagementUnix.cs (host memory modes): an unlinked /dev/shm/Ryujinx-* file mapped
                  whole, and shared views of it in a reservation. Linux puts unrelated memory right below the block.
ryujinx-software  its software memory mode: the block is private memory, in no file
"""

import ctypes
import os
import sys
import tempfile

BLOCK_SIZE = 4 << 30
ARENA_SIZE = 1 << 39
HUGE_PAGE = 2 << 20
PROT_NONE, PROT_READ, PROT_WRITE = 0, 1, 2
MAP_SHARED, MAP_PRIVATE, MAP_FIXED, MAP_ANONYMOUS, MAP_NORESERVE, MAP_FIXED_NOREPLACE = 1, 2, 0x10, 0x20, 0x4000, 0x100000
PR_SET_NAME = 15

libc = ctypes.CDLL(None, use_errno=True)
libc.mmap.restype = ctypes.c_void_p
libc.mmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_long]


def mmap(address: int, size: int, protection: int, flags: int, fd: int = -1, offset: int = 0) -> int:
    got = libc.mmap(address or None, size, protection, flags, fd, offset)
    if got == ctypes.c_void_p(-1).value:
        raise OSError(ctypes.get_errno(), os.strerror(ctypes.get_errno()))
    return got


def main() -> None:
    kind, name, image, *views = sys.argv[1:]
    libc.prctl(PR_SET_NAME, name.encode(), 0, 0, 0)
    data = open(image, "rb").read()
    if kind == "ryujinx-software":
        block = mmap(0, BLOCK_SIZE, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE)
        fd = -1
    else:
        if kind == "ryujinx":
            fd, path = tempfile.mkstemp(prefix="Ryujinx-", dir="/dev/shm")
            os.unlink(path)
        else:
            fd = os.memfd_create("HostMemory", 0)
        os.ftruncate(fd, BLOCK_SIZE)
        block = mmap(0, BLOCK_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd)
    try:
        beside = mmap(block - 0x13000, 0x13000, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED_NOREPLACE)
        ctypes.memset(beside, 1, 0x13000)
    except OSError:
        pass  # something is there already
    for page in range(0, len(data), 0x1000):  # only what holds something: the rest stays unallocated
        if any(data[page : page + 0x1000]):
            ctypes.memmove(block + page, data[page : page + 0x1000], len(data[page : page + 0x1000]))
    if kind != "ryujinx-software":
        protection = PROT_READ | PROT_WRITE if kind.startswith("eden") else PROT_NONE
        arena = mmap(0, ARENA_SIZE, protection, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE)
        arena = (arena + HUGE_PAGE - 1) // HUGE_PAGE * HUGE_PAGE
        while views:
            address, offset, size, access = int(views[0], 0), int(views[1], 0), int(views[2], 0), views[3]
            del views[:4]
            mmap(arena + address, size, PROT_READ | (PROT_WRITE if "w" in access else 0), MAP_SHARED | MAP_FIXED, fd, offset)
    print(os.getpid(), flush=True)
    sys.stdin.read()


if __name__ == "__main__":
    main()
