# Changelog

## Unreleased

- Put character scope beside the name, move crests into the front facts, and flip information cards for biography details with keyboard and reduced-motion support. Remove battalion header badges and coloured sprite backgrounds.

- Reorganize Battle Records into a battle ledger, themed standouts, each unit's share of the fighting and comparisons with other battles. Keep the share table accessible in shorter windows.
- Show run-wide character statistics when selecting a name in a battle's standouts, with Combat, Form, Growth, Arsenal and Battles sections.
- Organize battle graphs by topic, with turn charts above unit charts, and add accessible carousel controls with pause and reduced-motion support.
- Group Settings behind a section list with unsaved-change indicators and a Save bar that stays visible.
- Move Characters and Crests into the Archive and add a Battalions reference tab. Keep general character reference separate from run-specific information and preserve old character links.
- Give character views a shared design, with portrait-to-sprite interaction on the Roster and in the Archive, larger side-by-side portrait and sprite in battle windows, and fixed window dimensions across sections.
- Fit the updated views within the window with internal scrolling, including phone layouts, and prevent battle-header controls from overlapping.
- Add battalion panels that display verified available data and identify fields not yet supported by imports or the game reader.
- Restore the corrected Home chair image from Brand Pack v8 without changing code or layout.

## 1.2.9 (2026-11-01)

First public release. Versions through 1.2.8 were unpublished development builds.

- Track your army's stats, classes and abilities automatically from Fire Emblem: Three Houses update 1.2.0 in Eden.
- Follow battles live and replay them on the map, including alternate timelines preserved after Divine Pulse rewinds.
- Keep separate playthroughs with battle history, run totals, records and character statistics.
- Browse Characters, Archive and Supports offline using your imported game files, with language selection and spoiler controls.
- Install on Windows 10/11 or run the portable app; import extracted game files or selected base game, update and optional DLC NSPs using your own keys.
- Open the portable app in its standalone window even when Windows marks its downloaded DLLs as Internet files.
- Check the packaged WebView2 window with Windows download markers during every build.
- Keep runs, battles and settings on your PC, with no account, telemetry or automatic update check.

## 1.2.8 (2026-11-01)

Unpublished development build.

- Leave unused test framework code out of the program.

## 1.2.7 (2026-11-01)

- Add NSP files from multiple folders and manage the selection before importing.

## 1.2.6 (2026-11-01)

- Import selected NSP files directly from the portable app using bundled extraction tools.
- Include the full license text of every bundled component in a `Third-party licenses` folder beside the program.

## 1.2.5 (2026-11-01)

- Require a choice between extracted game files and individually selected NSPs during setup.

## 1.2.4 (2026-11-01)

- Choose individual base game, update, and DLC NSPs during setup so unrelated NSPs are not imported.

## 1.2.3 (2026-11-01)

- Bundle NSTool with Windows setup so importing NSP files no longer requires a separate download.

## 1.2.2 (2026-11-01)

- Find game dumps and NSP files in nested folders during setup, with clearer setup instructions.

## 1.2.1 (2026-11-01)

- Review the NSP files or dump folders found before importing them during setup.

## 1.2.0 (2026-11-01)

- Import base game, update and DLC NSPs directly during Windows setup using NSTool and your own keys.

## 1.1.0 (2026-11-01)

- Replay the map along the selected Divine Pulse timeline, including paths that were undone.

## 1.0.7 (2026-11-01)

- Scale battle log tree captions down when zooming out.

## 1.0.6 (2026-11-01)

- Choose battle map and unit face appearances separately for your units and other units; the Testing settings tab is now called Debug.

## 1.0.5 (2026-11-01)

- Fall back to portraits when a battle unit has no map sprite; use weapon badges only when neither is available or badges are explicitly selected.
- Fix combat art icons, which showed the wrong weapon on 64 of the 80 arts. No reimport needed.
- Import dining hall recipes and character meal preferences from your game files; Meals now shows ingredients, quantities, and liked/disliked portraits like Gifts. Reimport game files to update an existing import.

- The Supports page's Gifts & Lost Items tab is now called Gifts, Meals, and Lost Items.
- The game files screen links to NSP Unpacker, for anyone who has their game as NSP files.
- Keep Byleth's hair green after chapter 10, including Holy Tomb and later auxiliary battles; recover the correct look in existing rosters and battle recordings.
- The home page has a small Ko-fi link in its corner, for anyone who wants to leave a tip.

## 1.0.4 (2026-10-31)

- Fix Crest Stone markers flooding the Holy Tomb minimap with cyan; show Demonic Beasts across their four tiles and use the Crest Stone Shard weapon icon instead of fists or swords, including older recordings.

## 1.0.3 (2026-10-31)

- Restore Meals under Supports → Gifts & Lost Items; reimport game files to load the 32 dining hall meal names. Recipes and preferences are not yet decoded.

## 1.0.2 (2026-10-31)

- Byleth's portrait now follows their hair in your game: green from the Sothis merge on, on the roster and the Characters page too.
- The uninstaller is in the Start menu, closes the tracker if it's still in the tray, and asks whether to delete your saved data too. Keeping it stays the default.

## 1.0.1 (2026-10-31)

- Importing game files now says what's missing when a dump isn't complete: it needs the game with update 1.2.0 and its ExeFS. DLC stays optional.

## 1.0.0 (2026-10-31)

- Tracks your army, battles and runs by reading the game's memory in Eden, with nothing to type.
- Battle page: live units, outlook, action log from the game's Divine Pulse history, map and step-by-step replay.
- History of a run's battles, with run totals, records and each character's stats.
- Characters, Archive and Supports reference pages, in any of the game's languages.
- Imports everything game-related from your own game dump; the program itself includes no game art, text or tables.
- The local server refuses requests from other websites.
