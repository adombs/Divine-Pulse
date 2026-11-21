# Divine Pulse

<img src="branding/icons/app-icon-rounded-1024.png" alt="" width="96" align="right">

Divine Pulse is a free, offline companion for players who emulate **Fire Emblem: Three Houses** on Windows or macOS. It reads the game while you play and keeps your runs and battles on your computer.

[Download for Windows](https://github.com/adombs/Divine-Pulse/releases/latest) · [Contributing](.github/CONTRIBUTING.md)

## Requirements

- Windows 10 or 11, 64-bit, with Microsoft Edge WebView2; or macOS 12 or newer on Apple silicon (see
  [macOS](#macos)).
- One of these, picked under Settings > General > Game: **Eden** with fastmem enabled (Windows), **Astris** (macOS) or
  **Ryubing**/Ryujinx, or **FE3H Recomp by onerag90** (Windows); and **Fire Emblem: Three Houses v1.2.0**.
- Your own base game and 1.2.0 update files, with optional DLC.

Divine Pulse reads game memory. It does not write to the emulator or game. It has no accounts, telemetry, update check, or network service beyond its own local window.

## macOS

Build the app with `python3 tools/build.py --skip-tests`: it makes **release/Divine Pulse.app** (open it, or drag it to
Applications) and a zip of it to share. You need Python 3.12 or newer (`brew install python@3.13`; the build finds it
even when `python3` is macOS's older one), Node.js, and Xcode's command-line tools (`xcode-select --install`). The app
is signed ad hoc, not notarized: on another Mac, open it the first time with right-click > Open, or allow it in System
Settings > Privacy & Security. Its data folder is ~/Library/Application Support/Divine Pulse.

To run from the source checkout instead, run `tools/setup.sh` once, then `tools/launch.sh`.

Choose **Astris / Ryubing** under Settings > General > Game (the default on macOS). macOS lets another program read an
app's memory only when the app allows debugging, as Astris's releases do; Divine Pulse builds and signs a small
reader for this (`backend/app/system/macos`), included in the built app. It only reads.

To import NSP files, download the latest macOS NSTool from
[its releases page](https://github.com/jakcron/nstool/releases/latest) (`macos_arm64` for Apple silicon), unzip it, and
leave `nstool` in Applications or Downloads: Divine Pulse finds it there. The first time it runs, macOS may block it
as a download; allow it in System Settings > Privacy & Security, then import again. Importing a dump folder needs
nothing extra.

## Install and import

Run the Windows installer or unpack the portable ZIP. Open **Divine Pulse.exe** in either case. Close the window to exit the app.

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

**Settings → About** opens the app's data folder. Installed copies normally use %LOCALAPPDATA%\Divine Pulse. A portable copy uses a data folder next to the executable if you create one.

Appearance and spoiler preferences apply to this installation. **Settings → General** controls how many raw battle recordings to retain, from 0 to 1000. The default is three, and zero turns raw recording off. Saved replays in History are separate from raw recordings.

To update, run the newer installer over your installation or uninstall and reinstall. For a portable copy, replace the program files. On first launch with existing records and during an interactive uninstall, you can choose whether to keep your runs and battle history. Uninstall also removes the application's imported assets, settings, and raw recordings. Use the export command to back up runs separately.

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
