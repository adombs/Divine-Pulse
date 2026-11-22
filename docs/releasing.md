# Releasing Divine Pulse

`tools/build.py` builds this computer's release files: run `python tools/build.py` on Windows and
`python3 tools/build.py` on a Mac or Linux (started with an older Python, it switches to a 3.12+ one: the `py` launcher's on
Windows, Homebrew's or python.org's on macOS). All take the same steps, and only a per-system *target* in the script
differs:

| Step | Windows | macOS | Linux |
|---|---|---|---|
| Build environment | `build/venv`, NSTool present in `vendor/nstool` | `build/venv`, Xcode's command-line tools | `build/venv`, binutils, the X11 libraries Qt uses (bundled) |
| Web UI, tests | shared | shared | shared |
| Program | PyInstaller (shared), then the notes and licenses, `Divine Pulse.exe.config` and NSTool beside the program | the app icon, PyInstaller (shared), then the notes and licenses in `Contents/Resources` and the memory reader helper | PyInstaller (shared, with Qt), then the notes and licenses and `install.sh` beside the program |
| Sign | none (not code-signed) | ad hoc, the helper with the debugger entitlement; `codesign --verify --strict` and the entitlement checked | none |
| Desktop check | `--check-desktop` from a copy with Internet-zone markers on its DLLs | `--check-desktop` from a read-only copy, as App Translocation runs a downloaded app | `--check-desktop` from a read-only copy (needs a display: `xvfb-run`) |
| Package | the portable ZIP, and the installer with Inno Setup 6 | `release/Divine Pulse.app` and its ZIP (`ditto`) | the program folder as a tar.gz (keeps links and permissions) |
| Checksums | `SHA256SUMS.txt` | `SHA256SUMS.txt` | `SHA256SUMS.txt` |

The Linux program runs on distributions whose C library (glibc) is at least as new as the one it was built on, so build
it on Ubuntu 22.04 (glibc 2.35), as CI does. A release's files are the ones `tools/release.py finalize` builds and
uploads (step 4), on Windows, on a Mac and on Linux, never files from an ordinary build. `python tools/release.py check` runs
finalize's checks of the built files (names, checksums, game-content scan) without tagging or uploading; CI runs it.

| File | For |
|---|---|
| `Divine-Pulse-<version>-setup.exe` | Windows, most people: installs for the current user (no administrator prompt), adds Start menu and optional desktop shortcuts, and an uninstaller. |
| `Divine-Pulse-<version>-windows-portable.zip` | Windows: unzip and run `Divine Pulse.exe`, nothing installed. |
| `Divine-Pulse-<version>-macos-arm64.zip` | macOS on Apple silicon: unzip and move `Divine Pulse.app` to Applications. Not notarized, so the first launch needs System Settings → Privacy & Security → Open Anyway. |
| `Divine-Pulse-<version>-linux-x86_64.tar.gz` | Linux: unpack and run `Divine Pulse`, or `./install.sh` to add it to the applications menu. |
| `SHA256SUMS.txt` | Checksums of the files built. |

Each build writes checksums only for the artifacts it produced. Old artifacts for other versions can remain in
`release/`; only the current
version's Windows portable zip, installer, macOS zip, Linux tar.gz and `SHA256SUMS.txt` should be uploaded.

The Windows packages require Windows 10 or 11 (64-bit) with Microsoft Edge WebView2; the macOS app requires macOS 12
or later on Apple silicon; the Linux program requires glibc 2.35 and a desktop session, and bundles Qt. All bundle their Python and frontend runtimes.

## Checklist

1. **Authorization and changelog.** A maintainer must authorize a release before starting. Ordinary code and docs
   changes go through a release branch and a pull request to `main`. Write what changed under `## Unreleased`
   in `CHANGELOG.md` (pull requests can add to it as they go).
2. **Prerequisites.** Releases are built on Windows, on a Mac (Apple silicon) and on Linux (Ubuntu 22.04). On each, install Python 3.12+,
   Node.js 22.12+ (24.x recommended) and the GitHub CLI; authenticate it with `gh auth login`. Windows also needs
   [Inno Setup 6](https://jrsoftware.org/isinfo.php) for the installer, and the Mac Xcode's command-line tools
   (`xcode-select --install`) and Python 3.12+ from Homebrew or python.org: started with macOS's own `python3` (3.9),
   `tools/release.py` and `tools/build.py` switch to it. The build's tests read a real process's memory on the Mac,
   so allow developer tools once (`sudo DevToolsSecurity -enable`), or they wait on a password prompt:

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
4. **Build and create a draft from the merged commit, on Windows, on the Mac and on Linux.** On each, check out clean, current
   `main` after the release PR merges and run the same commands:

   ```powershell
   git checkout main
   git pull --ff-only
   python tools/release.py finalize 0.2.0
   ```

   `finalize` verifies that `main` matches the remote, checks the version and changelog, runs the release checks and
   build, validates the artifacts and checksums, and scans the zip for prohibited game content. It builds that
   computer's files: on Windows the installer and portable ZIP, on the Mac the macOS ZIP, on Linux the tar.gz.

   Whichever computer runs it first tags the merged commit, pushes only the tag, and creates a GitHub draft release
   with its files, the checksum file and the changelog notes. The others find that draft (its tag must be the same
   commit, and the release still a draft), upload their files to it and add their lines to the draft's
   `SHA256SUMS.txt`. Each downloads their uploaded files back and checks they are the ones built. Running `finalize`
   again on a computer replaces its files on the draft. It never publishes the draft or pushes to `main`.

   **Release notes.** An `x.y.0` release's draft gets its `CHANGELOG.md` section; rewrite it on GitHub as needed
   before publishing. A patch version `x.y.z` gets the published notes of `x.y.(z-1)`, which are `x.y.0`'s notes with
   each earlier version appended, plus its own changelog bullets under `## Version x.y.z`. So publish each release before
   finalizing the next patch, and edit that version's bullets on its draft: later releases carry them as published.

   A patch number does not make a release a hotfix. Use neutral version headings; reserve “hotfix” for releases that only fix defects.

   **Keep the notes player-facing.** `CHANGELOG.md` keeps the detailed list; the GitHub notes don't. After `finalize`,
   rewrite the draft's new section (`gh release edit vX.Y.Z --notes-file notes.md`): group it under short bold area
   labels (for example **Export Video**, **Battles and stats**, **Map**, **Smaller changes**), one line per bullet,
   saying what a player can now do or see, not every precise change, setting or number. Keep anything a player must
   act on (for example "Reprocess your game files once"). Version 1.4.3's section is a good model.

   **Screenshots.** A release's notes may carry screenshots, as 1.4.0's do. Never link a file that is not in the
   repository at the release tag (the 1.5.0 notes linked a `planner-screenshot.webp` that was never uploaded and
   broke). Never upload one as a release asset: assets are only the installer, the portable ZIP, the macOS ZIP, the
   Linux tar.gz and the checksums.
   To add one, open the release's edit page on GitHub in a signed-in browser, attach the image to the description box
   (the file input beside it, not the release-assets one) so GitHub returns a `github.com/user-attachments/assets/…`
   link, copy that link into the notes with a short alt text, and set the notes with `gh release edit`; leave the
   web form unsaved. After editing, check that `gh release view vX.Y.Z --json assets` lists only the five build files.
   Ask for the screenshot if the release needs one and none was provided.
5. **Test and publish.** Try the installer and portable ZIP on a clean PC (or fresh Windows user account), and the
   macOS zip on a Mac (downloaded from the draft, so macOS treats it as a download). Before that, `python
   tools/smoke_app.py` checks a build's zip in `release/` as CI does on each pull request: it unzips it into a
   temporary folder (with `ditto` on the Mac), checks the app's signature and the memory reader's debugger
   entitlement, starts it with an empty data folder on port 8799 (`--port`), checks the server, the page and its
   pictures, waits for the window to load the page, and quits it through `/api/quit`. Inspect
   the draft's version, notes, files, and checksums before publishing it manually on GitHub.

   The build also runs the packaged executable with `--check-desktop`: it opens and closes a hidden window
   (WebView2 on Windows, WebKit on macOS, Qt WebEngine on Linux), without the server, game reader or user data, from a temporary copy made
   to look downloaded. On Windows that copy has Internet-zone markers on the DLLs, as Explorer creates when
   extracting a downloaded zip; keep `Divine Pulse.exe.config` beside the executable: its CLR setting allows the
   app's bundled .NET assemblies to load with those markers, without unblocking files or changing machine-wide
   settings. On macOS the copy is read-only, as App Translocation runs a downloaded app that has been allowed to
   open (a quarantined copy would only bring up Gatekeeper's prompt, since the app isn't notarized). A failed or
   timed-out desktop check stops packaging, even with `--skip-tests`. `tools/smoke_app.py` unzips the release the
   same way before starting it.

   On clean Windows, test the installer and the portable build. Import your own files through the app, start a run,
   check tracking with Eden running and stopped, play a battle, close the window, and restart. Check that the
   installer and uninstaller respect the user's data choices and that the previous import survives a failed replacement.


If a pushed tag or release fails, do not reuse the tag: fix the problem through a release or hotfix PR and use the next
patch version. Review the local and remote tag and draft state before retrying after an error.

## Where an installed copy keeps things

| What | Windows | macOS | Linux |
|---|---|---|---|
| Program | `%LOCALAPPDATA%\Programs\Divine Pulse` (installer) or wherever the zip was unpacked | wherever `Divine Pulse.app` was put, usually Applications | `~/.local/opt/divine-pulse` (`install.sh`) or wherever it was unpacked |
| Runs, battles, settings, log | `%LOCALAPPDATA%\Divine Pulse`, or a `data` folder next to the program if one exists (portable mode) | `~/Library/Application Support/Divine Pulse` | `~/.local/share/Divine Pulse`, or a `data` folder next to the program |
| Override | the `DIVINE_PULSE_DATA_DIR` environment variable | the same | the same |

Settings → About shows the version and the data folder, with a button to open it. Settings that don't fit the new
PC are fixed on start:
- if the usual port (8765) is taken by another program, a free port is picked and remembered;
- a damaged `settings.json` is set aside and defaults are used.

## Things to know

- **SmartScreen.** The program isn't code-signed, so Windows SmartScreen shows "Windows protected your PC" on first
  run (*More info → Run anyway*). Some antivirus tools also flag unsigned PyInstaller programs. Signing the exe and
  installer with a code-signing certificate removes both.
- **Gatekeeper.** The macOS app is signed ad hoc, not notarized, so the first launch of a downloaded copy needs
  right-click > Open or System Settings → Privacy & Security → Open Anyway. A Developer ID certificate and
  notarization remove that.
- **WebView2.** The window uses Microsoft Edge WebView2, which Windows 11 includes and most Windows 10 PCs have via
  Edge. Install WebView2 before running Divine Pulse.
- **Linux sandbox.** Where the system stops Chromium's sandbox (Ubuntu's AppArmor rule for namespaces, or as root) the
  window runs without it: it only shows the app's own page.
- **Content.** The release must contain no game content. The release script scans the built zip using
  `tools/game_content.py` (`check_zip`); it checks for game images, game file formats or data, and a missing
  `LICENSE.txt`, `Third-party notices.txt`, `GFDL-1.3.txt` or `Third-party licenses` folder beside the program.
  Players import their own dump on first run.
- **Licenses.** `tools/build.py` copies each bundled package's license text into `Third-party licenses`, and stops if
  one has none. Add the missing text to `packaging/third-party-licenses/`, named after the package, and name the
  package in [the third-party notices](third-party-notices.md); a test checks both.
