# Preparing a game dump

Divine Pulse can import folders extracted from your own copy of the game. The Windows installer can also extract
NSP files using NSTool and your own keys before importing them.

You need:

- **Base game with update 1.2.0** (required): the RomFS, including `DATA0.bin`, `DATA1.bin` and the update's
  `patch1` to `patch4` folders.
- **ExeFS** `main` from 1.2.0 (required; the importer stops on any other build).
- **DLC** RomFS for any DLC you own (optional).

Put the parts under one folder, with any folder names you like, and select that folder in the installer, in
**Settings → Game files**, or on the command line. The app identifies each part from its contents and title ids. The
layout it recognises, and the commands, are in [README.md](README.md).

## From NSP files

In the Windows installer, select the folder containing your base game, update and optional DLC NSPs, then select
NSTool and your own `prod.keys`. The installer extracts them to temporary storage and imports the resulting files;
allow enough free space for both the unpacked NCAs and extracted files. NSPs and keys remain untouched.
Download [NSTool](https://github.com/jakcron/nstool) separately. Compressed NSZ files are not supported.

[NSP Unpacker](https://github.com/adombs/nsp-unpacker) is a separate Windows tool by the same author. It extracts the RomFS and ExeFS from base,
update and DLC NSPs into one output folder, which you can then select here.

It's a GUI for [NSTool](https://github.com/jakcron/nstool), written by Jack (jakcron), which does the extraction. You download NSTool separately
and supply your own `prod.keys`. Neither tool comes with Divine Pulse, and none of them provide keys or game files.
