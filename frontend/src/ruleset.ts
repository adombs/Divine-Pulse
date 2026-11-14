/**
 * A run's ruleset: the self-imposed rules the player plays it under (Classic, No Divine Pulse, a rule of their own).
 * The limits mirror the backend's (backend/app/domain/runs.py); the backend checks everything again. Here are the
 * one-click suggestions, the edits the Runs page makes (add, change, remove, move), and the arithmetic of the ruleset's
 * picture (its columns, and how long it stays in a video). Nothing here touches the page, so it is tested on its own
 * (scripts/test-ruleset.mjs).
 */

export interface Rule {
  name: string;
  /** What the rule means ("" when the name says it all). */
  description: string;
}

export const MAX_RULES = 40;
export const RULE_NAME_LEN = 60;
export const RULE_DESCRIPTION_LEN = 280;

/** Control characters dropped and whitespace collapsed, like the server does (validation.ts `cleanText`). */
export function cleanRuleText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

/** A name matched the way duplicates are found: cleaned, and case and punctuation ignored. */
const key = (name: string) => cleanRuleText(name).toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Why a rule can't be saved as it is, or null. `others`: the run's other rules (a name can't be there twice). */
export function ruleError(rule: Rule, others: readonly Rule[]): string | null {
  const name = cleanRuleText(rule.name);
  if (!name) return "A rule needs a name.";
  if (name.length > RULE_NAME_LEN) return `A rule's name must be at most ${RULE_NAME_LEN} characters.`;
  if (cleanRuleText(rule.description).length > RULE_DESCRIPTION_LEN) return `A description must be at most ${RULE_DESCRIPTION_LEN} characters.`;
  if (others.some((r) => key(r.name) === key(name))) return "This run already has that rule.";
  return null;
}

export const cleanRule = (rule: Rule): Rule => ({ name: cleanRuleText(rule.name), description: cleanRuleText(rule.description) });

/** Whether the ruleset has a rule of this name. */
export const hasRule = (rules: readonly Rule[], name: string): boolean => rules.some((r) => key(r.name) === key(name));

/** The rules with `rule` added at the end (unchanged if it can't be: a duplicate, a bad rule, or no room). */
export function addRule(rules: readonly Rule[], rule: Rule): Rule[] {
  if (rules.length >= MAX_RULES || ruleError(rule, rules)) return [...rules];
  return [...rules, cleanRule(rule)];
}

/** The rules with the one at `index` replaced (unchanged if the new one can't be saved). */
export function updateRule(rules: readonly Rule[], index: number, rule: Rule): Rule[] {
  if (index < 0 || index >= rules.length || ruleError(rule, rules.filter((_, i) => i !== index))) return [...rules];
  return rules.map((r, i) => (i === index ? cleanRule(rule) : r));
}

export const removeRule = (rules: readonly Rule[], index: number): Rule[] => rules.filter((_, i) => i !== index);

/** The rules with the one at `from` moved to `to` (both clamped into the list). */
export function moveRule(rules: readonly Rule[], from: number, to: number): Rule[] {
  const out = [...rules];
  if (from < 0 || from >= out.length) return out;
  const [moved] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, moved);
  return out;
}

/** A saved or received ruleset made safe to use: rules with a name, cleaned, no duplicates, at most MAX_RULES. */
export function sanitizeRules(saved: unknown): Rule[] {
  if (!Array.isArray(saved)) return [];
  let out: Rule[] = [];
  for (const item of saved) {
    if (!item || typeof item !== "object") continue;
    const { name, description } = item as Record<string, unknown>;
    if (typeof name !== "string") continue;
    out = addRule(out, { name, description: typeof description === "string" ? description : "" });
  }
  return out;
}

/** A group of suggestions, as the Runs page shows them. */
export interface SuggestionGroup {
  title: string;
  rules: Rule[];
}

/**
 * The challenge rules Three Houses players set themselves most often (from r/fireemblem, Serenes Forest and GameFAQs
 * challenge-run threads), one click each. The names are what people call them; the descriptions say what they mean.
 */
export const RULE_SUGGESTIONS: SuggestionGroup[] = [
  {
    title: "Difficulty",
    rules: [
      { name: "Maddening", description: "Play on Maddening difficulty." },
      { name: "Classic mode", description: "Fallen units are gone for good." },
      { name: "No New Game+", description: "Start fresh: no renown spent on carried-over supports, skills or levels." },
    ],
  },
  {
    title: "Ironman",
    rules: [
      { name: "No Divine Pulse", description: "Never turn back time; every mistake stands." },
      { name: "No resets", description: "No reloading a save or restarting a chapter; whatever happens stays." },
      { name: "Nuzlocke", description: "A unit that falls is never used again, and at most one new recruit a month." },
    ],
  },
  {
    title: "Resources",
    rules: [
      { name: "No DLC", description: "No Cindered Shadows, DLC classes, items, battalions or the Abyss shop." },
      { name: "No auxiliary battles", description: "Fight only the story chapters and paralogues: no grinding." },
      { name: "No bought stat boosters", description: "Seeds, Dew and other stat boosters only from chests and drops." },
      { name: "No forging", description: "No upgrading or repairing weapons at the blacksmith." },
      { name: "No battalions", description: "No battalions, so no gambits." },
    ],
  },
  {
    title: "Units",
    rules: [
      { name: "House only", description: "No recruiting students or faculty from other houses." },
      { name: "Byleth solo", description: "Only Byleth deploys, unless the game makes others." },
      { name: "Low man", description: "Deploy at most six units in any battle." },
      { name: "Lord can't fall", description: "If Byleth or the house leader falls, the run is over." },
    ],
  },
  {
    title: "Classes",
    rules: [
      { name: "Randomized classes", description: "Roll each unit's next class at every certification; it sticks until the next." },
      { name: "No reclassing", description: "Every unit stays in its starting class line." },
      { name: "No flying classes", description: "No Pegasus Knights, Wyvern Riders or other fliers." },
    ],
  },
];

/** Suggestions in the order they are listed. */
export const ALL_SUGGESTIONS: Rule[] = RULE_SUGGESTIONS.flatMap((g) => g.rules);

/**
 * How many columns the ruleset's picture lays its rules out in: one while they fit in one, more for long rulesets,
 * fewer in a frame taller than wide.
 */
export function rulesetColumns(count: number, portrait: boolean): number {
  if (portrait) return count > 10 ? 2 : 1;
  if (count > 16) return 3;
  return count > 6 ? 2 : 1;
}

/** How long the ruleset page stays in a video (ms): long enough to read, longer the more rules there are. */
export const RULES_PAGE_MIN_MS = 2500;
export const RULES_PAGE_MAX_MS = 8000;
export const rulesetPageMs = (count: number): number => Math.min(RULES_PAGE_MAX_MS, RULES_PAGE_MIN_MS + Math.max(0, count) * 400);

/** How much smaller content `natural` px tall is drawn to fit `room` px (never bigger: 1 when it fits). */
export const fitScale = (natural: number, room: number): number => (natural > room && natural > 0 && room > 0 ? room / natural : 1);
