# Divine Pulse

<img src="branding/icons/app-icon-rounded-1024.png" alt="" width="96" align="right">

Divine Pulse is a free, offline companion for players who emulate **Fire Emblem: Three Houses** on Windows or macOS. It reads the game while you play and keeps your runs and battles on your computer.

[Download for Windows or macOS](https://github.com/adombs/Divine-Pulse/releases/latest) · [Contributing](.github/CONTRIBUTING.md)

## Requirements

- Windows 10 or 11, 64-bit, with Microsoft Edge WebView2; or macOS 12 or newer on Apple silicon (see
  [Install](#install)).
- One of these, found automatically (or picked under Settings > General > Game): **Eden** with fastmem enabled
  (Windows), **Astris** (macOS) or **Ryubing**/Ryujinx, or **FE3H Recomp by onerag90** (Windows); and
  **Fire Emblem: Three Houses v1.2.0**.
- Your own base game and 1.2.0 update files, with optional DLC.

Divine Pulse reads game memory. It does not write to the emulator or game. It has no accounts, telemetry, update check, or network service beyond its own local window.

## Install

**Windows.** Run the installer (`Divine-Pulse-<version>-setup.exe`) or unpack the portable ZIP, then open
**Divine Pulse.exe**. The program isn't code-signed: if SmartScreen warns about an unknown publisher, choose
*More info > Run anyway*. NSTool, for importing NSP files, comes with it.

**macOS.** Unzip `Divine-Pulse-<version>-macos-arm64.zip` and drag **Divine Pulse.app** to Applications, then open
it. The app is signed ad hoc, not notarized: the first time, right-click it and choose Open, or allow it in System
Settings > Privacy & Security. To import NSP files, download the latest macOS NSTool from
[its releases page](https://github.com/jakcron/nstool/releases/latest) (`macos_arm64` for Apple silicon), unzip it,
and leave `nstool` in Applications or Downloads: Divine Pulse finds it there. The first time it runs, macOS may block
it as a download; allow it in System Settings > Privacy & Security, then import again.

On both, close the window to exit the app. Divine Pulse finds the emulator on its own (Settings > General > Game is
**Auto** by default). macOS lets another program read an app's memory only when the app allows debugging, as Astris's
releases do; Divine Pulse includes a small reader for this (`backend/app/system/macos`), signed to be allowed to. It
only reads.

## Import your game

Import your files in Divine Pulse. The installer only installs the program. Choose one of the following:

- **Dump folder.** Select a folder containing the base and update RomFS and the update's ExeFS. Include the RomFS for any DLC you own.
- **NSP files.** Select your base game, update, and any DLC NSPs, then select your own prod.keys. Extracted intermediate files are temporary by default. Choose a new destination if you want to keep the raw extraction after a successful import.

One import prepares the full dataset, including all available languages. Divine Pulse displays English game data. The app does not ship game files. A failed replacement reports what went wrong and preserves the previous valid import.

To replace, verify or remove an import later, open **Settings → Game files**. If setup finds an earlier import, it asks whether to keep, replace, or delete it.

## Play with Divine Pulse

Create or load a run from Home before you start playing. The active run is the one that receives the units and battles read from the emulator. Choose a different run when you change playthroughs.

- **Unit Tracker.** See your army's stats, classes, skills, inventory, abilities and battalions. Switch between the displayed and base stats. eBST compares your units using the offense, defense and other stats you choose.
- **Battle Companion.** Follow turn order, units, HP, status, supplies, terrain, and the action log. The Battle page opens automatically when a battle starts. The roster automatically filters to deployed units and the app notifies you about departures and Divine Pulse.
- **Replay Viewer.** Open a battle from History and step through its map and log. Rewinds remain visible as separate branches. Run totals and records use completed battles and the timeline that stood when each battle ended.
- **Offline Reference.** Archive and Supports use the files you imported for characters, classes, abilities, weapons, spells, items, battalions, support pairings, gifts and other reference information.

If you resume the same battle in the emulator, including from a bookmark, Divine Pulse continues its existing record. You can delete individual battles from History. Use the import and export controls on Runs to move run or battle records between installations.

## Your files and settings

**Settings → About** opens the app's data folder:

| | Windows | macOS |
|---|---|---|
| Data folder | %LOCALAPPDATA%\Divine Pulse, or a `data` folder next to Divine Pulse.exe if you create one (portable) | ~/Library/Application Support/Divine Pulse |

Appearance and spoiler preferences apply to this installation. **Settings → General** controls how many raw battle recordings to retain, from 0 to 1000. The default is three, and zero turns raw recording off. Saved replays in History are separate from raw recordings.

| | Windows | macOS |
|---|---|---|
| Update | Run the newer installer over your installation, or replace the portable copy's program files | Quit the app and replace Divine Pulse.app with the newer one |
| Remove | Uninstall from the Start menu or Windows Settings > Apps; delete a portable copy's folder | Drag the app to the Trash, then delete its data folder |

The data folder is kept when you update. On first launch with existing records, and during an interactive uninstall
on Windows, you can choose whether to keep your runs and battle history; uninstalling also removes the imported game
files, settings and raw recordings. Use the export command on Runs to back up runs separately.

## Build or run from source

The same steps on Windows and macOS; [Contributing](.github/CONTRIBUTING.md) has the details.

| | Windows | macOS |
|---|---|---|
| Needs | Python 3.12+, Node.js 22.12+; Inno Setup 6 for the installer | Python 3.12+ (`brew install python@3.13`), Node.js 22.12+, Xcode's command-line tools (`xcode-select --install`) |
| Set up once (and after pulling changes) | `tools\setup.bat` | `tools/setup.sh` |
| Run from source | the *Divine Pulse (source)* desktop shortcut, or `tools\launch.bat` | the *Divine Pulse (source)* desktop shortcut, or `tools/launch.sh` |
| Build the release | `python tools/build.py` | `python3 tools/build.py` |
| What the build makes, in `release/` | `Divine-Pulse-<version>-windows-portable.zip`, `Divine-Pulse-<version>-setup.exe`, `SHA256SUMS.txt` | `Divine Pulse.app`, `Divine-Pulse-<version>-macos-<arch>.zip`, `SHA256SUMS.txt` |

`tools/build.py` finds a Python 3.12+ itself when started with an older one (the `py` launcher on Windows, Homebrew's
or python.org's on macOS) and builds in its own environment. Add `--skip-tests` to skip the tests, and on Windows
`--no-installer` for only the portable ZIP.

## Credits

Divine Pulse is a fan-made tool, not affiliated with or endorsed by Nintendo, Intelligent Systems or Koei Tecmo.
*Fire Emblem: Three Houses* is © Nintendo / Intelligent Systems / Koei Tecmo. Divine Pulse contains none of its
content; you import your own.

Divine Pulse is made by Adombs. Its logo and icons are in [`branding/icons/`](branding/icons/). It's free; to support
my work on it, you can leave a tip on [Ko-fi](https://ko-fi.com/adombs).

The Windows app includes [NSTool](https://github.com/jakcron/nstool) by Jack (jakcron) to extract NSP files.
[NSP Unpacker](https://github.com/adombs/nsp-unpacker) is a separate tool by the same author that also runs NSTool.

It builds on the work of the Fire Emblem community:

- [Fire Emblem Wiki](https://fireemblemwiki.org): class change and support availability text (GFDL 1.3), terrain
  effects, battalions.
- The [Three Houses Research Group](https://github.com/three-houses-research-team): the game's file formats, and the
  terrain and battle name lists from their [bsic](https://github.com/three-houses-research-team/bsic) map editor.
- [fe3h.com](https://www.fe3h.com/linked_attacks), [Samurai Gamers](https://samurai-gamers.com/fire-emblem-three-houses/),
  [Corridors of Time](https://corridorsoftime.substack.com/p/on-game-mechanics-pt-1) and the
  [FE Universe](https://feuniverse.us/t/fire-emblem-three-houses-randomizer-custom-build/9774) forums: game mechanics.

[Third-party notices](docs/third-party-notices.md) lists what each source was used for, and the open-source software
bundled with the program and its licenses. A copy ships with every release as *Third-party notices.txt*.

## License

GPL-3.0. See [LICENSE](LICENSE).
