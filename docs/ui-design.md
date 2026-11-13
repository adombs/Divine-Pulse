# UI design

How the app's pages are put together, so new screens look and behave like the rest. The look itself (banners, cogs,
paper, diamonds, styled after the in-game Status page) is separate; this is about structure.

implementation, testing, or screenshot work on phone/mobile views unless explicitly requested.

## Principles

1. **Summary first, detail on demand.** Every page opens on what matters most (a few numbers, a list), and
   everything else is one obvious step away: a tab, a selected row, an expandable group. Nothing is hidden behind
   a hover.
2. **One way to do each thing.** The same component wherever the same idea appears: a page header, a list with a
   detail card, a log, a number tile, a meter. A user who learns one page knows the others.
3. **Select a row to see it.** Lists of things (units, characters, classes, enemies, battles) are tables or lists on
   the left; selecting a row fills the detail card on the right (below on narrow screens). The selected row is
   highlighted and the card is titled with its name, so it's always clear what the card shows.
4. **Expand to see more, without scrolling to find it.** Long lists (a battle's log) are grouped (by turn); groups
   show a one-line summary and a chevron that turns when open. A detail card's sections are a bar of icons along
   the card's bottom (layout.tsx `DetailCard`): an icon grows into its section's name while the pointer or keyboard
   focus is on it, and the picked section fills the card, so nothing is out of sight below the fold. Folds inside a
   section stay an accordion (disclosure.tsx): a one-line summary on every header, one open at a time. Bigger things open in a window (Modal.tsx) over the page. "Show all" buttons say how many are
   hidden.
5. **Say where numbers come from.** Estimates are marked (“≈ 82%”, “best guess”), untracked values show “—” with a
   reason on hover, never a fake zero.
6. **One icon pack.** Every icon comes from `Icon` (Icon.tsx: Phosphor Icons, duotone), named by meaning (`first`,
   `prev`, `play`, `next`, `last`, `attack`...), never a text symbol. The list is in frontend/scripts/build-icons.mjs.
7. **One slider.** Zoom and text size are the same `StepSlider` (Slider.tsx: notches at every stop, step buttons at
   the ends); the replay's timeline is its taller variant with a notch per step.
8. **Motion is quiet and quick** (0.15-0.3 s): views fade in, sections slide open, windows rise in. Reduced-motion
   settings turn it off.
9. **Avoid explanatory clutter.** Do not add unsolicited subtitles, repeated counts, sorting hints, or permanent
   footer legends. Unknown values keep their sentinel and accessible reason. In History statistics, character
   sprites sit beside names, numeric columns are centered, and battle types reuse History's colours.
10. **Annotations take the army's colour.** Everything drawn on the map about an action (the arrow, the action badge,
   the impact rings and the replay's labels: damage, healing, arts, items) is in the colour of the army of the unit
   that acted: Your Units blue, Enemy Units red, Ally Units green, Third Army yellow (`--team-*`). Never the action's
   own colour: an enemy's heal is red, your attack is blue.

## Page anatomy

```
PageHeader   title [essential status, when needed]                 actions
             [ Sub-tab ]  [ Sub-tab ]  [ Sub-tab ]                  (when the page has views)
Tiles        a few key numbers (optional, always visible for the thing shown)
Body         MasterDetail (list + DetailCard), a log, or sections
```

Components (frontend/src/components/layout.tsx unless noted):

| Component | Use |
|---|---|
| `PageHeader` | Every page: the page's sidebar icon and title, status chips, actions and Back at the right, optional sub-tabs with counts (`SubTabs`, common.tsx). |
| `StatusChip` | A short status in a header or row: `live`, `good` (active), `bad`, `warn` (to check, unsaved), `accent` (a temporary view such as "Comparing as"). |
| `MasterDetail` | A list (its children) on the left and a `DetailCard` on the right; stacks on narrow screens. |
| `DetailCard` | The banner-titled card for the selected thing (Roster, Characters, Classes, Supports, Runs, Battle units / enemies). `actions` are icon buttons at the top right of its name banner (in a character window, of the window's header); its `Section`s make up the icon bar along its bottom. |
| `Section` | A headed block inside a card or page. |
| `Facts` | A card's key/value list (Class, Level, Status). |
| `Tiles` / `Tile` | Key numbers with a label and a note. |
| `Meter` | A thin bar for a share (HP, magic left). |
| `RowList` / `ListRow` | A list of selectable rows with a lead chip, a title, facts and "Open ›" (battle history, runs). |
| `EmptyState` | What to do when there's nothing to show yet. |
| `Fold` (common.tsx) | An expandable group with a summary line. |
| `Segmented` (ui.tsx) | One-of-several filters, with counts in the labels ("Defeated 4"). |
| `useSort` (common.tsx) | Sortable table headers. |
| `NoMatches` (common.tsx) | A filter left nothing: says so, with a button to show everything. |

Text helpers shared by every page (`clock`, `plural`) are in frontend/src/format.ts.

## Battle page

The page follows the live battle ("No battle in progress" otherwise). A past battle opens at
`#/battle/<id>` in the same views (`BattleView`), with its date instead of Live. It
fills the sheet: the header stays put and the view below fits the screen (the Overview never scrolls the page at
16:9 / 16:10; the Settings text size slider scales everything).

- **Header:** the battle's name with its chapter ("Chapter 7: Battle of the Eagle and Lion", battle/scenarios.ts,
  from the game's scenario id; Part II chapters by route, from the house leader fighting), its kind (Mission,
  Auxiliary, Paralogue, Quest or DLC Battle; see below) and place when known, Live (or its date), and the numbers worth a
  glance in game: time, turn, units on the map, army HP, enemies, Divine Pulse, outlook (on the Overview they're
  cards instead; elsewhere they're small cards under the header). Actions: Copy Summary, Export Video; for a recording Live Battle
  (while one runs) and Delete. Export Video (battle/ReplayExport.tsx) opens a window with the video's frame previewed
  as it plays (title strip with the "by Adombs" credit, the map with its turn banner and no legend, the log as a
  list up to the step shown) and options down the right in tabs (role tablist, arrow keys move between them, the last one is remembered; the panel itself never scrolls at normal desktop sizes): **Format** (aspect ratio 16:9, 1.91:1, 9:16 or 4:5; the video's resolution, frame rate and quality), **Replay** (turns, speed, camera, zoom), **Team** and **Music** (the battle themes imported with the game files, the battle's own first, in its Rain or Thunder version; or Your own audio, a file the player picks: MP3, M4A, OGG, WAV or FLAC, decoded once in the window, looped when shorter than the video and cut with a one second fade-out when longer, shown with its name and length and a Remove that goes back to the battle's theme, an unreadable file giving an inline error and keeping the earlier choice, never kept between sessions; a 0-100% volume for either). The summary line and the Export MP4 button stay under the tabs.
  Team tab (battle/TeamPages.tsx; off to begin with): the team overview can be put before the replay, after it, or both (Start, End, Both). Every page stays exactly 1 second, with a 0.2 second crossfade inside it, the music playing on through. A page is the frame (paper, its inner line, the title strip with the run's name, "Team Overview" and "2 / 4") around one centred column of the video's own compact unit cards (battle/TeamVideoCard.tsx, nothing like Export Team's loadout card, which is unchanged), drawn as big as keeps their smallest text at 2% of the frame's height (22 px at 1080p), as many to a page as fit (7 in 16:9 and 1.91:1, 4 in 9:16 and 4:5), the units in their order flipped through until all are covered. A card has the face (portrait or sprite), name and class, the ten stats, the weapon or spell the unit used most in that battle (the battle's own record of what each unit used, `BattleUnit.usage`; a tie goes to the one used last in the log, and a unit that made no attack shows its equipped weapon; exporting/mostUsed.ts), its accessory and battalion when it has them, and its abilities as bare icons (named by their title and label); it is one line in a wide frame and stacked in a narrow one. The tab shows how many pages it makes, the Order menu (every criterion both ways), faces, the fallen switch and the draggable unit slots as in Export Team; only the unit grid scrolls, inside itself, for a long roster. A video is written to a temporary file in the page's
  A video is written to a temporary file in the page's private storage as it is made, and the soundtrack a second at a time, so memory doesn't grow with its length. The map takes all
  the room its view needs and the log the rest; zoomed in, the camera's view widens to fill that room. Tabs: **Overview · Units · More Stats**.
- **Overview:** three columns. The map (as big as it fits, with the replay timeline under it), the Units
  (UnitStatus.tsx: everyone on the board but objects, filterable by team, as at the replay's step; HP, and warnings
  on your units: at risk, losing them loses the battle, no magic, a weapon about to break, fell; live, those yet to
  act first by eBST and those that acted dimmed), and the Log (the latest lines up to the replay's step, that step
  highlighted). Under the Units and the Log, the key numbers as cards
  and the outlook with its trend.
- **More stats:** fits the screen, in two sub-tabs: Records (tiles, record awards such as MVP and Heaviest Blow, how the battle compares with the run's others) and Graphs, grouped as Combat, Support, Board and Growth & Supplies, with per-unit and per-turn charts (damage, healing, fights, outlook, units and HP left, tiles moved, lowest HP, gear used); boxes with nothing to show aren't drawn. Charts live in battle/charts.tsx; a turn picked on a chart opens its fights in a window.
- **The map** (on the Overview and in unit cards): the battle map drawn like the game's minimap (`Minimap`, battle/Minimap.tsx), in a plain panel like the
  page's other blocks: a light grid over the tiles, each unit a rounded badge in its army's colour, yours blue with
  their portrait, the others red with a glyph of the weapon they fight with (battle/mapIcons.tsx, EnemyStats.weapon),
  the defeated greyed out with the log's fell / defeated badge; an HP bar under each unit and a red glow when it's low. The grid covers the tiles units have stood on (maps are at most 32 × 32). When the map's
  terrain is known (`Battle.terrain`) the grid is the whole map and the map is drawn from the game's own minimap
  pieces (`map.gameMinimap`, `map.minimapTile`), with a terrain legend under the unit legend (kinds on this map only; the small maps leave it out). Hovering a tile names
  it with its bonuses ("Forest (Avo +30, Def +1)"); a unit's tooltip and the side panel's Tile and Terrain rows say
  what it stands on. Without terrain the grid is plain. Live, the view follows the game's map cursor
  (`Battle.cursor`, drawn as gold corners), about 10 × 10 tiles and kept inside the map; a Zoom slider above the
  map has 10 stops from the whole map to 5 tiles across, the wheel steps through them and dragging pans until the
  cursor moves again. Picking a unit (click, or Enter on a focused one) rings it and shows it in the side panel with links to its card and the log.
  With the game's history, a replay bar under the map (replay.tsx: to the beginning, previous step, play / pause, next
  step, to the end, and a timeline with a notch per step, taller at each turn and coloured by phase; the step's phase in
  a banner of its army's colour above the side panel) steps through the battle: the step's move is a soft trail in its army's colour from the tile it left (a footprints badge), its attack (red) or
  heal (green) an arrow to the target, and the side panel's Log follows the replay. Without the history the map
  shows where things stand now and says why it can't replay. The same map, with the same replay bar, is on the Overview (picking a
  unit rings it there) and in unit and enemy cards ("On the map": that unit ringed, the others faded).
- **Units:** everyone in the battle, yours and the others, in one sortable table (HP, status, fights, damage dealt
  and taken, healing, defeats, any alert), filterable by side (Your Units / Enemy Units / Ally Units / Third Army) and by status (Alive / Killed / Left the Map), and searchable. Selecting one shows its card: level and growth, combat totals, supplies left,
  where it is on the map, who it fought (opponents, with damage both ways) and every fight and action it took, as an
  accordion of sections.
- **Log** (the Overview's right column): every action and event as a tree of timelines or a list grouped by turn (the latest
  open), phases as thin banners in their army's colour. The Timeline picker goes from Divine Pulse 0 (the battle as
  it first went) to the timeline that stands; names open that unit's card.
History is a page of its own (HistoryPage.tsx), one page with three blocks:

- **Battles:** the latest three as cards (the map beside the numbers); All battles opens a window with every battle
  of the run, newest first, searchable by name, kind, place, result, date and unit. Opening one shows it on the Battle page as a
  recording (`#/battle/<id>`). On wide screens the page fits the sheet: the
  characters fill the rest and scroll in their own columns.
- **Battle kinds:** every battle is one of five kinds, read from its scenario id (battle/scenarios.ts; nothing is
  stored, so older recordings take the same kinds): Mission Battles (the story, ids 0-37), Auxiliary Battles (61-80),
  Paralogue Battles (38-60, 93, 94, 97) and DLC Battles (81-85, the extra auxiliary battles, and 86-92, Cindered
  Shadows). A Quest Battle runs on an ordinary auxiliary scenario and map, so the scenario can't say: the game's memory
  holds the quest it is for (`Battle.quest`, its row in the quest table, a byte in the global data at
  app/data/battle_fields.json "quest"; 151 or more when none), and a quest of `app/data/quest_battles.json` (the quests
  that have a battle) makes it a Quest Battle, titled with the quest's name (text category `quest_title`). A tag says it
  in the singular ("Mission Battle"), filters and counts in the plural ("Mission Battles").
- **Totals, Records and Characters:** the run's finished battles added up and each character over the battles they were in;
  it's a route of its own (`#/history/stats/<unit key>`) so other pages can link to a character's stats.

## Other pages

- **Roster:** header with the unit count and chips for what changes the view (in-battle filter, units to check,
  "Comparing as"); the run picker is the header's action. Table and unit card as before (`DetailCard`). Export Team (TeamExport.tsx), left
  of Back, previews the two images it saves (an overview of each unit with BST, never eBST, as rows of cards as tall as the unit's
  portrait and stats, the rest flowing into columns beside them, units per row set beside the preview; run statistics) and the units to include, in slots laid out as many side by side as the overview (an empty row more at the
  end); a six-dot handle drags a unit to another slot, empty or not (they swap), and empty slots leave rows short. An Order menu above
  them lays every unit out by BST, deployments, joining (first battle) or name; dragging makes it Custom. The images are as big as their content (Aspect ratio Auto) or padded out to 16:9, 1.91:1, 9:16 or 4:5 around it.
  Dead units are greyed in that list with the fell mark; an "Include fallen units" checkbox above it (only when someone is dead; on by
  default, remembered) puts them in both images greyed with the mark by their name, or leaves them out of both (the statistics follow the
  overview, and their Team totals count whoever is shown).
  Dead units (Classic mode) stay in the table, greyed with a skull, in a Fallen group below the living whatever the sort;
  their card's Status fact says where they fell and opens that battle with the replay at that step
  (`#/battle/<id>?fell=<unit key>`), and the banner's Mark as Alive button (only on a fallen unit) overrides the game's flag; a unit can't be marked dead by hand.
  The shared people filters' Status (Alive / Dead) only counts people in the active run.
- **Archive, Supports:** header with sub-tabs (with counts where they mean something), `MasterDetail`
  with a `DetailCard`. The Archive's tabs: Characters, Crests, Battalions, Classes, Combat Arts, Abilities, Magic,
  Weapons, Items (old `#/characters/...` links open its Characters and Crests tabs).

## Character views

One look for a character wherever one shows (components/character): the battle window and the Units tab, the
Roster's card, the Archive's character card and the run's stats window.

- **Scope, always said.** `ScopeTag`: *In this battle* (that battle only), *This run* (the Roster: the run's unit as
  last read), *Whole run* (History: added up over finished battles), *General reference* (the Archive: the same in
  every run). A character window says it in its header (its hero doesn't repeat it). The Archive is general only: no run
  stats, gear or battalion on its cards, just a button to the Roster.
- **The hero** (`CharacterHero`): the face, the key facts, the scope and the battalion badge. Roster and Archive use
  `PortraitFlip`: the round portrait turns over to the map sprite while the pointer is on it, and stays turned on a
  click, tap, Enter or Space; with reduced motion it swaps without turning. The battle window uses the split layout: a
  larger portrait on the left, the sprite on a tile in its army's colour on the right, and HP, Level, Class, Status
  between them (portrait and sprite side by side above the facts in a narrow card).
- **The window** (`CharacterPopup`): one fixed size for every view and section (`--character-popup-w` / `-h` in
  character.css); the hero stays put and only the picked section scrolls.
- **Battalions** (`BattalionPanel`): laid out like the game's panel, battalion beside gambit, with the eight modifiers
  (gains blue, losses red, an adjustment after an arrow), the gambit's uses, Mt, Hit and a little map of the tiles it
  hits (the user's tile blue, facing up). Missing values show "—" with why; nothing is filled in.
- **No page-wide scrolling, phones included.** On the Roster, the Archive and the battle's Overview and Units tab the
  app stays the screen's height below 760px too (page-scoped `:has()` rules in character.css; Settings, History and
  More Stats do the same in their own CSS); the header stays and the view scrolls inside. The Archive's tabs become one
  row that scrolls sideways.
- **Scan Log:** header with the session's count and chips for updates to check and those not saved; filter by outcome
  (All, Saved, To check, Not saved).
- **Runs:** a new-run box and the runs as a `RowList`; selecting one shows its card: facts, Make active / Rename /
  Delete, and its battles (the same totals as the Battle page's History, and the latest three).
- **Settings:** header with an "Unsaved changes" chip and Restore recommended; sub-tabs General (the game
  connection and read interval), Game files, Battles, eBST, Spoilers, Appearance, Testing, About (a • marks tabs with unsaved changes). One Save bar at the bottom
  names the tabs with changes or with a field to fix, and each name switches to that tab.
