"""The macOS memory reader: the signed helper reading a real process that allows debugging (as Astris does).

Builds the helper and a small target program with clang, so it runs only on macOS with Xcode's command-line tools.
"""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    sys.platform != "darwin" or not shutil.which("clang") or not shutil.which("codesign"),
    reason="needs macOS with Xcode's command-line tools",
)

TARGET = r"""
#include <stdio.h>
#include <unistd.h>
static char marker[64] = "DIVINE-PULSE-TEST-MARKER";
int main(void) {
    printf("%p\n", (void *)marker);
    fflush(stdout);
    getchar();  /* runs until its stdin closes */
    return 0;
}
"""

GET_TASK_ALLOW = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.get-task-allow</key><true/></dict></plist>
"""


@pytest.fixture(autouse=True)
def no_hang():
    """Opening a process can wait on macOS's developer-tools password prompt when nobody is there to answer it (a CI
    machine without `DevToolsSecurity -enable`): fail after a minute instead of waiting forever."""
    import signal

    def give_up(_signum, _frame):
        raise TimeoutError("macOS kept waiting, probably on its developer-tools prompt: run sudo DevToolsSecurity -enable")

    previous = signal.signal(signal.SIGALRM, give_up)
    signal.alarm(60)
    yield
    signal.alarm(0)
    signal.signal(signal.SIGALRM, previous)


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    from app.system import memory_macos

    folder = tmp_path_factory.mktemp("macos-reader")
    helper = folder / "bin" / memory_macos.HELPER_NAME
    memory_macos.build(helper)
    (folder / "target.c").write_text(TARGET)
    (folder / "target.plist").write_text(GET_TASK_ALLOW)
    target = folder / "target"
    subprocess.run(["clang", "-o", str(target), str(folder / "target.c")], check=True)
    subprocess.run(["codesign", "-f", "-s", "-", "--entitlements", str(folder / "target.plist"), str(target)],
                   check=True, capture_output=True)
    return helper, target


def test_the_helper_reads_searches_and_lists_a_debuggable_process(built):
    from app.system.memory import search
    from app.system.memory_macos import Process, find_processes

    helper, target = built
    child = subprocess.Popen([str(target)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        address = int(child.stdout.readline(), 16)
        assert (child.pid, "target") in find_processes({"target"})
        process = Process(child.pid, helper)
        try:
            assert process.read(address, 24) == b"DIVINE-PULSE-TEST-MARKER"
            assert process.read(0, 16) is None  # unmapped
            region = next(r for r in process.regions() if r.base <= address < r.base + r.size)
            assert region.writable
            assert address in search(process, region.base, region.size, b"DIVINE-PULSE-TEST-MARKER")
            assert search(process, region.base, region.size, b"DIVINE-PULSE-TEST-MARKER", alignment=1 << 31) == []
            assert process.alive()
        finally:
            process.close()
    finally:
        child.stdin.close()
        child.wait()


def test_a_process_that_doesn_t_allow_debugging_is_refused(built):
    from app.system.memory import AccessDenied
    from app.system.memory_macos import Process

    helper, _ = built
    child = subprocess.Popen(["/bin/cat"], stdin=subprocess.PIPE)  # Apple's own, hardened: never debuggable
    try:
        with pytest.raises(AccessDenied):
            Process(child.pid, helper)
    finally:
        child.stdin.close()
        child.wait()


def test_the_helper_is_rebuilt_when_its_source_is_newer(tmp_path):
    from app.system import memory_macos

    helper = memory_macos.helper_path(tmp_path)
    assert helper == tmp_path / memory_macos.HELPER_NAME and helper.is_file()
    built_at = helper.stat().st_mtime_ns
    assert memory_macos.helper_path(tmp_path).stat().st_mtime_ns == built_at  # kept
    entitlements = subprocess.run(["codesign", "-d", "--entitlements", "-", str(helper)], capture_output=True, text=True)
    assert "com.apple.security.cs.debugger" in entitlements.stdout + entitlements.stderr
    assert Path(memory_macos.SOURCE_DIR / "dp_memreader.c").is_file()
