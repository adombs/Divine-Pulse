# Preparing a game dump

Divine Pulse reads folders you have already extracted from your own copy of the game. It never decrypts anything and
doesn't handle keys: use your preferred dumping tool or emulator to produce the files, then point the app at them.

You need:

- **Base game with update 1.2.0** (required): the RomFS, including `DATA0.bin`, `DATA1.bin` and the update's
  `patch1` to `patch4` folders.
- **ExeFS** `main` from 1.2.0 (required; the importer stops on any other build).
- **DLC** RomFS for any DLC you own (optional).

Put the parts under one folder, with any folder names you like, and select that folder in the installer, in
**Settings → Game files**, or on the command line. The app identifies each part from its contents and title ids. The
layout it recognises, and the commands, are in [README.md](README.md).
