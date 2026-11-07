# Changelog

## Unreleased

- Open the Windows desktop app directly and exit completely when the window closes. Eden and Fire Emblem: Three Houses v1.2.0 are required.
- Import extracted game folders or NSPs with your own keys in the app. Each import verifies the complete dataset and keeps the previous valid import if a replacement fails.
- Keep roster updates automatic, with a warning when unit data cannot be read. Remove scan history and whole-update Undo.
- Keep battle actions in chronological order and count completed battles on the standing Divine Pulse timeline in run totals. Retain three raw recordings by default, with a configurable limit from zero to 1000.
- Copy imported replays and resolve run-name conflicts by overwriting or entering a new name.
- Exclude Divine Pulse use from the estimated chance of winning.

## 1.3.0 (2026-11-07)

- Report missing or unreadable required game assets instead of substituting portraits, sprites, icons or terrain; provide a Game files alert and a retry after reimporting.
- Report missing or damaged required imported game tables and selected-language text with their file paths and reimport guidance instead of silently using empty data or a different language.
- Give History's Character Stats and Battle Stats dialogs concise run ledgers with native character sprites, centered sortable numbers, coloured battle-type tags beside dates, sticky names and totals, and a Records tab with record-group filtering.
- Refine Battalion details into a tactical dossier with compact modifiers, imported level progression labelled Level, a readable endurance track and gambit performance beside its native target map; report missing required preview assets instead of drawing substitutes.
- Match the game's gambit previews with the native grid, gold tiles and one correctly facing badge, including target-centred areas such as Group Flames; prompt older game-file imports to refresh.
- Show gambits in the battle log and usage, read enemies' battalions and the rattled status, and leave out battalion bonuses while a unit is rattled.
- Import each gambit's target area and its physical, magic or support icon from the game files, so battalion panels show them.
- Condense the roster table so the unit card beside it gets more room, and keep the Archive class card's Requires, Exam and Moves facts on one line (the exam shows just its level, the movement just its number).
- Put the portrait inside the Roster and Archive information cards, so flipping the card turns the portrait into the map sprite with the biography, and show the map sprite in a round medallion like the portrait there and in battle windows.
- Remove the sidebar's Collapse/Expand button (the rail still opens on hover or keyboard focus and closes on leave or Escape), the eye button beside the Portraits choice in Settings, team dots in battle Awards and the per-fight damage line in run character statistics; swap Tiles moved and Stat increases in battle Records.
- Include the game's battle history entries in battle recordings, so actions the tracker can't name yet (such as gambits) can be studied from them.
- Remove the full stop from unknown crest labels in battle character cards.
- Give Runs a labeled creation form, readable run details and aligned battle summaries; improve Updates scanning, Undo placement and empty states, and allow retrying failed battle loads.

- Let setup optionally save raw NSP extractions in a new folder after a successful import; temporary cleanup remains the default, and existing source folders, NSPs and keys stay untouched.
- Filter weapons with a discrete maximum-rank slider, using notches and a live rank subtitle without redundant printed rank labels; show authentic dark-magic and Alive/Skill filter icons, and keep all Appearance portrait options visible.
- Use eye and eye-slash buttons for showing and hiding spoilers, add existing semantic icons to filter options and selected chips, and capitalize Ability sources as Personal, Class and Skill.
- Center Archive Stats skill chips and match Position zoom to the battle map's notched slider, with terrain and coordinates over the map.
- Refine character Stats, Growth, Position, Fights and Arsenal panels with aligned ledgers, clearer skill ranks and more readable detail rows.
- Keep battle and run statistics consistent, preserve unrecorded values, and open Battle Stats and Character Stats directly from History. Add a run-wide Awards table using the battle Awards' winners and tie rules, counting each finished battle once. Simplify More Stats to labels and values, rename Fight Breakdown and Awards, remove team dots from Fight Breakdown, and center the Awards controls.
- Read each battalion's level, experience, endurance and gambit uses left from the game, live during battles. Show its modifiers at its current level, mark them as not applying when its endurance is spent, count its Charm in Cha as the game's Status page does, and include its modifiers in the fight calculations. Battle records keep their own battalion state.
- Keep battalion identity through incomplete imports, language changes, run exports and unit updates; show each battle's recorded assignment separately from the current roster, with unknown assignments for older recordings. Translate imported gambit details and match battalion panels by ID when available.
- Put character scope beside the name, move compact crest names into the front facts, and rotate bordered information cards with an inside Flip button while portraits stay still. Preserve keyboard and reduced-motion support, and use eye buttons to reveal spoilers throughout the app. Remove battalion header badges and coloured sprite backgrounds.

- Make Supports lost-item cards more compact, with smaller portraits and owners beside them so more items fit on desktop screens.
- Coordinate the sidebar, run banner and active-page highlight during expansion and collapse, with an explicit navigation toggle, Escape support and reduced-motion behavior.
- Apply the Settings font throughout the app, including Home and UI labels; simplify Home run text, remove Cancel from the New run form and space its Start run button, and give all text links white resting text with purple, underlined hover and keyboard focus states.
- Reorganize Battle Records into a battle ledger, themed standouts, each unit's share of the fighting and comparisons with other battles. Keep the share table accessible in shorter windows.
- Show run-wide character statistics when selecting a name in a battle's standouts, with Combat, Form, Growth, Arsenal and Battles sections.
- Organize battle graphs by topic, with turn charts above unit charts, and add accessible carousel controls with pause and reduced-motion support.
- Group Settings behind a section list with unsaved-change indicators and a Save bar that stays visible.
- Move Characters and Crests into the Archive and add a Battalions reference tab. Keep general character reference separate from run-specific information and preserve old character links.
- Give character views a shared design, with portrait-to-sprite interaction on the Roster and in the Archive, larger side-by-side portrait and sprite in battle windows, and fixed window dimensions across sections.
- Fit the updated views within the window with internal scrolling, including phone layouts, and prevent battle-header controls from overlapping.
- Preserve assigned battalion names when imported reference data is incomplete. Add battalion panels that display verified available data and identify fields not yet supported by imports or the game reader.
- Restore the corrected Home chair image from Brand Pack v8 without changing code or layout.
- Import native battalion icons, stat progression and gambit details from player-owned game files.
- Show each class's tier plate beside its name in the Archive's Classes list and tier filters, and redesign the class card: the class's unit on a dais in its tier's colour, its requirements, exam and movement at a glance, its place on the class-change ladder, a stats ledger with growth bars, and mastery rewards set apart.

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
