import type { EbstConfig } from "./ebst";
import type { SkillKey } from "./reference/types";

export const STAT_KEYS = ["str", "mag", "dex", "spd", "lck", "def", "res", "cha"] as const;
export const VALUE_KEYS = ["hp", "mv", ...STAT_KEYS] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type ValueKey = (typeof VALUE_KEYS)[number];

export const LABELS: Record<ValueKey, string> = {
  hp: "HP", mv: "Mv", str: "Str", mag: "Mag", dex: "Dex", spd: "Spd",
  lck: "Lck", def: "Def", res: "Res", cha: "Cha",
};


export type RunRoute = "black-eagles" | "blue-lions" | "golden-deer" | "cf" | "ss" | "am" | "vw";

/** The unit with the highest score over a run's battles, with what it takes to draw its sprite. */
export interface BestUnit {
  key: string;
  name: string;
  class_id: number | null;
  character: number | null;
  female: boolean;
  look: string | null;
}

export interface RunSummary {
  id: string;
  name: string;
  unit_count: number;
  route: RunRoute | null;
  created_at: string;
  updated_at: string;
  /** Finished battles. */
  battle_count: number;
  /** The newest main-story battle, finished or in progress (its name is "" until read). */
  last_chapter: { scenario: number; name: string } | null;
  best_unit: BestUnit | null;
}

export interface Unit {
  key: string;
  name: string;
  full_name: string;
  class_name: string;
  /** "Male" / "Female" (from the Status page), or "". */
  gender: string;
  displayed: Record<ValueKey, number>;
  bonuses: Partial<Record<ValueKey, number>>;
  effective_bonuses: Partial<Record<ValueKey, number>>;
  base_values: Record<ValueKey, number>;
  /** The unit's eBST setup: offense and defense types, and which other stats count. */
  ebst_effective: EbstConfig;
  /** Byleth's hair as the game has it now (game memory only): green from the Sothis merge on. */
  look?: "dark" | "green" | null;
  blue: ValueKey[];
  boosted_unexplained: ValueKey[];
  personal_ability: string;
  abilities: string[];
  accessory: string | null;
  /** Equipped combat arts (game memory only; absent on units saved before arts were read). */
  combat_arts?: string[];
  /** Weapons, items, equipment and learned spells it carries (game memory only). */
  inventory?: InventoryItem[];
  /** Learned abilities and combat arts, and the assigned battalion ("" for none) (game memory only). */
  learned_abilities?: string[];
  learned_arts?: string[];
  battalion?: string;
  /** The battalion's ID in the import; absent in older saved runs. */
  battalion_id?: number | null;
  /** Its state as last read from game memory (null/absent: not read): cumulative experience (level = exp / 100 + 1,
   * capped at 400), endurance left, and gambit uses left during a battle (null between battles: the game refills
   * them). */
  battalion_exp?: number | null;
  battalion_endurance?: number | null;
  gambit_uses?: number | null;
  /** Current skill progress from game memory, when its roster fields are known. */
  skills?: Partial<Record<SkillKey, { rank: string; exp: number }>>;
  /** The classes it has mastered, as read from game memory (null/absent: not read yet; [] none). */
  mastered_classes?: string[] | null;
  updated_at: string;
  /** Dead (Classic mode): the battle and step of its log where it fell. null/absent while alive. */
  death?: Death | null;
  /** The user said it's alive although the game marks it dead. */
  marked_alive?: boolean;
}

/** Where a unit died (the game's own "Is Dead" flag, or marked by hand): all empty but `manual` when no fall of it was
 * recorded. */
export interface Death {
  battle_id: string | null;
  /** The battle's map name when it happened. */
  battle_name: string;
  scenario: number | null;
  turn: number | null;
  /** The "fell" log entry's history position and time (seconds since the battle started). */
  step: number | null;
  t: number | null;
  /** Who caused it, if known. */
  by: string | null;
  /** Marked dead by the user. */
  manual: boolean;
  at: string;
}

export interface Settings {
  active_run_id: string | null;
  max_recordings: number;
  window_mode: "windowed" | "fullscreen";
  /** Where the game is read from: the Eden emulator, or FE3H Recomp (the native Windows recompilation). */
  memory_reader: "eden" | "recomp";
}

export type SettingsInput = Partial<Pick<Settings, "max_recordings" | "window_mode" | "memory_reader">>;

/** What the game reader is doing. */
export interface AutoStatus {
  /** Keys of the units in the battle in progress (empty outside a battle). */
  battle: string[];
  state: "off" | "watching" | "no_run" | "error";
  /** What the last read saw, e.g. "15 units". */
  seeing: string | null;
  message: string;
}

// Battles

export interface BattleUnit {
  key: string;
  name: string;
  class_name: string;
  start_level: number;
  level: number;
  /** On-screen values at the start of the battle and now (hp = max HP). */
  start: Record<ValueKey, number>;
  now: Record<ValueKey, number>;
  on_map: boolean;
  /** Key of the unit it's the adjutant of: in the battle, not on the map. */
  adjutant_of?: string | null;
  /** Spent this battle: weapon durability, consumable items and spell uses. */
  weapon_uses: number;
  item_uses: number;
  spells_cast: number;
  /** What the unit has left (null until its battle record is read). */
  spell_uses_left: number | null;
  /** The most spell uses seen this battle (full at the start). */
  spell_uses_full: number | null;
  /** Uses left of its most worn weapon that isn't broken. */
  weakest_weapon: number | null;
  broken_weapons: number;
  consumables_left: number | null;
  /** Its items, then its spells, as last read (absent in battles saved before inventories were kept). */
  inventory?: InventoryItem[];
  /** Equipped roster accessory, when known. */
  accessory?: string | null;
  /** Equipped combat arts, as last read (absent in battles saved before arts were read). */
  arts?: string[];
  /** Battalion assignment recorded with this battle; null/absent in older recordings, "" for none. */
  battalion?: string | null;
  battalion_id?: number | null;
  /** Its state in this battle, as last read; null/absent when not recorded (older recordings). */
  battalion_exp?: number | null;
  battalion_endurance?: number | null;
  gambit_uses?: number | null;
  /** Rattled by a gambit when last read: its battalion's modifiers don't apply. Null/absent: not read. */
  rattled?: boolean | null;
  /** What it used, most used first, from the game's history (null or absent = not tracked). */
  usage?: Usage[] | null;
  /** Current HP; the rest from the game's record of the battle (null = not tracked). */
  hp: number | null;
  /** Map position, as last read (absent in battles saved before positions were kept). */
  x?: number | null;
  y?: number | null;
  /** Has acted this phase (greyed out in game), as last read; null or absent until read. */
  acted?: boolean | null;
  /** For its sprite on the map (game memory only): the game's class and character IDs, and whether it's female. */
  /** What it fights with, for its map badge (as EnemyStats.weapon). */
  weapon?: string;
  class_id?: number | null;
  character?: number | null;
  /** Byleth's hair in this battle: "green" after the Sothis merge. */
  look?: "dark" | "green" | null;
  /** The faction ID on its battle record, as the game has it now (null or absent: not read). */
  allegiance?: number | null;
  female?: boolean;
  damage_taken: number | null;
  /** HP the unit got back. */
  healed: number | null;
  /** HP it restored to other units. */
  healing_given: number | null;
  damage_dealt: number | null;
  /** Other units it defeated, and fights it was in (from its Victories / Battles counters). */
  defeats: number | null;
  combats?: number | null;
  tiles_moved: number | null;
  level_ups: number;
  gains: Partial<Record<ValueKey, number>>;
}

export type BattleEventKind = "start" | "turn" | "level_up" | "stat_up" | "divine_pulse" | "joined" | "left" | "enemies" | "end";

export interface BattleEvent {
  /** Seconds since the battle started. */
  t: number;
  kind: BattleEventKind;
  text: string;
  unit: string | null;
  gains: Partial<Record<ValueKey, number>>;
}


/** spell: a staff that changed no HP (Rescue, Ward...); art: a combat art that isn't an attack (Swap, Draw Back...);
 * act: an action the tracker can't identify. */
export type LogKind = "phase" | "move" | "wait" | "attack" | "defeat" | "fell" | "heal" | "spell" | "item" | "art" | "rally" | "gambit" | "act" | "pulse";

/** One line of the action log, like the game's Divine Pulse list. */
export interface LogEntry {
  t: number;
  turn: number | null;
  kind: LogKind;
  text: string;
  /** Army unit key of whoever acted, if one of yours. */
  unit: string | null;
  /** Army unit key, or the other unit's name ("Brigand 3"). */
  target: string | null;
  /** A fight worked out from HP changes because the game's history couldn't be read: how sure (0-1). Null: exact. */
  confidence?: number | null;
  /** Who acted and on whom ("a:<key>" for your units, "e:<slot>" for others; for "fell", the fallen unit and who caused it). */
  actor_id?: string | null;
  target_id?: string | null;
  /** HP the target lost, HP the actor lost (a counterattack), HP restored. */
  dealt?: number | null;
  taken?: number | null;
  restored?: number | null;
  /** 0 player, 1 enemy, 2 other. */
  phase?: number | null;
  /** The spell or item used ("Rescue", "Vulnerary"), when the game's history names it. */
  detail?: string | null;
  /** Position in the game's history of the action (null: not from it). The same position is the same moment in every timeline. */
  step?: number | null;
}

/** A timeline a Divine Pulse undid. Branches form a tree: 0 is the timeline that stands; a branch splits from its parent at
 * history position `fork` (everything in the parent before it happened in the branch too). */
export interface Branch {
  id: number;
  parent: number;
  fork: number;
  turn: number | null;
  /** When time was turned back (seconds since the battle started). */
  at: number;
  /** What happened in it from the fork on, and the tracker's events then (units leaving, level-ups). */
  log: LogEntry[];
  events: BattleEvent[];
  /** Complete map history as it stood before this rewind (absent in older recordings). */
  map_steps?: MapStep[];
  map_presence?: Battle["map_presence"];
}

/** A weapon, spell, combat art, item or Rally a unit used in a battle. */
export interface Usage {
  kind: "weapon" | "spell" | "art" | "item" | "rally" | "gambit";
  id: number;
  name: string;
  /** Actions it was used in (a weapon's counterattacks too). */
  times: number;
  /** Uses it cost: durability (a combat art's cost included), spell casts, items. */
  spent: number;
  /** Damage dealt with it. */
  damage: number;
  /** As InventoryItem.weapon (weapons and spells). */
  weapon?: string | null;
}

/** One item or spell a unit carries: uses left, and `full` its uses when new (null when not known). */
export interface InventoryItem {
  id: number;
  name: string;
  kind: "weapon" | "equipment" | "item" | "spell" | "other";
  uses: number;
  full: number | null;
  /** True only when game memory explicitly reports this item slot as equipped. */
  equipped?: boolean;
  /** A weapon's or spell's type, for its icon: "sword", "lance", "axe", "bow", "gauntlets", "reason", "faith", "dark". */
  weapon?: string | null;
}

/** One of the other units on the map, over the battle. */
export interface EnemyStats {
  /** As BattleUnit.inventory. */
  inventory?: InventoryItem[];
  accessory?: string | null;
  usage?: Usage[] | null;
  slot: number;
  /** "Bandit 3" */
  label: string;
  /** The game's name for it ("Bandit"), else empty. */
  name: string;
  class_name: string;
  level: number;
  max_hp: number;
  hp: number | null;
  /** Fights this battle, and your units it defeated (its counters). */
  combats: number;
  defeats: number;
  /** From the game's history (null = not tracked). */
  damage_dealt: number | null;
  damage_taken: number | null;
  tiles_moved: number | null;
  /** Name of the unit that defeated it. */
  defeated_by: string | null;
  /** On the map with HP left, as last read. */
  on_map: boolean;
  /** Taken off the map with HP left, as last read (the story removed it, or it escaped): not drawn. */
  left?: boolean;
  /** Map position, as last read (a defeated unit keeps the tile it fell on). */
  x?: number | null;
  y?: number | null;
  /** What it fights with, for its map icon: "sword", "lance", "axe", "bow", "gauntlets", "reason", "faith", "dark" or "". */
  weapon?: string;
  /** For its sprite on the map: the game's class ID (null: not read), whether it's female, its army, and for a
   * character of their own (not a generic unit), the game's character ID. */
  class_id?: number | null;
  female?: boolean;
  /** "object": not a unit but a thing with HP of its own (a breakable wall). */
  side?: "enemy" | "ally" | "third" | "object";
  character?: number | null;
  /** The faction ID on its battle record, as the game has it now (null or absent: not read). */
  allegiance?: number | null;
}

/** Where units stood after one step of the game's history: only the units the step changed (everyone on the first). */
export interface MapStep {
  /** Position in the history (LogEntry.step). */
  step: number;
  turn: number;
  /** 0 player, 1 enemy, 2 other. */
  phase: number;
  actor: string | null;
  target: string | null;
  /** uid ("a:<key>" / "e:<slot>") -> [x, y, HP]. */
  units: Record<string, [number, number, number]>;
}

/** One kind of tile on the battle map. */
export interface TerrainTile {
  name: string;
  /** Colour group: plain, floor, forest, water, mountain, wall, bridge, sand, heal, hazard, fort. */
  kind: string;
  /** The game's movement group ("Forest", "Fliers only"). */
  effect: string;
  avo: number;
  defense: number;
  res: number;
  /** % of max HP per turn (negative: damage). */
  heal: number;
  /** Who can stand on it. */
  enter: "all" | "fliers" | "none";
  /** A breakable wall's HP (0 or missing: not breakable). */
  wall_hp?: number;
}

export interface TrendPoint {
  /** Seconds since the battle started. */
  t: number;
  chance: number;
  /** Share of max HP the army and the other units had (0-1), once current HP is located. */
  army_hp: number | null;
  enemy_hp: number | null;
}

export interface OutlookFactor {
  label: string;
  /** How much this factor moves the chance, in percentage points. */
  points: number;
  detail: string;
}

/** An army unit that could fall: low on HP with other units in reach. */
export interface AtRisk {
  key: string;
  name: string;
  hp: number;
  max_hp: number;
  /** Other units in reach (null: positions not read). */
  near: number | null;
  level: "danger" | "exposed";
  /** Losing it loses the battle. */
  critical: boolean;
  /** Player phase: it hasn't acted, so it can still step out of reach (its risk counts for less). */
  pending?: boolean;
  /** The phase in progress: 0 player, 1 enemy, null when unknown. */
  phase?: number | null;
  /** Enemy phase: the share of the reach on it at the phase's start that is still to act (1 = all of it). */
  left?: number;
}

export interface Outlook {
  chance: number;
  confidence: "low" | "medium" | "high";
  factors: OutlookFactor[];
  /** Most at risk first. */
  at_risk: AtRisk[];
}

export interface Battle {
  route?: RunRoute | null;
  id: string;
  run_id: string;
  started_at: string;
  ended_at: string | null;
  /** Seconds the game was away from the battle (quit with a bookmark, then resumed): not counted in its time. */
  away_s?: number;
  /** Which battle this is: the game's scenario id (battle/scenarios.ts) and its name, once read. */
  scenario?: number | null;
  map_name?: string;
  units: BattleUnit[];
  /** Other units on the map (enemies, as far as the game data tells). */
  enemies_start: number;
  enemies_now: number;
  divine_pulses: number;
  /** From game fields located later (null until then). */
  turn: number | null;
  divine_pulse_charges: number | null;
  enemies_defeated: number | null;
  army_hp: number | null;
  army_max_hp: number | null;
  enemy_hp: number | null;
  events: BattleEvent[];
  /** Every action seen, newest last. */
  log: LogEntry[];
  /** Timelines undone by Divine Pulse; log, events and stats are the timeline that stands. */
  branches?: Branch[];
  /** Names for the other units ("Bandit 3"), and each one's stats over the battle, by pool slot. */
  enemy_labels?: Record<string, string>;
  enemy_stats?: Record<string, EnemyStats>;
  /** The part of the map units have stood on so far, in tiles (null until a position is read). */
  map_w?: number | null;
  map_h?: number | null;
  /** Which map the battle is on (the import's data/maps.json), with `terrain`. */
  map_id?: number | null;
  /** The quest the battle is for, by its row in the game's quest table (null: not for a quest, or not read). */
  quest?: number | null;
  /** Where everyone stood after each step of the game's history, to replay the battle (empty without it). */
  map_steps?: MapStep[];
  /** When other units came onto the map or left it without being defeated: uid -> [step, on the map from then] in
   * order (not listed: on the map all along). */
  map_presence?: Record<string, [number, boolean][]>;
  /** The map's terrain: a terrain ID per tile, rows from y = 0 (null: not read), and what each ID on it is. */
  terrain?: number[][] | null;
  terrain_tiles?: Record<string, TerrainTile>;
  /** The tile the game's map cursor is on, as last read (null: not read). The Map tab follows it. */
  cursor?: [number, number] | null;
  /** The outlook over the battle: a point whenever it changed. */
  trend: TrendPoint[];
  active: boolean;
  seconds: number;
  level_ups: number;
  stat_points: number;
  weapon_uses: number;
  spells_cast: number;
  item_uses: number;
  /** Spell uses the army on the map has left, and had at most (null until read). */
  spell_uses_left: number | null;
  spell_uses_full: number | null;
  /** The battle in progress only. */
  outlook: Outlook | null;
}

/** Version, where this install keeps runs, battles and settings, and whether it runs in the desktop window. */
export interface About {
  version: string;
  data_dir: string;
  /** Shown in the desktop window (not the browser), where window_mode applies. */
  desktop: boolean;
}

export interface GameAssetsJob {
  state: "idle" | "running" | "done" | "failed";
  phase: string | null; done: number; total: number; error: string | null;
}
export interface GameFilesStatus {
  available: boolean; version?: string | null; dlc?: string[];
  error?: string;
  created?: string; files?: number; outdated?: boolean; job?: GameAssetsJob;
}
export interface GameFilesScan {
  version: string | null;
  parts: GameFilesPart[]; importable: boolean; problems: string[];
}
export interface GameFilesPart { id: string; name: string; found: boolean; detail: string | null; required: boolean }
export interface GameFilesVerify { ok: boolean; checked: number; errors: string[]; warnings: string[] }

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status === 404 && path.startsWith("/game-assets") ? "Not available" : detail, res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

const enc = encodeURIComponent;

export const api = {
  runs: () => request<{ runs: RunSummary[]; active_run_id: string | null }>("GET", "/runs"),
  createRun: (name: string) => request<RunSummary>("POST", "/runs", { name }),
  renameRun: (id: string, name: string) => request<void>("PATCH", `/runs/${enc(id)}`, { name }),
  deleteRun: (id: string) => request<void>("DELETE", `/runs/${enc(id)}`),
  activateRun: (id: string) => request<void>("POST", `/runs/${enc(id)}/activate`),

  units: (runId: string) => request<Unit[]>("GET", `/runs/${enc(runId)}/units`),
  /** Change a unit's offense / defense type or which other stats count. */
  runEbst: (runId: string) => request<EbstConfig>("GET", `/runs/${enc(runId)}/ebst`),
  setRunEbst: (runId: string, body: EbstConfig) => request<EbstConfig>("PUT", `/runs/${enc(runId)}/ebst`, body),
  setUnitEbst: (runId: string, key: string, body: Partial<EbstConfig>) =>
    request<Unit>("PUT", `/runs/${enc(runId)}/units/${enc(key)}/ebst`, body),
  setUnitDead: (runId: string, key: string, dead: boolean) =>
    request<Unit>("PUT", `/runs/${enc(runId)}/units/${enc(key)}/dead`, { dead }),
  gameFilesStatus: () => request<GameFilesStatus>("GET", "/game-assets/status"),
  scanGameFiles: (dump: string) => request<GameFilesScan>("POST", "/game-assets/scan", { dump }),
  importGameFiles: (dump: string) => request<{ job: GameAssetsJob }>("POST", "/game-assets/import", { dump }),
  verifyGameFiles: () => request<GameFilesVerify>("POST", "/game-assets/verify"),
  pickGameFilesFolder: () => request<{ path: string | null }>("POST", "/game-assets/pick-folder"),
  pickGameFilesNsps: () => request<{ paths: string[] }>("POST", "/game-assets/pick-nsps"),
  pickGameFilesKeys: () => request<{ path: string | null }>("POST", "/game-assets/pick-keys"),
  importGameFilesNsps: (nsps: string[], keys: string, keepDumps?: string) => request<{ job: GameAssetsJob }>("POST", "/game-assets/import-nsps", { nsps, keys, keep_dumps: keepDumps }),
  removeGameFiles: () => request<void>("DELETE", "/game-assets"),
  settings: () => request<Settings>("GET", "/settings"),
  saveSettings: (s: SettingsInput) => request<Settings>("PUT", "/settings", s),
  auto: () => request<AutoStatus>("GET", "/auto"),
  battle: () => request<{ battle: Battle | null }>("GET", "/battle"),
  battles: (runId: string) => request<Battle[]>("GET", `/runs/${enc(runId)}/battles`),
  exportRun: (runId: string) => request<Record<string, unknown>>("GET", `/runs/${enc(runId)}/export`),
  importRun: (body: unknown, options?: { name?: string; overwrite?: boolean }) => {
    const query = new URLSearchParams();
    if (options?.name) query.set("name", options.name);
    if (options?.overwrite) query.set("overwrite", "true");
    return request<RunSummary>("POST", "/runs/import" + (query.size ? "?" + query : ""), body);
  },
  exportBattles: (runId: string) => request<Record<string, unknown>>("GET", `/runs/${enc(runId)}/battles/export`),
  importBattles: (runId: string, body: unknown) => request<{ added: number }>("POST", `/runs/${enc(runId)}/battles/import`, body),
  deleteBattle: (runId: string, id: string) => request<void>("DELETE", `/runs/${enc(runId)}/battles/${enc(id)}`),
  checkMemory: () => request<{ ok: boolean; message: string }>("GET", "/memory/check"),
  about: () => request<About>("GET", "/about"),
  openDataFolder: () => request<void>("POST", "/about/open-data-folder"),
};
