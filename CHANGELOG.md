# Changelog

## Unreleased

- Export Team draws each unit's face as its portrait or its map sprite (Portrait to begin with); the portrait with the sprite on its corner is gone, and a saved choice of it becomes Portrait. Fallen units stay greyed in both images, without the skull by their name (the unit list in the dialog keeps it).

- Battle cards (History and All Battles) show their kind (Mission, Auxiliary, Quest, Paralogue, DLC) at the right of the bottom row beside the units, instead of over the map, and the date as mm/dd/yyyy with the time. Long battle names, figure notes, record names now wrap instead of being cut off, and the eBST diamonds on the Roster's stat panel are no longer clipped.

- Save Export Team's images at exactly the size the dialog shows, with nothing cut off: the picture was drawn from the page's styles as the browser re-wrote them, and Chromium writes a `font` or `border` shorthand that uses a variable and is then partly overridden (as in the run statistics' column headings) as blanks, so the image was laid out in the wrong font, came out a different size from the one shown and lost its edges. The styles are now read as written, and the image starts from the same inherited font as the page. Battle videos are drawn the same way and benefit too.
- Show each character's one portrait on the battle page whatever their HP: a unit under a quarter of its HP no longer swaps to the game's hurt expression (Marianne's eyes-closed face), so the battle page matches the Roster and the exports. Enemies who aren't known characters still show the game's own face for them.

- Count a battle's fights and kills from the game's battle history instead of its own counters, which the game rewrites when a battle ends (finished battles showed no fights and no kills). Battles recorded before this keep the numbers they were saved with.
- Count a unit that fell as lost wherever losses are shown (History's cards and Flawless filter, the battle's Units count and comparison, the run's Units Lost, the outlook and the best unit).
- Add up what was recorded in battle and run totals (damage, healing, movement, fights and kills): an adjutant, which is in the battle without being on the map, has no numbers of its own, and it no longer turns the army's totals into dashes.

## 1.4.0 (2026-11-08)

- Sort battles into five kinds with the same names everywhere (the battle page, History's cards, filter and comparison, Battle Stats and the video header): Mission Battles (formerly Main battles), Auxiliary Battles, Paralogue Battles, Quest Battles and DLC Battles, shown singular on a tag and plural in filters. DLC Battles are the five extra auxiliary battles (formerly Auxiliary battles) and Cindered Shadows. A Quest Battle runs on an ordinary auxiliary map, so the app tells it apart by the quest the game reads for it, and titles it with the quest's name ("Maintaining Your Training") instead of the map's; re-import your game files once to get the quest names (until then it is titled by its map). Recorded battles take the new kinds as they are read, so nothing needs migrating; a quest battle recorded before this shows as an Auxiliary Battle.
- Add map sprites for Jeralt, Rhea and Sothis, and draw the right ones for Flayn, Hanneman, Manuela, Gilbert, Alois, Catherine, Shamir and Cyril (their finished sprites were read from the previous character's slots); re-import your game files once to add them.
- Export a battle's replay as an MP4 video (Export Video, beside Copy Summary): a window previews the video, with the map, the turn in its corner and the log as a list beside it (landscape, 1920 × 1080) or under it (portrait, 1080 × 1920), and sets the turns it covers, its own replay speed, camera and zoom, a battle theme to play under it (the battle's own to begin with; grouped by where they play, with a volume and a button to listen first), and the video's resolution (720p to 4K), frame rate (30 or 60) and quality. Scrubbing the preview pauses it. The video is made in the app, carries the run's emblem in its title, and is saved where you choose.
- Import the 20 battle themes with your game files, each in its calm Rain and its intense Thunder version, and which theme each battle plays from the game's own data; re-import your game files once to add them (and again if you already imported them before Thunder was added).
- Choose Rain or Thunder for the music in Export Video, a switch under the theme list that also sets what the listen button plays (Rain to begin with, and remembered). Until the game files are imported again, Thunder is greyed out and says so.
- Set Export Video's music volume to any whole number from 0 to 100% (it had five steps), and keep the speed and volume numbers beside their sliders at one width so the sliders no longer change size as they move.
- Tighten the log in Export Video's frames (landscape and portrait): the time sits right beside the icon and the text gets the width that frees, in the preview and in the saved video alike.
- Use less memory in Export Video on long, high-resolution videos: the file is now written to disk as it is made and the soundtrack is made a second at a time. Memory still grows with the video's length, so a long 4K video (a few minutes) can still run out of memory on a PC with little of it; pick a lower resolution if it does.
- Add 0.75×, 1.5×, 2.5× and 3.5× replay speeds.
- Export the team as two images from the Roster (Export Team, beside Back): an overview of each unit (stats, base stat total, equipment, spells, combat arts, abilities and battalion) on cards as tall as the unit's portrait and stats, with the rest in columns beside them, as many units side by side as you choose, and their run statistics (combat and growth over the run's finished battles, with each unit's three most telling records). The images carry the run's emblem, and their size and which of the two to save can be set. All units are included unless you leave some out, and dragging a unit by its handle (or Alt and an arrow key) into a slot of a grid laid out like the overview sets where it goes: an empty slot leaves a row a unit short, and a full one swaps the two. Order puts every unit in order at once: by BST, deployments, when they joined (their first battle) or name.
- Read the game from FE3H Recomp by onerag90 (the native Windows recompilation of Three Houses) as well as Eden: choose where under Settings > General > Game. Eden stays the default; nothing else about tracking changes.
- Link more of the battle log, in the list and the tree: gambits open their battalion in the Archive, and the units in the "Battle started", level-up, joined, left and stat-gain lines open their cards.
- Declutter the log's tree view: a dot you point at shows its log row once (in the card that grows out of it, not also on the tree), and the rest of the open path's rows fade back while the card is open.
- Make tracking much faster and more responsive: a read of the game during a battle took about two seconds and now takes a few milliseconds, so the battle page follows the game as it happens.
- Find a new battle's units without waiting: the tracker checks where they were last time first, and only searches the game's memory in the background.
- Put the portrait on the battle Units tab's character card: flipping the card turns the portrait over to the map sprite, as on the Roster.
- Take each unit's affiliation in a battle straight from the game's memory, under the game's own faction name, and update it during the battle if it changes (a reveal, as in the Holy Tomb). Byleth's is the Church of Seiros, as the game's record has it, whatever house the run chose.
- Keep units that died (Classic mode) on the Roster, greyed out with a fallen mark in a Fallen group below the living. Who is dead comes from the game itself (the "Is Dead" flag on each unit's roster record), so a restarted battle, a Divine Pulse or Casual mode leaves a unit alive; the battle recordings only supply where it fell. Its card says where it fell and opens that battle with the replay at the step it fell; Mark as Alive on the card fixes a wrong call. A Status filter (Alive / Dead) joins the shared people filters, and History's statistics, the Archive's "in run" marks and the battle's Units tab show the dead too.
- Handle units that died (Classic mode) in Export Team: an "Include fallen units" switch above the unit list (on to begin with, remembered) puts them in both images greyed with the fell mark by their name, or leaves them out of both; the run statistics follow the overview, and the unit list greys them too.
- Choose how Export Team draws each unit's face, in both images: its portrait, its map sprite in its class, or the portrait with the sprite as a medallion on its corner (to begin with, and remembered). A unit with no sprite (the game's sprites aren't imported) keeps its portrait.
- Show each unit's mastered classes: a Class Mastery tab on the Roster's character view (with each class's tier plate, lowest tier first) and a Class Mastery section on each unit's card in the Export Team overview (left out for a unit with none). The classes come from the game's own record of each unit: a mastered flag for every class, which the game sets the moment a class is mastered (checked on a battle in which two units mastered their classes). Noble and Commoner count like any other class. Units saved before this show "Not read yet" until the game is read again.
- Polish the Roster, Export Team and Export Video: the Roster's unit card fits every stat without scrolling (Offense and Defense moved below the stats and made compact, the flip button a symbol in the card's top right, one thin ring round the portrait everywhere, no "Updated" line), Class Mastery sits right of Battalion, the table header stays solid when scrolled and its eBST column is no longer clipped in narrower windows, fallen units show a skull, a unit can no longer be marked dead by hand (only marked alive again), and the battle log's times sit right beside their icon as in the video. Export Video's preview now fills the window with its transport bar under it, its options are one label-control-value form (Zoom now shows its value; the video's facts stay on one line), and the battle map's speed and zoom sliders are the same length, spaced evenly with the camera switch. Export Team's preview can be shown full size to read it and its unit grid keeps its height. Remove light mode: the app has one dark theme, Settings no longer has a Theme choice, and neither export window has a Theme option (a saved Light setting is ignored).

## 1.3.1 (2026-11-07)

- On the battle map, show a unit's portrait when it has no map sprite, and a "?" when it has neither; missing images elsewhere also show "?".
- Give a unit with no known house or faction its army's banner (enemy, ally, third army or yours) from the game's own army pennants.

## 1.3.0 (2026-11-07)

- Open the Windows desktop app directly and exit completely when the window closes. Eden and Fire Emblem: Three Houses v1.2.0 are required.
- Import extracted game folders or NSPs with your own keys in the app. Each import verifies the complete dataset and keeps the previous valid import if a replacement fails.
- Optionally keep the raw files extracted from your NSPs after a successful import. By default, the app removes its temporary extraction files.
- Keep roster updates automatic, with a warning when unit data cannot be read. Remove scan history and whole-update Undo.
- Keep battle actions in chronological order and count completed battles on the standing Divine Pulse timeline in run totals. Retain three raw recordings by default, with a configurable limit from zero to 1000.
- Copy imported replays and resolve run-name conflicts by overwriting or entering a new name.
- Exclude Divine Pulse use from the estimated chance of winning.

- Report missing or unreadable required game assets instead of substituting portraits, sprites, icons or terrain; provide a Game files alert and a retry after reimporting.
- Report missing or damaged required game tables and English text with their file paths and reimport guidance.
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
- Give Runs a labeled creation form, readable run details, aligned battle summaries, and a retry when battle history fails to load.
- Filter weapons with a discrete maximum-rank slider, using notches and a live rank subtitle without redundant printed rank labels; show authentic dark-magic and Alive/Skill filter icons, and keep all Appearance portrait options visible.
- Use eye and eye-slash buttons for showing and hiding spoilers, add existing semantic icons to filter options and selected chips, and capitalize Ability sources as Personal, Class and Skill.
- Center Archive Stats skill chips and match Position zoom to the battle map's notched slider, with terrain and coordinates over the map.
- Refine character Stats, Growth, Position, Fights and Arsenal panels with aligned ledgers, clearer skill ranks and more readable detail rows.
- Keep battle and run statistics consistent, preserve unrecorded values, and open Battle Stats and Character Stats directly from History. Add a run-wide Awards table using the battle Awards' winners and tie rules, counting each finished battle once. Simplify More Stats to labels and values, rename Fight Breakdown and Awards, remove team dots from Fight Breakdown, and center the Awards controls.
- Read each battalion's level, experience, endurance and gambit uses left from the game, live during battles. Show its modifiers at its current level, mark them as not applying when its endurance is spent, count its Charm in Cha as the game's Status page does, and include its modifiers in the fight calculations. Battle records keep their own battalion state.
- Keep battalion identity through run exports and unit updates. Show each battle's recorded assignment separately from the current roster, with unknown assignments for older recordings. Show imported gambit details in English and match battalion panels by ID when available.
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
