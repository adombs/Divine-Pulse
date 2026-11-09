/**
 * What each battle is, by the game's scenario id (the game's scenario_title text has the names): one of five kinds
 * (Mission, Auxiliary, Paralogue, Quest or DLC battle), its chapter, and where it's fought. Part II chapters differ by route,
 * worked out from the house leader in the battle. Places are left out where they aren't known for sure.
 */
import scenarioData from "../../../../backend/app/data/scenario_routes.json";
import questData from "../../../../backend/app/data/quest_battles.json";
import { loadGameText } from "../../gameAssets";
import { gameLanguage } from "../../gameLanguage";
import type { Battle } from "../../api";

/** The five kinds of battle, in the order filters and counts list them. The game itself names the first four ("Mission,
 * Auxiliary, Paralogue, and Quest battles"); DLC is the extra auxiliary battles (81-85) and Cindered Shadows (86-92). */
export type Kind = "mission" | "auxiliary" | "paralogue" | "quest" | "dlc";
export type Route = "cf" | "am" | "vw" | "ss";

/** A kind on a tag or chip, singular. */
export const KIND_LABEL: Record<Kind, string> = {
  mission: "Mission Battle",
  auxiliary: "Auxiliary Battle",
  paralogue: "Paralogue Battle",
  quest: "Quest Battle",
  dlc: "DLC Battle",
};
/** A kind in a filter or a count, plural. */
export const KIND_PLURAL: Record<Kind, string> = {
  mission: "Mission Battles",
  auxiliary: "Auxiliary Battles",
  paralogue: "Paralogue Battles",
  quest: "Quest Battles",
  dlc: "DLC Battles",
};
export const KINDS = Object.keys(KIND_LABEL) as Kind[];

/**
 * Quest Battles. A quest battle runs on an ordinary auxiliary scenario and map, so its scenario id can't tell it
 * apart; the game's memory names the quest instead (`Battle.quest`, its row in the quest table). These are the quests
 * of that table that have a battle (backend/app/data/quest_battles.json); the quest's name is the battle's title.
 */
const QUEST_BATTLES: ReadonlySet<number> = new Set(questData.quests);
const isQuestBattle = (battle: Battle) => battle.quest != null && QUEST_BATTLES.has(battle.quest);

interface Scenario {
  kind: Kind;
  /** Its chapter (0: the prologue), the same on every route or per route. */
  chapter?: number | Partial<Record<Route, number>>;
}

let titles: Record<string, string> = {};
let questTitles: Record<string, string> = {};
let places: Record<string, string> = {};
const PLACE_TEXT: Record<number, number> = {
  ...Object.fromEntries(Array.from({ length: 17 }, (_, id) => [id, id])),
  17: 7, 18: 7, 19: 17, 20: 17, 21: 25, 22: 18, 23: 22, 24: 19, 25: 17, 26: 20, 27: 18,
  30: 19, 32: 16, 33: 22, 35: 23, 36: 24, 37: 25, 42: 2, 66: 3, 72: 7, 73: 7, 76: 2,
  79: 15, 84: 10, 85: 5,
};
const PLACE_NAME: Record<number, string> = {
  28: "Garreg Mach Monastery", 31: "Garreg Mach Monastery", 34: "Garreg Mach Monastery", 90: "Garreg Mach Monastery", 92: "Garreg Mach Monastery",
  52: "Lake Teutates", 81: "Lake Teutates", 77: "Rhodos Coast", 86: "Abyss", 87: "Abyss", 88: "Abyss", 89: "Abyss", 91: "Abyss",
};
export async function loadScenarioText() {
  [titles, places, questTitles] = await Promise.all([
    loadGameText("scenario_title", gameLanguage()), loadGameText("battle_place", gameLanguage()),
    // Imported before quest names were read: a quest battle is then titled by its map until the game files are imported again.
    loadGameText("quest_title", gameLanguage()).catch(() => ({})),
  ]);
}
const mission = (chapter: Scenario["chapter"]): Scenario => ({ kind: "mission", chapter });
const MERCEUS = mission({ ss: 17, vw: 18, am: 20 });

const SCENARIOS: Record<number, Scenario> = {
  0: mission(0), 1: mission(1), 2: mission(2), 3: mission(3), 4: mission(4), 5: mission(5),
  6: mission(6), 7: mission(7), 8: mission(8), 9: mission(9), 10: mission(10), 11: mission(11),
  12: mission(12), 13: mission(13), 14: mission(14), 15: mission(15), 16: mission(16), 17: mission(17), 18: mission(17),
  19: MERCEUS,
  20: MERCEUS,
  21: mission(18), 22: mission({ ss: 18, vw: 19 }), 23: mission(19), 24: mission({ ss: 19, vw: 20 }),
  25: MERCEUS,
  26: mission({ ss: 20, vw: 21 }), 27: mission(21), 28: mission(21),
  29: mission(22),
  30: mission(22), 31: mission(12), 32: mission(13), 33: mission(14), 34: mission(15), 35: mission(16), 36: mission(17), 37: mission(18),
  86: { kind: "dlc", chapter: 1 }, 87: { kind: "dlc", chapter: 2 }, 88: { kind: "dlc", chapter: 3 },
  89: { kind: "dlc", chapter: 4 }, 90: { kind: "dlc", chapter: 5 }, 91: { kind: "dlc", chapter: 6 }, 92: { kind: "dlc", chapter: 7 },
};

/** Which kind of battle a scenario id is, null when it isn't one the app knows. */
export function kindOfScenario(id: number): Kind | null {
  return scenario(id)?.kind ?? null;
}

function scenario(id: number): Scenario | null {
  if (SCENARIOS[id]) return SCENARIOS[id];
  if ((id >= 38 && id <= 60) || id === 93 || id === 94 || id === 97) return { kind: "paralogue" };
  if (id >= 61 && id <= 80) return { kind: "auxiliary" };
  if (id >= 81 && id <= 85) return { kind: "dlc" };
  return null;
}

/** The route, from the house leader fighting (Part II): Edelgard Crimson Flower, Dimitri Azure Moon, Claude Verdant
 * Wind, none of them Silver Snow. */
export function routeOf(battle: Battle): Route | undefined {
  if (battle.route && ["cf", "am", "vw", "ss"].includes(battle.route)) return battle.route as Route;
  const exclusive = (scenarioData.routes as Record<string, Route>)[String(battle.scenario)];
  if (exclusive) return exclusive;
  const part2 = battle.scenario !== null && battle.scenario !== undefined && battle.scenario >= 13 && battle.scenario <= 37;
  const late = battle.units.filter((u) => ["armored lord", "emperor", "high lord", "great lord", "wyvern master", "barbarossa"].includes(u.class_name.toLowerCase()));
  if (!part2 && !late.length) return undefined;
  const keys = new Set((part2 ? battle.units : late).map((u) => ({ 2: "edelgard", 3: "dimitri", 4: "claude" }[u.character ?? -1] ?? u.name.toLowerCase().split(" ")[0] ?? u.key)));
  const routes = ([ ["edelgard", "cf"], ["dimitri", "am"], ["claude", "vw"] ] as const).filter(([key]) => keys.has(key));
  if (routes.length === 1) return routes[0][1];
  if (!routes.length) {
    const houses = [
      ["edelgard", "hubert", "ferdinand", "linhardt", "caspar", "bernadetta", "dorothea", "petra"],
      ["dimitri", "dedue", "felix", "ashe", "sylvain", "mercedes", "annette", "ingrid"],
      ["claude", "lorenz", "raphael", "ignatz", "lysithea", "marianne", "hilda", "leonie"],
    ].map((members) => members.filter((key) => keys.has(key)).length);
    if (houses[0] > Math.max(houses[1], houses[2])) return "ss";
  }
  return undefined;
}

export interface BattleName {
  /** "Chapter 7: Battle of the Eagle and Lion", "Oil and Water"; "Battle" when it isn't known. */
  title: string;
  /** The battle's own name alone ("" when not known). */
  name: string;
  kind: Kind | null;
  place: string | null;
}

export function battleName(battle: Battle): BattleName {
  const quest = isQuestBattle(battle);
  const name = (quest ? questTitles[String(battle.quest)] : "") || battle.map_name || titles[String(battle.scenario)] || "";
  const s = battle.scenario !== null && battle.scenario !== undefined ? scenario(battle.scenario) : null;
  const prefix = quest ? "" : chapterPrefix(s, () => routeOf(battle));
  const title = name ? (prefix ? `${prefix}: ${name}` : name) : prefix || "Battle";
  const id = battle.scenario;
  const place = id == null ? null : PLACE_NAME[id] ?? places[String(PLACE_TEXT[id])] ?? null;
  return { title, name, kind: quest ? "quest" : s?.kind ?? null, place };
}

/** "Prologue", "Chapter 7" or "" (not a chapter); a chapter that differs by route asks for the route only then. */
function chapterPrefix(s: Scenario | null, route: () => string | null | undefined): string {
  let chapter: number | undefined;
  if (typeof s?.chapter === "number") chapter = s.chapter;
  else if (s?.chapter) {
    const r = route();
    chapter = (r && r in s.chapter ? s.chapter[r as Route] : undefined) ?? Object.values(s.chapter)[0];
  }
  return chapter === undefined ? "" : chapter === 0 ? "Prologue" : `Chapter ${chapter}`;
}

/** A run's chapter ("Chapter 7: Battle of the Eagle and Lion") from its scenario id and the run's route. */
export function chapterTitle(scenarioId: number, name: string, route: string | null): string {
  const prefix = chapterPrefix(scenario(scenarioId), () => route);
  const known = name || titles[String(scenarioId)] || "";
  return known ? (prefix ? `${prefix}: ${known}` : known) : prefix;
}

/** Everything a search box can match a battle on: its name, kind, place, date and the units in it. */
export function searchText(battle: Battle): string {
  const n = battleName(battle);
  return [
    n.title,
    n.kind ? KIND_LABEL[n.kind] : "",
    n.place ?? "",
    new Date(battle.started_at).toLocaleString(),
    ...battle.units.map((u) => u.name),
  ]
    .join(" ")
    .toLowerCase();
}
