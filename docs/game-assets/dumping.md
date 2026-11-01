# Preparing a game dump

In the Windows installer, choose one source: a folder extracted from your own copy of the game, or the exact NSP
files you want setup to extract and import using NSTool and your own keys.

You need:

- **Base game with update 1.2.0** (required): the RomFS, including `DATA0.bin`, `DATA1.bin` and the update's
  `patch1` to `patch4` folders.
- **ExeFS** `main` from 1.2.0 (required; the importer stops on any other build).
- **DLC** RomFS for any DLC you own (optional).

Put the parts under one folder, with any folder names you like, and select that folder in the installer, in
**Settings → Game files**, or on the command line. The app identifies each part from its contents and title ids. The
layout it recognises, and the commands, are in [README.md](README.md).

## From NSP files

In the Windows installer, choose NSP files as your source, then select your base game and update 1.2.0 NSPs, plus any DLC NSPs you own, and select your
own `prod.keys`. Setup imports only the NSP files you choose. The installer includes [NSTool](https://github.com/jakcron/nstool)
and uses it to extract the NSPs to temporary storage before importing the resulting files. Allow enough free space
for both the unpacked NCAs and extracted files. NSPs and keys remain untouched. Compressed NSZ files are not supported.

For silent setup, specify the source folder with `/DUMP="<folder>"`, your keys with `/KEYS="<prod.keys>"`,
and each chosen NSP with `/NSP1="<file>"`, `/NSP2="<file>"`, and so on, up to `/NSP16`.

[NSP Unpacker](https://github.com/adombs/nsp-unpacker) is a separate Windows tool by the same author. It extracts the RomFS and ExeFS from base,
update and DLC NSPs into one output folder, which you can then select here.

It's a GUI for NSTool, written by Jack (jakcron), which does the extraction. NSP Unpacker is separate from Divine Pulse
and requires its own NSTool download. Neither tool provides keys or game files.
