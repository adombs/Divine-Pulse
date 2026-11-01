# Changelog

## Unreleased

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

First public release.

- Tracks your army, battles and runs by reading the game's memory in Eden, with nothing to type.
- Battle page: live units, outlook, action log from the game's Divine Pulse history, map and step-by-step replay.
- History of a run's battles, with run totals, records and each character's stats.
- Characters, Archive and Supports reference pages, in any of the game's languages.
- Imports everything game-related from your own game dump; the program itself includes no game art, text or tables.
- The local server refuses requests from other websites.
