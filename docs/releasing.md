# Releasing Divine Pulse

`tools/build.py` builds Windows release artifacts.

| File | For |
|---|---|
| `Divine-Pulse-<version>-setup.exe` | Windows, most people: installs for the current user (no administrator prompt), adds Start menu and optional desktop shortcuts, and an uninstaller. |
| `Divine-Pulse-<version>-windows-portable.zip` | Windows: unzip and run `Divine Pulse.exe`, nothing installed. |
| `SHA256SUMS.txt` | Checksums of the files built. |

Each build writes checksums only for the artifacts it produced. Old artifacts for other versions can remain in
`release/`; only the current
version's Windows portable zip, installer, and `SHA256SUMS.txt` are selected by the release script for upload.

None needs Python, Node.js or anything else on the player's PC. Windows 10/11 (64-bit) is the tested platform.

## Checklist

1. **Authorization and changelog.** A maintainer must authorize a release before starting. Ordinary code and docs
   changes go through a pull request; the release script's clean-`main` requirement is a controlled maintainer
   exception for the version/changelog commit. Write what changed under `## Unreleased` in `CHANGELOG.md` (pull
   requests can add to it as they go).
2. **Prerequisites.** Releases are built on Windows. Install Python 3.12+, Node.js 22.12+ (24.x recommended), Inno
   Setup 6, and the GitHub CLI; authenticate it with `gh auth login`. The installer step needs
   [Inno Setup 6](https://jrsoftware.org/isinfo.php) (without it you get the zip only):

   ```
   gh auth status
   ```

3. **Build and try it on a clean PC** (or a fresh Windows user account). Build into `release/` with its own build
   environment; it runs the backend tests and frontend build. Run Ruff separately before releasing:

   ```
   powershell -ExecutionPolicy Bypass -File tools\build_windows.ps1
   cd backend
   .venv\Scripts\python -m ruff check --config pyproject.toml . ../tools ../packaging
   ```

   Run the installer and import a dump when it asks (or skip it and import from Settings → Game files), start the
   tracker, start a new run from the home page, check reading units with Eden running and not running, play a
   battle, quit from the tray, start again, then uninstall with the tracker still in the tray and choose No when
   asked about saved data. Check that the tracker closed, the program folder and Start menu entries went, and the data
   folder (`%LOCALAPPDATA%\Divine Pulse`) survived. Choosing Yes deletes that folder, so try it only on data you can
   lose.
4. **Version, build, tag, and create the draft.** On an up-to-date `main` with nothing uncommitted:

   ```
   python tools/release.py 0.2.0 --push
   ```

   This sets the version (`backend/app/__init__.py`, `backend/pyproject.toml`, `frontend/package.json`), turns
   `## Unreleased` into `## 0.2.0 (date)`, runs the local validation and Windows build, commits, tags `v0.2.0`, and
   pushes both. It then creates a GitHub **draft** release with the local installer, portable zip, checksum file, and
   the version's changelog section as its notes. The script requires the expected Windows artifacts to exist and
   verifies their SHA-256 entries in `SHA256SUMS.txt` against the actual files before upload. Leave out `--push` to
   create only the local commit and tag; it does not run checks or builds in that mode.
5. **Publish** (manual). On GitHub → Releases, open the draft, check the notes and files, press *Publish release*.

If local checks or the build fail during a new release attempt, the script restores the version and changelog files;
no release commit or tag is made. If a later step fails after the local release commit and tag are created, inspect
the local state before retrying. If push succeeds but draft creation or upload fails, the commit and tag are already
on the remote. The script prints a recovery message suggesting creation of a draft for that same tag; follow the
project policy below instead: do not reuse a pushed tag. Fix the issue on `main` and release the next patch version.
The script never publishes the draft.

## Where an installed copy keeps things

| What | Where |
|---|---|
| Program | `%LOCALAPPDATA%\Programs\Divine Pulse` (installer) or wherever the zip was unpacked |
| Runs, battles, settings, log | `%LOCALAPPDATA%\Divine Pulse`, or a `data` folder next to the program if one exists (portable mode) |
| Override | the `DIVINE_PULSE_DATA_DIR` environment variable |

Settings → About shows the version and the data folder, with a button to open it. Settings that don't fit the new
PC are fixed on start:
- if the usual port (8765) is taken by another program, a free port is picked and remembered;
- a damaged `settings.json` is set aside and defaults are used.

## Things to know

- **SmartScreen.** The program isn't code-signed, so Windows SmartScreen shows "Windows protected your PC" on first
  run (*More info → Run anyway*). Some antivirus tools also flag unsigned PyInstaller programs. Signing the exe and
  installer with a code-signing certificate removes both.
- **WebView2.** The window uses Microsoft Edge WebView2, which Windows 11 includes and most Windows 10 PCs have via
  Edge. Without it, the tracker opens in the default browser instead.
- **Content.** The release contains no game content. `tools/release.py` scans the built zip with the same rules the
  repository test uses (`tools/game_content.py`): it refuses game images, game file formats or data, and a missing
  `LICENSE.txt`, `Third-party notices.txt`, `GFDL-1.3.txt` or `Third-party licenses` folder beside the program.
  Players import their own dump on first run.
- **Licenses.** `tools/build.py` copies each bundled package's license text into `Third-party licenses`, and stops if
  one has none. Add the missing text to `packaging/third-party-licenses/`, named after the package, and name the
  package in [the third-party notices](third-party-notices.md); a test checks both.
