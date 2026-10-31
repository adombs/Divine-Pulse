/**
 * What each battle is, by the game's scenario id (backend/app/data/scenarios.json has the names): main battle,
 * paralogue, auxiliary battle or Cindered Shadows, its chapter, and where it's fought. Part II chapters differ by route,
 * worked out from the house leader in the battle. Places are left out where they aren't known for sure.
 */
import scenarioData from "../../../../backend/app/data/scenario_routes.json";
import { loadGameText } from "../../gameAssets";
import { gameLanguage } from "../../gameLanguage";
import type { Battle } from "../../api";

export type Kind = "main" | "paralogue" | "auxiliary" | "dlc";
export type Route = "cf" | "am" | "vw" | "ss";

export const KIND_LABEL: Record<Kind, string> = {
  main: "Main battle",
  paralogue: "Paralogue",
  auxiliary: "Auxiliary battle",
  dlc: "Cindered Shadows",
};

interface Scenario {
  kind: Kind;
  /** Its chapter (0: the prologue), the same on every route or per route. */
  chapter?: number | Partial<Record<Route, number>>;
}

let titles: Record<string, string> = {};
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
  [titles, places] = await Promise.all([loadGameText("scenario_title", gameLanguage()), loadGameText("battle_place", gameLanguage())]);
}
const main = (chapter: Scenario["chapter"]): Scenario => ({ kind: "main", chapter });
const MERCEUS = main({ ss: 17, vw: 18, am: 20 });

const SCENARIOS: Record<number, Scenario> = {
  0: main(0), 1: main(1), 2: main(2), 3: main(3), 4: main(4), 5: main(5),
  6: main(6), 7: main(7), 8: main(8), 9: main(9), 10: main(10), 11: main(11),
  12: main(12), 13: main(13), 14: main(14), 15: main(15), 16: main(16), 17: main(17), 18: main(17),
  19: MERCEUS,
  20: MERCEUS,
  21: main(18), 22: main({ ss: 18, vw: 19 }), 23: main(19), 24: main({ ss: 19, vw: 20 }),
  25: MERCEUS,
  26: main({ ss: 20, vw: 21 }), 27: main(21), 28: main(21),
  29: main(22),
  30: main(22), 31: main(12), 32: main(13), 33: main(14), 34: main(15), 35: main(16), 36: main(17), 37: main(18),
  86: { kind: "dlc", chapter: 1 }, 87: { kind: "dlc", chapter: 2 }, 88: { kind: "dlc", chapter: 3 },
  89: { kind: "dlc", chapter: 4 }, 90: { kind: "dlc", chapter: 5 }, 91: { kind: "dlc", chapter: 6 }, 92: { kind: "dlc", chapter: 7 },
};

function scenario(id: number): Scenario | null {
  if (SCENARIOS[id]) return SCENARIOS[id];
  if ((id >= 38 && id <= 60) || id === 93 || id === 94 || id === 97) return { kind: "paralogue" };
  if (id >= 61 && id <= 85) return { kind: "auxiliary" };
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
  const name = battle.map_name || titles[String(battle.scenario)] || "";
  const s = battle.scenario !== null && battle.scenario !== undefined ? scenario(battle.scenario) : null;
  const prefix = chapterPrefix(s, () => routeOf(battle));
  const title = name ? (prefix ? `${prefix}: ${name}` : name) : prefix || "Battle";
  const id = battle.scenario;
  const place = id == null ? null : PLACE_NAME[id] ?? places[String(PLACE_TEXT[id])] ?? null;
  return { title, name, kind: s?.kind ?? null, place };
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
