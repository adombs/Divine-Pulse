"""Reading game assets out of the user's own dump of Fire Emblem: Three Houses.

Nothing here ships game content: these modules read files the user extracted from their own copy (RomFS, ExeFS and
DLC RomFS, e.g. with nstool or an emulator's dump commands) and write the assets the app uses into a local folder.

    python -m app.gamefiles extract <dump folder> [--out <folder>]   (from backend/)
    python -m app.gamefiles verify [--out <folder>]

Layout of the pieces:
    dump.py      find the base RomFS, the ExeFS main and each DLC RomFS in a dump folder
    archive.py   DATA0.bin / DATA1.bin entries, patch overrides, zlib-chunk files, packs
    g1t.py       G1T textures to Pillow images
    tables.py    fixed_*.bin data tables (sections of fixed-size rows)
    msgdata.py   the game's text, every language
    nso.py       the main executable (NSO, LZ4 segments) for tables that only exist in code
    output.py    the output folder and its manifest (every file with its hash)
    extract/     one module per asset family
    verify.py    checks an output folder against its manifest
"""
