"""Command line: python -m app.gamefiles <command> (run from backend/).

    info <dump>                     show what was found in a dump folder
    extract <dump> [--out DIR] [--only FAMILY ...]
    verify [--out DIR]              check the output against its manifest
"""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import sys
import time

from . import dump as dumps
from . import verify
from .extract import FAMILIES, Context, run
from .output import Output

DEFAULT_OUT = Path(__file__).resolve().parents[3] / "game-assets"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.gamefiles", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    info = sub.add_parser("info", help="show what was found in a dump folder")
    info.add_argument("dump", type=Path)
    extract = sub.add_parser("extract", help="extract every asset family from a dump")
    extract.add_argument("dump", type=Path)
    extract.add_argument("--out", type=Path, default=DEFAULT_OUT)
    extract.add_argument("--only", nargs="+", choices=FAMILIES)
    extract.add_argument("--keep", action="store_true", help="don't empty the output folder first")
    for name in ("verify",):
        command = sub.add_parser(name)
        command.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    if args.command == "info":
        print("\n".join(dumps.find(args.dump).describe()))
        return 0
    if args.command == "extract":
        found = dumps.find(args.dump)
        print("\n".join(found.describe()))
        if found.exefs and found.version is None:
            print("This game build is not supported (only 1.2.0 is); stopping.", file=sys.stderr)
            return 2
        if args.out.exists() and not args.keep and not args.only:
            shutil.rmtree(args.out)
        out = Output(args.out)
        ctx = Context(found, out)
        started = time.monotonic()
        families = run(ctx, args.only)
        main_path = found.main_path
        out.write_manifest(
            dump={
                "version": found.version,
                "build": ctx.main.build_id if ctx.main else None,
                "dlc": sorted(found.dlc),
                "exefs": main_path is not None and main_path.is_file(),
            },
            families=families,
        )
        print(f"{len(out.files)} files in {args.out} ({time.monotonic() - started:.0f} s)")
        report = verify.check(args.out)
    else:
        report = verify.check(args.out)
    print("\n".join(report.lines()))
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
