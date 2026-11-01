# Divine Pulse

<img src="branding/icons/app-icon-rounded-1024.png" alt="" width="96" align="right">

Tracks your Fire Emblem: Three Houses units' HP, Mv and effective base stat totals (eBST) and your battles across
playthroughs. Play in the **Eden** emulator: the tracker reads your army straight from the game's memory and keeps
the active run up to date by itself, with nothing to press.

## What you need

- *Fire Emblem: Three Houses* **with update 1.2.0**, a copy you own, running in the **Eden** emulator on Windows.
- Your own game files: a dump folder, or base game, update and optional DLC NSPs. For NSPs the installer also
  needs your own `prod.keys`. See [docs/game-assets/dumping.md](docs/game-assets/dumping.md).

Divine Pulse includes no game content: no art, text, tables or maps. You import your own dump once, and the program
builds everything it shows from it, on your PC. Until you do, it shows only the import screen. It can read folders you
have already extracted; the Windows installer can also use your keys to extract selected NSPs. It doesn't include the
game, an emulator, or a way to get either.

## Install (Windows 10/11, 64-bit)

Download the latest release and either:

- run **`Divine-Pulse-<version>-setup.exe`**: it installs for your user (no administrator prompt) with Start
  menu and desktop shortcuts, and asks for your FE3H 1.2.0 dump or NSPs to import your game files; or
- unzip **`Divine-Pulse-<version>-windows-portable.zip`** anywhere, run `Divine Pulse.exe`, and import your dump
  in **Settings → Game files**.

Nothing else is needed: no Python, no Node.js, no internet connection while it runs. The program isn't
code-signed, so the first time Windows SmartScreen may say "Windows protected your PC"; choose *More info →
Run anyway*.

Your runs, battles and settings are kept in `%LOCALAPPDATA%\Divine Pulse`, separate from the program, so
updating keeps them. **Settings → About** shows the folder and opens it. For a fully portable copy (e.g. on a USB
stick), create an empty folder named `data` next to `Divine Pulse.exe` and everything is stored there instead. To
move to a new PC, copy the data folder across.

To uninstall, use **Uninstall Divine Pulse** in the Start menu or Windows Settings → Apps. It closes the tracker and
asks whether to delete your saved data as well, imported game files included; unless you choose Yes, they're kept for
a later install. For the portable zip, quit from the tray icon and delete the folder, and the data folder if you
want that gone too.

After the import it opens on a **home page**, with your runs as the stairs under the throne: each shows its last chapter, units, battles,
when it was last played and its best unit. Click the latest run to continue it, **Load a run**, or **Start a new run**.

### Importing your game files

During setup, choose either an extracted dump containing the game's RomFS and ExeFS (plus the RomFS for any DLC you
own), or select your base game, update and any DLC NSPs individually. Setup imports only the NSP files you select.
With the portable zip, the app opens on an import screen; pick the folder (or **Settings → Game files** later) and it extracts what it
needs, checks it, and then opens. The imported files are kept in a `game-assets` folder inside the data folder (from
source, in the repository folder). Importing again, for example after adding DLC, replaces them; **Settings → Game
files** can also remove them. Which parts are needed and how to dump them:
[docs/game-assets/dumping.md](docs/game-assets/dumping.md). Game text can be shown in any language the game has.

### Privacy

Everything stays on your PC. The tracker runs a local server that listens on `127.0.0.1` only and refuses requests
whose Host or Origin isn't that address, or that come from another site. It makes no network connections of its own
while running (no updates check, no telemetry); the only links that go out are the ones you click, such as the
Fire Emblem Wiki credits. Your runs, battles and settings stay in the data folder.

To run from source instead, see [Development](#development).

## Use

1. Start **Divine Pulse** (Start menu or desktop). The tracker opens in its own window, not a browser
   tab, and remembers the window's size and position.
   - **Closing the window** hides it to the system tray. The tracker keeps reading the game while you play.
   - **Tray icon** (right-click): *Show window*, *Quit*.
   - **Launching again** while it's running just brings the window back.
2. **Runs** tab → create a run for your playthrough. Everything read from the game goes into the active run.
3. Play. The sidebar's bottom line shows what the tracker is doing, for example *Tracking · 15 units* (or *Tracking off*).

### Reading game memory (Eden)

The tracker reads your units straight from the game:

- **Every unit in your army** is added or updated at once, not just the one on screen, and you don't need to
  open any menu in game.
- **The numbers are exact.** Stats, class, abilities, accessory, personal ability and full name come from the
  game itself, so there are no misreads.
- The game is read every second (**Settings → General**, 0.1–60 s; reading takes a few microseconds, so 1 s costs
  nothing). A change is stored once two reads in a row agree, and each read that changed anything is one update log
  entry with one Undo, however many units it touched. During a battle the game is read more often:
  **Settings → Battles → Battle read interval** (a change reaches the Battle page one or two reads after it happens).

Requirements and limits:

- **FE3H version 1.2.0** in Eden on Windows, with Eden's **fastmem** setting on (the default). Other versions
  are refused rather than misread. Other yuzu-based emulators (yuzu, Citron, Sudachi, Suyu, Torzu) are looked for
  too but untested; Ryujinx isn't supported. Adding an emulator: [docs/porting.md](docs/porting.md).
- The tracker only *reads* Eden's memory; it never changes anything. If Eden runs as administrator, the tracker
  must too.
- **Mid-battle level-ups** are picked up too: during a battle the game keeps copies of the deployed units and
  only writes them back when the battle ends, so the tracker reads those copies. Finding them takes about 2 s
  when a battle starts.
- **In battle filter.** During a battle the Roster gets an *In battle* switch that shows only the units in it.
  With **Settings → Battles → Roster filter** on (the default), it switches on by itself when a battle starts and off
  when it ends.
- Battalion bonuses aren't counted yet. Coming soon.

How the game data was found, step by step: [docs/reading-game-memory.md](docs/reading-game-memory.md).

### Battle page (Eden)

The **Battle** page follows the battle in progress live:

- a battle timer, the turn, Divine Pulse charges left and uses, and every unit's current HP (yours and the others');
- an **outlook**: an estimated chance of winning, with the factors behind it (army strength and HP against the
  other units on the map, progress, losses, Divine Pulses, level-ups), and a chart of it over the battle;
- an **action log** from the game's own record of the battle (the Divine Pulse list): every move, attack, heal and
  defeat, grouped by turn, with what Divine Pulse undid kept as branches. Damage dealt and taken, healing, kills
  and tiles moved per unit come from it too. When that record can't be read, fights are worked out from HP changes
  and the combat math, and marked with how sure the tracker is (*≈ 82%*);
- each deployed unit's level and stat gains this battle, weapon attacks, spells cast and items used, and what it
  has left (spell uses, its most worn weapon, Vulneraries), with a **Running low** list;
- the other units on the map, each with its own card (HP, who it fought, who killed it);
- on the **Overview**, a map: every unit on the battle map's terrain (forest, water, walls…), and a replay of the
  battle step by step along a timeline under the map (who moved where, who attacked or healed whom), with the log
  following along beside it. A unit's card shows what it stands on and its bonuses. Small maps are on each battle's
  card in History;
- **More Stats**: *Records* (highlights, and how the battle compares with the run's others) and *Graphs* (combat,
  support, board, growth and supplies).

While a battle is in progress the app switches from the Roster to the Battle page, and back when it ends
(**Settings → Battles → Battle page**). With **Battle alerts** on, a notification pops up when a unit leaves the
battle (it may have fallen; losing Byleth or a house leader loses the battle) or a Divine Pulse is used. Finished
battles are kept on the **History** page, and **Copy summary** puts one on the clipboard as text.
The top of **History** adds up the run's finished battles: totals (battles, time, turns, units lost, level-ups, Divine
Pulses, fights, kills, damage, healing, supplies), records (most kills, most damage, longest
battle…), and every character over the battles they were in, with each of their battles one click away. A unit's
**Battle Stats** button on the Roster, and **Run Stats** on a battle's unit card, open that character's stats.
How the battle data is read and what's still open: [docs/battle-page-plan.md](docs/battle-page-plan.md).

### What's tracked

For each unit: name (short and full), **class**, gender, **HP**, **Mv** and the 8 stats Str, Mag, Dex, Spd,
Lck, Def, Res, Cha, with class and gender, all read from the game.

**BST** and **eBST** depend on each unit's offense/defense types. See *BST and eBST* below.
Stats shown in **blue** in game include ability bonuses such as *HP +5*, *Magic +2* or *Dexterity +4*. The
tracker reads the equipped abilities, subtracts the bonuses, and shows the bonus as a small blue `+N`.
Toggle **Base / On screen** on the Roster to switch between the two.

### BST and eBST

Each unit has an **Offense** and a **Defense** type (on its card):

| Type | Offense uses | Defense uses |
|---|---|---|
| **Auto** (default) | the higher of Str / Mag | the higher of Def / Res |
| **Physical** | Str | Def |
| **Magical** | Mag | Res |
| **Flex** | the average of Str and Mag | the average of Def and Res |

Auto follows the unit's numbers, so it switches when Mag overtakes Str, for example.

- **eBST** = (offense + defense + whichever of **HP, Mv, Dex, Spd, Lck, Cha** are switched on) ÷ how many
  values went in. Click a stat on the unit card to include or exclude it. HP and Spd start switched on, so a
  new unit's eBST is (HP + offense + defense + Spd) ÷ 4; with nothing switched on it is the average of
  offense and defense.
- Stats that don't count towards eBST are dimmed in the unit's roster row. Str/Mag/Def/Res show a dotted
  marker, because the types decide them.
- **Compare all units as** (the bar above the roster) temporarily gives every unit the same offense/defense
  pair, so units can be compared on equal terms. Each unit keeps its own HP/Mv/Dex/Spd/Lck/Cha toggles. It only
  changes what you see; switching it off restores each unit's own types.

eBST follows the **Base / On screen** switch (On screen by default), and the column sorts.

If a stat is blue but no known bonus explains it (for example a ring), the unit gets an amber **!** marker and its card says the bonus is unknown.
Known bonuses are listed in `backend/app/data/bonuses.json`, and you can add to it.

### Validation

A stat that jumps by more than 15, or a blue stat with an unexplained bonus, is saved with a warning and
an **Undo** button. **Runs → Updates** lists every update read from the game.

### Portraits

Every playable unit shows its in-game headshot in the roster and on its card, taken from your import. A portrait
follows how the character looks in the game at that point: Part I or Part II art, and Byleth's hair, which changes
with the story. **Settings → Appearance → Portraits** picks Part I (academy) or Part II (after the timeskip) art.
**Auto**, the default, switches to Part II once Edelgard, Dimitri or Claude in the active run has their post-timeskip
class. Later portraits stay hidden until they are enabled in **Settings → Spoilers**. Byleth is recognised even with a
custom name (by *Professor's Guidance*), and their gender in the game picks the male or female art. To override that,
set **Portrait** on Byleth's roster card to Male or Female (Auto follows the game); the choice sticks.

### Characters, Archive and Supports pages

Game reference built from your import, so it matches the language and DLC you imported. It works offline.

- **Characters**: base stats, growth rates and max stats for the playable units, sortable and filterable by house,
  with an optional class picked to show total growths (character + class). A character's card shows age, birthday,
  height, Crest (story reveals behind a *Spoiler* button), starting class, a stats table (with your unit's current
  stats if they're in the active run), skill strengths, weaknesses, budding talent and starting ranks, personal
  ability, the abilities and combat arts they learn, their Reason / Faith spells, and their battalion. A **Crests**
  tab lists every crest with its bearers.
- **Archive**: **Classes** (growth rates, stat boosts with mounted extras, base stats, class abilities, mastery,
  proficiencies and who can use each, filterable by tier and gender), **Combat Arts**, **Abilities**, **Magic**,
  **Weapons** and **Items** (stats, ranges, uses and who can obtain them), with icons from your import.
- **Supports**: *By Character* shows each partner's ranks, when they unlock and paired endings (endings behind a
  *Spoiler* button), with the character's liked gifts and lost items; *All Pairings* lays everyone against everyone,
  showing the highest reachable rank; *Gifts, Meals, and Lost Items* is a searchable lookup. Filters: Byleth's gender, route,
  and only units in your run. No support conversations are stored.

Class, character and support names link between the pages. Class-change restrictions and support availability notes
are text from the Fire Emblem Wiki (GFDL 1.3), shipped in `frontend/src/reference/wiki/fe-wiki.json`; see
[Third-party notices](docs/third-party-notices.md).

### Names and validation

Names are matched fuzzily everywhere: search boxes, links and URLs. A mistyped
"Lysithia", "Gremroy" or "HP+5" becomes Lysithea, Gremory and HP +5. Numbers must still agree, so
"Lance Prowess Lv 2" is never changed into Lv 3. The known names come from your import.

Runs and Settings check what you type as you type it: run name length, duplicate run names and the ranges of the
read intervals. The server checks the same rules again and rejects anything unexpected.

### Appearance

The dashboard is styled after the in-game Status page. **Settings → Appearance** has:

- **Theme**: Light or Dark. It follows your Windows setting until you pick one.
- **Text size**: a slider from 70% to 130%, applied with **Apply**.
- **Font**: Fódlan (default: EB Garamond), Cormorant, Cinzel, Alegreya, Spectral,
  Atkinson Hyperlegible, or System (Segoe UI, works offline). Each option previews itself.

These are remembered in your browser.

### Files

All in the data folder (`%LOCALAPPDATA%\Divine Pulse` when installed, `data/` when running from source,
Settings → About to open it):

| Path | What |
|---|---|
| `runs/<run>.json` | One file per run |
| `runs/deleted/` | Deleted runs are moved here, not erased |
| `battles/<run>.json` | Finished battles, shown in History and on the Battle page |
| `battle-recordings/` | Raw battle memory from the last 5 battles (Settings → Testing → Record Battles), for finding game fields; `.dprec` files, and older `.fe3hrec` ones are still read |
| `pairing-checks/` | Fight-estimate reports, only with Settings → Testing → Check Fight Estimates on |
| `settings.json` | Read intervals, battle options, active run, window position |
| `game-assets/` | What the import extracted from your game files |
| `tracker.log` | Log file (kept to a few MB), useful if something goes wrong |

### Notes

- The window uses Microsoft Edge WebView2, which is built into Windows 11. If it's ever missing, the
  tracker falls back to opening in your browser.

## Credits

Divine Pulse is a fan-made tool, not affiliated with or endorsed by Nintendo, Intelligent Systems or Koei Tecmo.
*Fire Emblem: Three Houses* is © Nintendo / Intelligent Systems / Koei Tecmo. Divine Pulse contains none of its
content; you import your own.

Divine Pulse is made by Adombs. Its logo and icons are in [`branding/icons/`](branding/icons/). It's free; to support
my work on it, you can leave a tip on [Ko-fi](https://ko-fi.com/adombs).

The Windows installer includes [NSTool](https://github.com/jakcron/nstool) by Jack (jakcron) to extract NSP files.
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

## Development

You need Python 3.12 or newer and Node.js 24 on `PATH`. After cloning, run this once from the project folder:

```bat
tools\setup.bat
```

It creates `backend\.venv`, installs what the app needs, builds the UI, and adds a **Divine Pulse (source)** desktop
shortcut. Start the app with that shortcut or `tools\launch.bat`, and import your game files when it asks.

See [the contributing guide](.github/CONTRIBUTING.md) for checks and the contribution workflow. The project guides are
indexed in [docs](docs/README.md). Source-mode data goes in `data/` in the project folder (or set
`DIVINE_PULSE_DATA_DIR`).

For development, also install the test and lint packages:

```bat
cd backend
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest
.venv\Scripts\python -m app --server           :: API + built UI on :8765, no window or tray
.venv\Scripts\python -m app --browser          :: open in the browser instead of the desktop window

cd ..\frontend
npm run dev                                     :: UI with hot reload on :5173 (proxies /api)
```

To see the Battle page without playing, `python tools/demo_battle.py` (needs an import of your game files) runs the app on a throwaway data folder with
a scripted battle (http://127.0.0.1:8799/#/battle): units move, fight, heal, level up and fall on a small map, and a
Divine Pulse turns back time.

To build the program and installer (`python tools/build.py`, on the OS you're building for), see
[the release guide](docs/releasing.md). Adding an emulator: [docs/porting.md](docs/porting.md).
