/*
 * dp-memreader: read-only access to another process's memory on macOS, for Divine Pulse (see memory_macos.py).
 *
 * macOS only hands out another process's task port to a program signed with the com.apple.security.cs.debugger
 * entitlement (or to root), and only when the target allows it (com.apple.security.get-task-allow, as the Astris
 * emulator's builds have). A Python interpreter can't carry that entitlement, so this small helper is signed with it
 * and the tracker talks to it over stdin/stdout. It only ever reads: it never writes to the process, suspends it or
 * touches its threads.
 *
 * Usage: dp-memreader <pid>
 * On start it writes a little-endian i32: 0 when the task port was granted, else the kern_return_t.
 * Then it answers requests (all integers little-endian):
 *   'R' u64 address, u64 size  ->  u8 1 + size bytes, or u8 0 if any of it can't be read
 *   'M'                        ->  regions, lowest address first, each u64 base, u64 size, u32 protection,
 *                                  u32 share mode, u32 user tag; ended by a region of size 0
 *   'S' u64 address, u64 size, u32 alignment, u32 length, pattern
 *                              ->  addresses in [address, address + size) where the pattern starts and that are a
 *                                  multiple of alignment (1 = any), each u64, ended by 0; unreadable parts are skipped
 *   'A'                        ->  u8 1 while the process is alive, else 0
 *   'Q' or end of input        ->  exit
 */
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <signal.h>
#include <stddef.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int read_all(void *buf, size_t n) {
    uint8_t *p = buf;
    while (n) {
        ssize_t got = read(0, p, n);
        if (got <= 0) return 0;
        p += got;
        n -= (size_t)got;
    }
    return 1;
}

static void write_all(const void *buf, size_t n) {
    const uint8_t *p = buf;
    while (n) {
        ssize_t put = write(1, p, n);
        if (put <= 0) exit(0);
        p += put;
        n -= (size_t)put;
    }
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: dp-memreader <pid>\n");
        return 2;
    }
    pid_t pid = (pid_t)atoi(argv[1]);
    mach_port_t task = MACH_PORT_NULL;
    int32_t status = task_for_pid(mach_task_self(), pid, &task);
    write_all(&status, sizeof status);
    if (status != KERN_SUCCESS) return 1;

    uint8_t *buffer = NULL;
    size_t capacity = 0;
    for (;;) {
        uint8_t op;
        if (!read_all(&op, 1) || op == 'Q') return 0;
        if (op == 'R') {
            uint64_t req[2];
            if (!read_all(req, sizeof req)) return 0;
            uint64_t size = req[1];
            if (size > capacity) {
                uint8_t *grown = realloc(buffer, size);
                if (!grown) {
                    uint8_t no = 0;
                    write_all(&no, 1);
                    continue;
                }
                buffer = grown;
                capacity = size;
            }
            mach_vm_size_t got = 0;
            kern_return_t kr = size ? mach_vm_read_overwrite(task, req[0], size, (mach_vm_address_t)buffer, &got) : KERN_SUCCESS;
            uint8_t ok = kr == KERN_SUCCESS && got == size;
            write_all(&ok, 1);
            if (ok) write_all(buffer, size);
        } else if (op == 'M') {
            mach_vm_address_t address = 0;
            for (;;) {
                mach_vm_size_t size = 0;
                vm_region_extended_info_data_t info;
                mach_msg_type_number_t count = VM_REGION_EXTENDED_INFO_COUNT;
                mach_port_t object = MACH_PORT_NULL;
                if (mach_vm_region(task, &address, &size, VM_REGION_EXTENDED_INFO, (vm_region_info_t)&info, &count, &object) != KERN_SUCCESS)
                    break;
                uint64_t row[2] = {address, size};
                uint32_t more[3] = {(uint32_t)info.protection, (uint32_t)info.share_mode, (uint32_t)info.user_tag};
                write_all(row, sizeof row);
                write_all(more, sizeof more);
                address += size;
            }
            uint64_t end[2] = {0, 0};
            uint32_t none[3] = {0, 0, 0};
            write_all(end, sizeof end);
            write_all(none, sizeof none);
        } else if (op == 'S') {
            uint64_t range[2];
            uint32_t shape[2];
            if (!read_all(range, sizeof range) || !read_all(shape, sizeof shape)) return 0;
            uint32_t alignment = shape[0] ? shape[0] : 1, length = shape[1];
            uint8_t pattern[256];
            if (length == 0 || length > sizeof pattern || !read_all(pattern, length)) return 2;
            const uint64_t chunk = 1ULL << 24;
            uint64_t want = chunk + length - 1;
            if (want > capacity) {
                uint8_t *grown = realloc(buffer, want);
                if (!grown) return 3;
                buffer = grown;
                capacity = want;
            }
            uint64_t end = range[0] + range[1];
            for (uint64_t at = range[0]; at < end; at += chunk) {
                uint64_t size = end - at < want ? end - at : want;
                mach_vm_size_t got = 0;
                if (mach_vm_read_overwrite(task, at, size, (mach_vm_address_t)buffer, &got) != KERN_SUCCESS || got < length)
                    continue;
                uint64_t limit = got < chunk + length - 1 ? got : chunk + length - 1;
                uint8_t *p = buffer, *stop = buffer + limit;
                while (p + length <= stop) {
                    uint8_t *hit = memmem(p, (size_t)(stop - p), pattern, length);
                    if (!hit) break;
                    uint64_t address = at + (uint64_t)(hit - buffer);
                    if (hit - buffer < (ptrdiff_t)chunk && address % alignment == 0) write_all(&address, sizeof address);
                    p = hit + 1;
                }
            }
            uint64_t none = 0;
            write_all(&none, sizeof none);
        } else if (op == 'A') {
            uint8_t alive = kill(pid, 0) == 0 || errno == EPERM;
            write_all(&alive, 1);
        } else {
            return 2;
        }
    }
}
