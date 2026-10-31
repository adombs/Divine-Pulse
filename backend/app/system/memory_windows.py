"""Read-only access to another process's memory on Windows (see memory.py).

Only PROCESS_QUERY_INFORMATION and PROCESS_VM_READ are requested: the tracker can look at the emulator's
memory but never change it.
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
from collections.abc import Iterator

from .memory import AccessDenied, Region

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
MEM_COMMIT = 0x1000
MEM_MAPPED = 0x40000
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100
TH32CS_SNAPPROCESS = 0x2
STILL_ACTIVE = 259
ERROR_ACCESS_DENIED = 5
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value


class _MemoryBasicInformation(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_uint64),
        ("AllocationBase", ctypes.c_uint64),
        ("AllocationProtect", wt.DWORD),
        ("PartitionId", wt.WORD),
        ("RegionSize", ctypes.c_uint64),
        ("State", wt.DWORD),
        ("Protect", wt.DWORD),
        ("Type", wt.DWORD),
    ]


class _ProcessEntry(ctypes.Structure):
    _fields_ = [
        ("dwSize", wt.DWORD),
        ("cntUsage", wt.DWORD),
        ("th32ProcessID", wt.DWORD),
        ("th32DefaultHeapID", ctypes.c_void_p),
        ("th32ModuleID", wt.DWORD),
        ("cntThreads", wt.DWORD),
        ("th32ParentProcessID", wt.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wt.DWORD),
        ("szExeFile", ctypes.c_wchar * 260),
    ]


def _kernel32():
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.OpenProcess.restype = wt.HANDLE
    k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    k32.CloseHandle.argtypes = [wt.HANDLE]
    k32.GetExitCodeProcess.argtypes = [wt.HANDLE, ctypes.POINTER(wt.DWORD)]
    k32.VirtualQueryEx.restype = ctypes.c_size_t
    k32.VirtualQueryEx.argtypes = [wt.HANDLE, ctypes.c_uint64, ctypes.POINTER(_MemoryBasicInformation), ctypes.c_size_t]
    k32.ReadProcessMemory.restype = wt.BOOL
    k32.ReadProcessMemory.argtypes = [wt.HANDLE, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
    k32.CreateToolhelp32Snapshot.restype = wt.HANDLE
    k32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
    k32.Process32FirstW.argtypes = [wt.HANDLE, ctypes.POINTER(_ProcessEntry)]
    k32.Process32NextW.argtypes = [wt.HANDLE, ctypes.POINTER(_ProcessEntry)]
    return k32


def find_processes(exe_names: set[str]) -> list[tuple[int, str]]:
    """(pid, name) of running processes whose executable name (lower case) is in `exe_names`."""
    k32 = _kernel32()
    snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if not snap or snap == INVALID_HANDLE_VALUE:
        return []
    found = []
    try:
        entry = _ProcessEntry(dwSize=ctypes.sizeof(_ProcessEntry))
        ok = k32.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            if (name := entry.szExeFile.lower()) in exe_names:
                found.append((entry.th32ProcessID, name))
            ok = k32.Process32NextW(snap, ctypes.byref(entry))
    finally:
        k32.CloseHandle(snap)
    return found


class Process:
    """A process opened for reading. Close it when done."""

    def __init__(self, pid: int):
        self._k32 = _kernel32()
        self.pid = pid
        self._handle = self._k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
        if not self._handle:
            err = ctypes.get_last_error()
            if err == ERROR_ACCESS_DENIED:
                raise AccessDenied(err, f"Access denied opening process {pid}")
            raise OSError(err, f"Could not open process {pid}")

    def close(self) -> None:
        if self._handle:
            self._k32.CloseHandle(self._handle)
            self._handle = None

    def alive(self) -> bool:
        code = wt.DWORD()
        return bool(self._handle) and bool(self._k32.GetExitCodeProcess(self._handle, ctypes.byref(code))) and code.value == STILL_ACTIVE

    def regions(self) -> Iterator[Region]:
        """Committed, readable regions, lowest address first."""
        mbi = _MemoryBasicInformation()
        addr = 0
        while self._k32.VirtualQueryEx(self._handle, addr, ctypes.byref(mbi), ctypes.sizeof(mbi)):
            readable = mbi.State == MEM_COMMIT and mbi.Protect and not mbi.Protect & (PAGE_NOACCESS | PAGE_GUARD)
            if readable:
                yield Region(mbi.BaseAddress, mbi.RegionSize, mbi.Type == MEM_MAPPED)
            nxt = mbi.BaseAddress + mbi.RegionSize
            if nxt <= addr:
                return
            addr = nxt

    def read(self, address: int, size: int) -> bytes | None:
        """`size` bytes at `address`, or None if any of it can't be read."""
        buf = ctypes.create_string_buffer(size)
        got = ctypes.c_size_t()
        if not self._k32.ReadProcessMemory(self._handle, address, buf, size, ctypes.byref(got)) or got.value != size:
            return None
        return buf.raw
