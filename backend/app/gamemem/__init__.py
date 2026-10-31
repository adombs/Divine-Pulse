"""Read units straight from FE3H running in an emulator (Eden): the only way the tracker reads the game.

- emulators.py: the supported emulators and where each keeps the Switch's memory.
- fe3h.py: where the roster lives in the game and how a roster slot is laid out.
- units.py: turn roster units into readings (app/readings.py) for app/handlers.py.

How it was all found: docs/reading-game-memory.md.
"""
