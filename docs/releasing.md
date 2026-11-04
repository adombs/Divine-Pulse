# Releasing Divine Pulse

`tools/build.py` builds Windows release artifacts.

| File | For |
|---|---|
| `Divine-Pulse-<version>-setup.exe` | Windows, most people: installs for the current user (no administrator prompt), adds Start menu and optional desktop shortcuts, and an uninstaller. |
| `Divine-Pulse-<version>-windows-portable.zip` | Windows: unzip and run `Divine Pulse.exe`, nothing installed. |
| `SHA256SUMS.txt` | Checksums of the files built. |

Each build writes checksums only for the artifacts it produced. Old artifacts for other versions can remain in
`release/`; only the current
version's Windows portable zip, installer, and `SHA256SUMS.txt` should be uploaded.

None needs Python, Node.js or anything else on the player's PC. Windows 10/11 (64-bit) is the tested platform.

## Checklist

1. **Authorization and changelog.** A maintainer must authorize a release before starting. Ordinary code and docs
   changes go through a release branch and a pull request to `main`. Write what changed under `## Unreleased`
   in `CHANGELOG.md` (pull requests can add to it as they go).
2. **Prerequisites.** Releases are built on Windows. Install Python 3.12+, Node.js 22.12+ (24.x recommended), Inno
   Setup 6, and the GitHub CLI; authenticate it with `gh auth login`. The installer step needs
   [Inno Setup 6](https://jrsoftware.org/isinfo.php) (without it you get the zip only):

   ```
   gh auth status
   ```

3. **Prepare the release PR.** On a clean `release/0.2.0` (or `hotfix/0.2.0`), from the repository root run:

   ```powershell
   python tools/release.py prepare 0.2.0
   ```

   Replace `0.2.0` with the actual version in both the branch and command. This updates the backend and frontend
   versions and changelog, then commits them on the release branch. It does not tag, push, or create a release. Push
   the branch, open a pull request to `main`, and merge it after checks and review.
4. **Build and create a draft from the merged commit.** Check out clean, current `main` after the release PR merges:

   ```powershell
   git checkout main
   git pull --ff-only
   python tools/release.py finalize 0.2.0
   ```

   On Windows, `finalize` verifies that `main` matches the remote, checks the version and changelog, runs the release
   checks and build, validates the artifacts and checksums, and scans the portable zip for prohibited game content.
   It then tags the merged commit, pushes only the tag, and creates a GitHub draft release with the installer, portable
   ZIP, checksum file, and changelog notes. It never publishes the draft or pushes to `main`.
5. **Test and publish.** Try the installer and portable ZIP on a clean PC (or fresh Windows user account). Inspect
   the draft's version, notes, files, and checksums before publishing it manually on GitHub.

   The build also runs the packaged executable with `--check-desktop`: it opens and closes a hidden WebView2
   window, without the server, game reader or user data. It tests a temporary copy with Internet-zone markers on
   the DLLs, as Windows Explorer creates when extracting a downloaded zip. A failed or timed-out desktop check
   stops packaging, even with `--skip-tests`. Keep `Divine Pulse.exe.config` beside the executable: its CLR setting
   allows the app's bundled .NET assemblies to load with those markers, without unblocking files or changing
   machine-wide settings.

   Run the installer and import a dump when it asks (or skip it and import from Settings > Game files), start the
   tracker, start a new run from the home page, check reading units with Eden running and not running, play a
   battle, quit from the tray, start again, then uninstall with the tracker still in the tray and choose No when
   asked about saved data. Check that the tracker closed, the program folder and Start menu entries went, and the data
   folder (`%LOCALAPPDATA%\Divine Pulse`) survived. Choosing Yes deletes that folder, so try it only on data you can
   lose.

If a pushed tag or release fails, do not reuse the tag: fix the problem through a release or hotfix PR and use the next
patch version. Review the local and remote tag and draft state before retrying after an error.

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
- **Content.** The release must contain no game content. The release script scans the built zip using
  `tools/game_content.py` (`check_zip`); it checks for game images, game file formats or data, and a missing
  `LICENSE.txt`, `Third-party notices.txt`, `GFDL-1.3.txt` or `Third-party licenses` folder beside the program.
  Players import their own dump on first run.
- **Licenses.** `tools/build.py` copies each bundled package's license text into `Third-party licenses`, and stops if
  one has none. Add the missing text to `packaging/third-party-licenses/`, named after the package, and name the
  package in [the third-party notices](third-party-notices.md); a test checks both.
