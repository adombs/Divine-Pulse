# Adding an emulator

This guide explains how to add an emulator to Divine Pulse.

Add an entry to `EMULATORS` in `gamemem/emulators.py`:

```python
Emulator(
    "Name",
    frozenset({"name.exe"}),
    layout,             # a MemoryLayout
    tested=False,
    requirement="what the emulator needs for the tracker to find the game",
)
```

A yuzu fork with fastmem uses `_yuzu_family(name, exe)`. An emulator that keeps the Switch's memory differently
needs its own `MemoryLayout` with three methods:

- `module_regions(process)`: regions the game's main program may start at (the tracker checks each for the `MOD0`
  header and a known build ID);
- `heap_regions(process)`: regions to search for the game's heap data (the units' battle copies);
- `arena_candidates(process)`: host addresses where Switch address 0 may be, tried when the game's own pointers
  don't say (for the battle history).

The game side (`fe3h.py`) works in Switch addresses relative to those, so it doesn't change. Ryujinx, for example,
isn't supported yet: it doesn't map the Switch's memory as fastmem views, so it would need its own layout.
