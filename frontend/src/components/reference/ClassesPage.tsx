import { CONCEPT_ICON } from "../../icons/concepts";
import { isStoryClass } from "../../reference/links";
import { gameLanguageLocale } from "../../gameLanguage";
import { Fragment, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Unit } from "../../api";
import { characterPortraitKey, runCharacterKeys } from "../../portraits";
import { portraitCharacterId } from "../../portraits";
import { SpriteIndex, UnitSprite, useSprites } from "../battle/mapIcons";
import { CLASS_UNIT, EXCLUSIVE_CLASS_OWNERS } from "../../reference/classSprites";
import "./classes.css";
import { useNav } from "../../nav";
import { canonical, normalize, searchMatches } from "../../fuzzy";
import { passes, usePeopleFilters } from "../../filters";
import { PeopleFilterChips, PeopleFilterFields, usePeopleFilterCount } from "../PeopleFilters";
import { AbilityLink, ArtLink, CharLink, ClassLink, ItemLink, LinkedDescription } from "../Links";
import { SkillIcon } from "../SkillIcon";
import { SkillChips } from "./SkillChips";
import {
  Character,
  ClassStats,
  CombatArt,
  GameClass,
  Magic,
  ReferenceData,
  SKILL_LABEL,
  STAT_KEYS,
  STAT_LABEL,
  SkillKey,
  TIERS,
  Tier,
} from "../../reference/types";
import { KeyPortrait, revealCard } from "../ui";
import { AbilityIcon, ArtIcon, ItemIcon, SkillIcons, SpellIcon, WeaponIcon } from "../../reference/icons";
import { DetailCard, MasterDetail, Section } from "../layout";
import { artSummary } from "./CharactersPage";
import { TierIcon } from "./TierIcon";
import { Icon } from "../Icon";
import { useSpoiler } from "../../spoilers";
import {
  CheckChips,
  CheckList,
  FilterMenu,
  NoMatches,
  RefLink,
  RowCaret,
  SearchBox,
  Segmented,
  Spoiler,
  useSort,
} from "../common";
const compareValues = (a: number | string, b: number | string) => typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), gameLanguageLocale());

type View = "growths" | "boosts" | "bases";
type ColKey = keyof ClassStats;
type SortKey = "name" | "tier" | ColKey | "total";

const VIEW_LABEL: Record<View, string> = { growths: "Growth Rates", boosts: "Stat Boosts", bases: "Base Stats" };
const VIEW_HINT: Record<View, string> = {
  growths: "Added to the character's own growth rates while in the class.",
  boosts: "Added to the character's stats while in the class (not kept after changing class). Mounted extras in brackets.",
  bases: "Minimum stats in the class: on changing into it, any lower stat is raised to this for good.",
};
const COLS: ColKey[] = [...STAT_KEYS, "mv"];

interface Props {
  units: Unit[];
  part2: boolean;
}


/** Catch accidental duplicate sprite choices while developing the reference data. */
export function assertClassSpriteRotation(classes: GameClass[], characters: Character[]) {
  const known = new Set(characters.map((c) => c.key));
  const regularPicks = classes.filter((c) => !EXCLUSIVE_CLASS_OWNERS[c.name]).map((c) => CLASS_UNIT[c.name]?.who);
  const firstPass = regularPicks.slice(0, characters.length);
  const exclusiveOwnersMatch = Object.entries(EXCLUSIVE_CLASS_OWNERS).every(([name, owner]) => CLASS_UNIT[name]?.who === owner);
  if (!exclusiveOwnersMatch || firstPass.length !== characters.length || new Set(firstPass).size !== firstPass.length || firstPass.some((who) => !who || !known.has(who)) || regularPicks.some((who) => !who || !known.has(who))) {
    throw new Error("Exclusive classes must use their canonical owners; ordinary classes must rotate through every character before repeating.");
  }
}

/** The atlas rows for a class's sprite: its body with the character's own head, their finished sprite where the class
 * has no body, else the body with a generic head. Null when the atlas has neither. */
function classLayers(index: SpriteIndex, classId: number, charId: number | undefined, female: boolean) {
  const bodies = index.classes[classId];
  const body = bodies && (female ? (bodies.f ?? bodies.m) : (bodies.m ?? bodies.f));
  const own = charId === undefined ? undefined : index.characters[charId];
  // Noble and Commoner have no body of their own: everyone wears their finished sprite there.
  if (body === undefined || ((classId === 0 || classId === 1) && own !== undefined)) {
    return own === undefined ? null : { row: own, head: null, mounted: false };
  }
  const head = charId === undefined ? undefined : index.heads.characters[charId];
  return { row: body, head: head ?? (female ? index.heads.f : index.heads.m), mounted: index.mounted.includes(body) };
}

/** A class's map sprite: its canonical unit, as the game draws them on the battle map. */
function ClassSprite({ c, index, units, data, size }: { c: GameClass; index: SpriteIndex | null; units: Unit[]; data: ReferenceData; size: number }) {
  const [showIdentities] = useSpoiler("identities");
  const pick = CLASS_UNIT[c.name];
  const hideIdentity = c.name === "Death Knight" && !showIdentities;
  const key = pick && !hideIdentity ? characterPortraitKey(pick.who, units) : null;
  const who = pick && !hideIdentity ? data.characters.find((ch) => ch.key === pick.who) : undefined;
  const female = c.gender ? c.gender === "Female" : key ? key.endsWith("_f") : who?.gender === "Female";
  const layers = index && pick ? classLayers(index, pick.id, key ? portraitCharacterId(key) ?? undefined : undefined, !!female) : null;
  return (
    <span className="class-sprite" style={{ "--sprite-size": `${size}px` } as CSSProperties} title={who ? `${c.name} · ${who.name}` : c.name}>
      {index && layers ? (
        <svg viewBox="0 0 1 1" width={size} height={size} aria-hidden>
          <UnitSprite index={index} layers={layers} side="player" />
        </svg>
      ) : <TierIcon tier={c.tier} size={size} />}
      <span className="class-sprite-name">{who ? `${c.name}, shown as ${who.name}` : c.name}</span>
    </span>
  );
}

const TIER_OPTIONS = TIERS.map((t) => [t, t] as const);
const GENDERS = [
  ["Male", "Men"],
  ["Female", "Women"],
] as const;

export type ClassesTab = "classes" | "arts" | "abilities" | "magic" | "weapons" | "items";

/** The Archive's tab counts for the classes and gear tabs (ArchivePage.tsx draws the header). */
export function classesTabCounts(data: ReferenceData | null, showStoryClasses: boolean): Record<ClassesTab, number | undefined> {
  return {
    classes: data?.classes.filter((c) => showStoryClasses || !isStoryClass(c.name)).length,
    arts: data?.combat_arts.length,
    abilities: data?.abilities.length,
    magic: data?.magic.length,
    weapons: data?.items.filter((i) => i.kind === "Weapon").length,
    items: data?.items.filter((i) => i.kind !== "Weapon").length,
  };
}

/** One of the Archive's classes and gear tabs. */
export function ClassesView({ tab, data, units, part2 }: Props & { tab: ClassesTab; data: ReferenceData }) {
  const nav = useNav();
  if (import.meta.env.DEV) assertClassSpriteRotation(data.classes, data.characters);
  const q = nav.route.q ?? "";
  return tab === "classes" ? (
    <ClassTable data={data} units={units} part2={part2} />
  ) : tab === "arts" ? (
    <ArtsTable key={q} data={data} initial={q} />
  ) : tab === "magic" ? (
    <MagicTable key={q} data={data} initial={q} />
  ) : tab === "weapons" ? (
    <InventoryTable key={`weapons-${q}`} data={data} initial={q} weapons />
  ) : tab === "items" ? (
    <InventoryTable key={`items-${q}`} data={data} initial={q} />
  ) : (
    <AbilitiesTable key={q} data={data} initial={q} />
  );
}

function requirementText(c: GameClass): string {
  return c.requirements.map((r) => `${SKILL_LABEL[r.skill]} ${r.rank}`).join(c.requirement_any ? " or " : ", ");
}

/** A class's skill requirements as weapon/skill icons with the rank beside each; the full wording on hover. */
function Requirements({ c }: { c: GameClass }) {
  return (
    <span title={`${requirementText(c)}${c.requirement_any ? " (either)" : ""}`}>
      <SkillIcons
        skills={c.requirements.map((r) => r.skill)}
        ranks={Object.fromEntries(c.requirements.map((r) => [r.skill, r.rank]))}
      />
    </span>
  );
}

function ClassTable({ data, units, part2 }: { data: ReferenceData } & Props) {
  const nav = useNav();
  const [showStoryClasses] = useSpoiler("storyClasses");
  const availableClasses = data.classes.filter((c) => showStoryClasses || !isStoryClass(c.name));
  const [view, setView] = useState<View>("growths");
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [genders, setGenders] = useState<("Male" | "Female")[]>([]);
  const [filter, setFilter] = useState("");
  const selected = nav.route.id ?? null;
  const select = (name: string) => nav.go({ page: "archive", tab: "classes", id: name });
  const { sort, header } = useSort<SortKey>({ key: "tier", dir: 1 }, ["name", "tier"]);
  const sprites = useSprites();

  const cols = view === "growths" ? STAT_KEYS.slice() : COLS;
  const value = (c: GameClass, k: ColKey) => (c[view] as Partial<ClassStats>)[k] ?? 0;
  const total = (c: GameClass) => STAT_KEYS.reduce((n, k) => n + value(c, k), 0);

  const rows = useMemo(() => {
    const list = availableClasses.filter(
      (c) =>
        (!tiers.length || tiers.includes(c.tier)) &&
        (!genders.length || !c.gender || genders.includes(c.gender)) &&
        searchMatches(filter, c.name, c.tier, ...c.abilities, c.mastery_ability, c.mastery_art, ...c.types, ...c.proficient.map((s) => SKILL_LABEL[s])),
    );
    const order = new Map(data.classes.map((c, i) => [c.name, i]));
    const val = (c: GameClass): number | string =>
      sort.key === "name" ? c.name : sort.key === "tier" ? order.get(c.name)! : sort.key === "total" ? total(c) : value(c, sort.key);
    return list.sort((a, b) => compareValues(val(a), val(b)) * sort.dir || order.get(a.name)! - order.get(b.name)!);
  }, [data, tiers, genders, filter, sort, view, showStoryClasses]);

  // The id comes from the URL: accept a misspelt or differently cased class name too.
  const wanted = selected && (showStoryClasses || !isStoryClass(selected)) ? canonical(selected, availableClasses.map((c) => c.name)) : null;
  const current = availableClasses.find((c) => c.name === wanted) ?? rows[0] ?? null;

  const detail = current && (
    <ClassCard key={current.name} c={current} data={data} units={units} part2={part2} sprites={sprites} />
  );

  return (
    <MasterDetail wide detail={detail}>
      <section>
        <div className="toolbar">
          <SearchBox placeholder="Search class, ability, skill" value={filter} onChange={setFilter} />
          <Segmented
            label="Values"
            value={view}
            onChange={setView}
            options={(Object.keys(VIEW_LABEL) as View[]).map((v) => [v, VIEW_LABEL[v], VIEW_HINT[v]] as const)}
          />
          <FilterMenu
            count={tiers.length + genders.length}
            onClear={() => {
              setTiers([]);
              setGenders([]);
            }}
            chips={
              <>
                <CheckChips options={TIER_OPTIONS} value={tiers} onChange={setTiers} />
                <CheckChips options={GENDERS} value={genders} onChange={setGenders} />
              </>
            }
          >
            <CheckList label="Tier" columns={2} options={TIER_OPTIONS} value={tiers} onChange={setTiers} />
            <CheckList label="Usable By" columns={2} options={GENDERS} value={genders} onChange={setGenders} />
          </FilterMenu>
        </div>
        <div className="table-wrap">
          <table className="units ref-table">
            <thead>
              <tr>
                {header("tier", "Class", { className: "left", title: "Sort by tier (Unique → DLC), click again to reverse" })}
                {cols.map((k) => header(k, STAT_LABEL[k], { stat: k }))}
                {header("total", "Total", { className: "bst-col", title: "Sum of the nine stats (Mv not included)" })}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.name}
                  className={current?.name === c.name ? "selected" : ""}
                  onClick={() => {
                    select(c.name);
                    revealCard();
                  }}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && select(c.name)}
                >
                  <td className="left name-cell">
                    <div className="class-lead">
                      <ClassSprite c={c} index={sprites} units={units} data={data} size={36} />
                      <div className="who-text">
                      <span className="who-name">
                        {c.name}
                        {c.gender && (
                          <span className="gender-mark" title={`${c.gender} only`}>
                            <Icon name={c.gender === "Male" ? CONCEPT_ICON.male : CONCEPT_ICON.female} />
                          </span>
                        )}
                      </span>
                      <span className="who-class">
                        {c.tier}
                        {c.level ? ` · Lv ${c.level}` : ""} · {c.types.join(", ")}
                      </span>
                      </div>
                    </div>
                  </td>
                  {cols.map((k) => {
                    const m = view === "boosts" ? c.mount_boosts[k] : undefined;
                    return (
                      <td key={k} className="num" title={m ? `${m > 0 ? "+" : ""}${m} more while mounted` : undefined}>
                        {fmt(value(c, k), view)}
                        {m ? <span className={`mark mount ${m < 0 ? "neg" : ""}`}>{m > 0 ? `+${m}` : m}</span> : null}
                      </td>
                    );
                  })}
                  <td className="num bst-col">{fmt(total(c), view)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <NoMatches
              what="classes"
              onReset={() => {
                setFilter("");
                setTiers([]);
                setGenders([]);
              }}
            />
          )}
        </div>
      </section>
    </MasterDetail>
  );
}

function fmt(v: number, view: View): string {
  if (view === "bases") return String(v);
  return v === 0 ? "·" : v > 0 ? `+${v}` : String(v);
}

/**
 * How well a character's strengths line up with the class's required skills (higher is better), or null
 * when they don't fit: a weakness in a required skill, or strengths in fewer than half of them.
 */
function fit(ch: Character, c: GameClass): number | null {
  if (c.gender && ch.gender !== c.gender && ch.gender !== "Either") return null;
  if (!c.requirements.length) return null;
  const scores = c.requirements.map((r): number => {
    const a = ch.skills[r.skill].aptitude;
    return a === "strong" ? 2 : a === "budding" || a === "weak_budding" ? 1 : a === "weak" ? -2 : 0;
  });
  if (c.requirement_any) return Math.max(...scores) > 0 ? Math.max(...scores) : null;
  const good = scores.filter((s) => s > 0).length;
  if (scores.some((s) => s < 0) || good < Math.ceil(scores.length / 2)) return null;
  return scores.reduce((n, s) => n + s, 0);
}

function ClassCard({
  c,
  data,
  units,
  part2,
  sprites,
}: {
  c: GameClass;
  data: ReferenceData;
  units: Unit[];
  part2: boolean;
  sprites: SpriteIndex | null;
}) {
  const ability = (name: string) => data.abilities.find((a) => a.name === name);
  const art = data.combat_arts.find((a) => a.name === c.mastery_art);
  const [people] = usePeopleFilters();
  const runKeys = runCharacterKeys(units);
  // The shared people filters (affiliation, current run, route) narrow who is listed here too.
  const shown = (ch: Character) => passes(people, { key: ch.key, house: ch.house, inRun: runKeys.has(ch.key) });
  const restricted = /only/i.test(c.restriction) && !/certified/i.test(c.restriction);
  const fits = restricted
    ? []
    : data.characters
        .filter(shown)
        .map((ch) => ({ ch, score: fit(ch, c) }))
        .filter((x): x is { ch: Character; score: number } => x.score !== null)
        .sort((a, b) => b.score - a.score || a.ch.name.localeCompare(b.ch.name, gameLanguageLocale()));
  const starters = data.characters.filter((ch) => ch.start_class === c.name && shown(ch));
  const restriction = c.name === "Death Knight" ? <Spoiler category="identities">{c.restriction}</Spoiler> : c.restriction;
  const weakTo = c.types
    .filter((t) => t !== "Infantry")
    .map((t) => (t === "Armored" ? "armorslayers" : t === "Cavalry" ? "horseslayers" : "bows"));

  return (
    <DetailCard title={c.name} icon={<ClassSprite c={c} index={sprites} units={units} data={data} size={36} />} label={`${c.name} reference`}>
      <div className="class-head">
        <ClassSprite c={c} index={sprites} units={units} data={data} size={88} />
        <dl className="ref-facts">
        <dt>Tier</dt>
        <dd className="tier-row">
          <TierIcon tier={c.tier} size={22} />
          {c.tier === "DLC" ? "DLC (Advanced tier)" : c.tier}
          {!!c.level && (
            <span className="muted">
              {" "}
              · from Lv {c.level}, {c.seal}
            </span>
          )}
        </dd>
        <dt>Requires</dt>
        <dd>
          {c.requirements.length ? <Requirements c={c} /> : restriction || "—"}
          {c.requirements.length > 0 && c.restriction && <div className="muted small">{restriction}</div>}
          {c.restriction && <div className="muted small"><a href="https://fireemblemwiki.org/wiki/Class_change" target="_blank" rel="noreferrer">Fire Emblem Wiki</a></div>}
        </dd>
        <dt>Type</dt>
        <dd>
          {c.types.join(", ")}
          {weakTo.length > 0 && <span className="muted small"> · weak to {weakTo.join(" and ")}</span>}
          {c.gender && (
            <span className="gender-mark" title={`${c.gender} units only`}>
              <Icon name={c.gender === "Male" ? CONCEPT_ICON.male : CONCEPT_ICON.female} />
            </span>
          )}
        </dd>
        </dl>
      </div>
      {c.description && <p><LinkedDescription text={c.description} /></p>}

      <Section title="Stats" icon={CONCEPT_ICON.growth}>
        <>
          <div className="stats-split">
          <table className="ref-stats">
            <thead>
              <tr>
                <th />
                <th title={VIEW_HINT.bases}>Base</th>
                <th title={VIEW_HINT.boosts}>Boost</th>
                <th title={VIEW_HINT.growths}>Growth</th>
              </tr>
            </thead>
            <tbody>
              {COLS.map((k) => {
                const m = c.mount_boosts[k];
                return (
                  <tr key={k}>
                    <th>{STAT_LABEL[k]}</th>
                    <td>{c.bases[k]}</td>
                    <td>
                      {fmt(c.boosts[k], "boosts")}
                      {m ? (
                        <span className={`mark mount ${m < 0 ? "neg" : ""}`} title="While mounted">
                          {m > 0 ? `+${m}` : m}
                        </span>
                      ) : null}
                    </td>
                    <td>{k === "mv" ? "" : `${fmt(c.growths[k], "growths")}${c.growths[k] ? "%" : ""}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <SkillChips gameClass={c} />
        </>
      </Section>

      <Section title="Abilities" icon={CONCEPT_ICON.ability}>
        <>
          <ul className="item-list">
            {c.abilities.map((a) => (
              <li key={a}>
                <span>
                  <b>
                    <AbilityIcon name={a} />
                    <AbilityLink name={a} />
                  </b>
                  {ability(a) && <span className="desc"><LinkedDescription text={ability(a)!.description} /></span>}
                </span>
              </li>
            ))}
            {c.abilities.length === 0 && <li className="muted">None</li>}
          </ul>
          {(c.mastery_ability || c.mastery_art) && (
            <>
              <h4 className="sub-title">Mastery</h4>
              <ul className="item-list">
                {c.mastery_ability && (
                  <li className="personal">
                    <span>
                      <b>
                        <AbilityIcon name={c.mastery_ability} />
                        <AbilityLink name={c.mastery_ability} />
                      </b>
                      {ability(c.mastery_ability) && <span className="desc"><LinkedDescription text={ability(c.mastery_ability)!.description} /></span>}
                    </span>
                  </li>
                )}
                {c.mastery_art && (
                  <li className="personal">
                    <span>
                      <b>
                        <ArtIcon name={c.mastery_art} />
                        <ArtLink name={c.mastery_art} />
                      </b>
                      {art && <span className="desc">{artSummary(art)}</span>}
                    </span>
                  </li>
                )}
              </ul>
            </>
          )}
        </>
      </Section>

      <Section title="Units" icon={CONCEPT_ICON.roster}>
        <>
          <WhoFilters />
          {starters.length > 0 && (
            <>
              <h4 className="sub-title">Starts in This Class</h4>
              {c.name === "Death Knight" ? <Spoiler category="identities"><PeopleRow people={starters} part2={part2} /></Spoiler> : <PeopleRow people={starters} part2={part2} />}
            </>
          )}
          {fits.length > 0 ? (
            <>
              <h4 className="sub-title" title="Strengths (or budding talents) in at least half of the required skills, and no weakness in any of them">
                Strong in Its Skills
              </h4>
              <PeopleRow people={fits.map((f) => f.ch)} part2={part2} skills={c.requirements.map((r) => r.skill)} />
            </>
          ) : (
            starters.length === 0 && <p className="muted">{restricted ? "Restricted class." : "Nobody stands out for this class."}</p>
          )}
        </>
      </Section>
    </DetailCard>
  );
}

/** The shared people filters, so the Who tab can be narrowed (e.g. to the current run) without leaving it. */
function WhoFilters() {
  const [count, clear] = usePeopleFilterCount();
  return (
    <div className="toolbar who-filters">
      <FilterMenu label="Filter people" count={count} onClear={clear} chips={<PeopleFilterChips />}>
        <PeopleFilterFields />
      </FilterMenu>
    </div>
  );
}

function PeopleRow({ people, part2, skills }: { people: Character[]; part2: boolean; skills?: SkillKey[] }) {
  const nav = useNav();
  return (
    <div className="people unit-grid">
      {people.map((ch) => (
        <RefLink key={ch.key} onClick={() => nav.go({ page: "archive", tab: "characters", id: ch.key })} title={`Open ${ch.name} in the Archive`}>
          <span className="person">
            <KeyPortrait portraitKey={characterPortraitKey(ch.key)} name={ch.name} part2={part2} size={72} />
            <span className="person-name">{ch.name}</span>
            {skills && (
              <span className="person-apt">
                {skills.map((s) => (
                  <SkillIcon key={s} skill={s} aptitude={ch.skills[s].aptitude} />
                ))}
              </span>
            )}
          </span>
        </RefLink>
      ))}
    </div>
  );
}

function ArtsTable({ data, initial }: { data: ReferenceData; initial: string }) {
  const [showStoryClasses] = useSpoiler("storyClasses");
  const [weapons, setWeapons] = useState<string[]>([]);
  const [filter, setFilter] = useState(initial);
  // Opened from a link to one art: show its row expanded.
  const [open, setOpen] = useState<string | null>(() => {
    const hit = data.combat_arts.find((a) => a.name.toLowerCase() === initial.toLowerCase());
    return hit ? hit.name + hit.weapon : null;
  });
  const { sort, header } = useSort<"name" | "weapon" | "might" | "hit" | "crit" | "cost">({ key: "weapon", dir: 1 }, ["name", "weapon"]);
  const weaponOptions = [...new Set(data.combat_arts.map((a) => a.weapon))].map((w) => [w, w] as const);

  // Who learns each art: characters (by skill rank), a class mastery, or a budding talent.
  type Learner = { who: string; how: string; skill?: SkillKey; rank?: string; charKey?: string; className?: string };
  const learners = useMemo(() => {
    const m = new Map<string, Learner[]>();
    const add = (art: string, l: Learner) => m.set(art, [...(m.get(art) ?? []), l]);
    for (const c of data.classes) if ((showStoryClasses || !isStoryClass(c.name)) && c.mastery_art) add(c.mastery_art, { who: c.name, how: "mastery", className: c.name });
    for (const ch of data.characters)
      for (const a of ch.arts) add(a.name, { who: ch.name, how: `${a.skill ? SKILL_LABEL[a.skill] + " " : ""}${a.rank}`, skill: a.skill || undefined, rank: a.rank, charKey: ch.key });
    for (const ch of data.characters) if (ch.budding) add(ch.budding.unlock, { who: ch.name, how: "budding talent", charKey: ch.key });
    return m;
  }, [data]);
  const learnerText = (name: string) => (learners.get(name) ?? []).map((l) => `${l.who} ${l.how}`);

  const order = new Map(data.combat_arts.map((a, i) => [a.name + a.weapon, i]));
  const numOf = (s: string) => (s && /^-?\d+/.test(s) ? parseInt(s, 10) : -999);
  const rows = data.combat_arts
    .filter((a) => (!weapons.length || weapons.includes(a.weapon)) && searchMatches(filter, a.name, a.description, ...learnerText(a.name)))
    .sort((a, b) => {
      const v = (x: CombatArt): number | string =>
        sort.key === "name" ? x.name : sort.key === "weapon" ? order.get(x.name + x.weapon)! : numOf(x[sort.key]);
      return compareValues(v(a), v(b)) * sort.dir || order.get(a.name + a.weapon)! - order.get(b.name + b.weapon)!;
    });

  return (
    <>
      <div className="toolbar">
        <SearchBox placeholder="Search art, effect, who learns it" value={filter} onChange={setFilter} />
        <FilterMenu count={weapons.length} onClear={() => setWeapons([])} chips={<CheckChips options={weaponOptions} value={weapons} onChange={setWeapons} />}>
          <CheckList label="Weapon" columns={2} options={weaponOptions} value={weapons} onChange={setWeapons} />
        </FilterMenu>
        <span className="muted small">{rows.length} arts</span>
      </div>
      <div className="table-wrap">
        <table className="units ref-table plain">
          <thead>
            <tr>
              {header("name", "Art", { className: "left" })}
              {header("weapon", "Weapon", { className: "left weapon-cell", title: "Sort by weapon" })}
              {header("might", "Mt")}
              {header("hit", "Hit")}
              {header("crit", "Crit")}
              <th title="Range">Rng</th>
              {header("cost", "Cost", { title: "Sort by durability cost" })}
              <th className="left">Effect</th>
              <th aria-label="Expand" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const id = a.name + a.weapon;
              const isOpen = open === id;
              const who = learners.get(a.name) ?? [];
              return (
                <Fragment key={id}>
              <tr className={`expandable ${isOpen ? "open" : ""}`} onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen}>
                <td className="left name-cell">
                  <ArtIcon name={a.name} weapon={false} />
                  {a.name}
                </td>
                <td className="left weapon-cell">
                  <WeaponIcon weapon={a.weapon} />
                </td>
                <td className="num">{a.might || "·"}</td>
                <td className="num">{a.hit || "·"}</td>
                <td className="num">{a.crit || "·"}</td>
                <td className="num">{a.range || "·"}</td>
                <td className="num">{a.cost || "·"}</td>
                <td className="left wrap">{a.description ? <LinkedDescription text={a.description} /> : <span className="muted">?</span>}</td>
                <td className="chevron" aria-hidden>
                  <RowCaret open={isOpen} />
                </td>
              </tr>
              {isOpen && (
                <tr className="expand-row">
                  <td colSpan={9}>
                    <span className="expand-label">Learned by</span>
                    {who.length ? (
                      <span className="chip-list">
                        {who.map((l) => (
                          <span key={l.who + l.how} className="item-chip">
                            {l.charKey ? <CharLink charKey={l.charKey}>{l.who}</CharLink> : l.className ? <ClassLink name={l.className}>{l.who}</ClassLink> : l.who}{" "}
                            <span className="muted" title={l.how}>
                              {l.skill ? (
                                <>
                                  <SkillIcon skill={l.skill} /> {l.rank}
                                </>
                              ) : (
                                l.how
                              )}
                            </span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="muted">No unit or class learns it by rank.</span>
                    )}
                  </td>
                </tr>
              )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <NoMatches
            what="combat arts"
            onReset={() => {
              setFilter("");
              setWeapons([]);
            }}
          />
        )}
      </div>
    </>
  );
}

const KINDS = [
  ["class", "Class"],
  ["skill", "Skill rank"],
  ["personal", "Personal"],
] as const;

function AbilitiesTable({ data, initial }: { data: ReferenceData; initial: string }) {
  const [filter, setFilter] = useState(initial);
  const [kinds, setKinds] = useState<("class" | "personal" | "skill")[]>([]);
  const { sort, header } = useSort<"name" | "kind">({ key: "name", dir: 1 }, ["name", "kind"]);
  // Leave out what a player never meets: unused entries and abilities only enemies have.
  const usable = (a: { description: string }) =>
    !/^on hold$/i.test(a.description);
  const classAbilities = useMemo(() => new Set(data.classes.flatMap((c) => [...c.abilities, c.mastery_ability])), [data]);
  const kindOf = (a: { name: string }) =>
    data.characters.some((c) => c.personal.some((p) => p.name === a.name)) ? "personal" : classAbilities.has(a.name) ? "class" : data.characters.some((c) => c.budding?.unlock === a.name || c.abilities.some((v) => v.name === a.name)) ? "skill" : "";
  const q = normalize(filter);
  const rows = data.abilities
    .filter(usable)
    .filter((a) => (!kinds.length || kinds.includes(kindOf(a) as never)) && searchMatches(filter, a.name, a.description))
    // An exact name match (from a link) comes first.
    .sort(
      (a, b) =>
        Number(normalize(b.name) === q) - Number(normalize(a.name) === q) ||
        compareValues(sort.key === "name" ? a.name : kindOf(a), sort.key === "name" ? b.name : kindOf(b)) * sort.dir,
    );
  return (
    <>
      <div className="toolbar">
        <SearchBox placeholder="Search ability, effect, source" value={filter} onChange={setFilter} />
        <FilterMenu count={kinds.length} onClear={() => setKinds([])} chips={<CheckChips options={KINDS} value={kinds} onChange={setKinds} />}>
          <CheckList label="Obtainable By" options={KINDS} value={kinds} onChange={setKinds} />
        </FilterMenu>
        <span className="muted small">{rows.length} abilities</span>
      </div>
      <div className="table-wrap">
        <table className="units ref-table plain">
          <thead>
            <tr>
              {header("name", "Ability", { className: "left" })}
              <th className="left">Effect</th>
              {header("kind", "Obtainable By", { className: "left" })}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.name} className={normalize(a.name) === q ? "match" : ""}>
                <td className="left name-cell">
                  <AbilityIcon name={a.name} />
                  {a.name}
                </td>
                <td className="left wrap"><LinkedDescription text={a.description} /></td>
                <td className="left wrap small">{kindOf(a) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MagicTable({ data, initial }: { data: ReferenceData; initial: string }) {
  const [filter, setFilter] = useState(initial);
  const [schools, setSchools] = useState<Magic["type"][]>([]);
  const [open, setOpen] = useState<string | null>(initial || null);
  const { sort, header } = useSort<"name" | "type" | "might" | "hit" | "uses">({ key: "name", dir: 1 }, ["name", "type"]);
  const rows = data.magic.filter((spell) => (!schools.length || schools.includes(spell.type)) && searchMatches(filter, spell.name, spell.type, spell.effect))
    .sort((a, b) => Number(normalize(b.name) === normalize(filter)) - Number(normalize(a.name) === normalize(filter)) || compareValues(a[sort.key], b[sort.key]) * sort.dir);
  const options = (["Black", "Dark", "White"] as const).map((type) => [type, `${type} magic`] as const);
  return <>
    <div className="toolbar">
      <SearchBox placeholder="Search spell, school or effect" value={filter} onChange={setFilter} />
      <FilterMenu count={schools.length} onClear={() => setSchools([])} chips={<CheckChips options={options} value={schools} onChange={setSchools} />}>
        <CheckList label="School" options={options} value={schools} onChange={setSchools} />
      </FilterMenu>
      <span className="muted small">{rows.length} spells</span>
    </div>
    <div className="table-wrap">
      <table className="units ref-table plain"><thead><tr>
        {header("name", "Spell", { className: "left" })}{header("type", "School", { className: "left" })}
        {header("might", "Mt")}{header("hit", "Hit")}<th>Range</th>{header("uses", "Uses")}<th className="left">Effect</th><th aria-label="Expand" />
      </tr></thead><tbody>{rows.map((spell) => {
        const expanded = open === spell.name;
        const learners = data.characters.flatMap((character) => [...character.spells.reason, ...character.spells.faith].filter((entry) => normalize(entry.name) === normalize(spell.name)).map((entry) => ({ character, rank: entry.rank })));
        return <Fragment key={spell.name}>
          <tr className={`expandable${expanded ? " open" : ""}`} tabIndex={0} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : spell.name)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setOpen(expanded ? null : spell.name); } }}>
            <td className="left name-cell"><SpellIcon name={spell.name} />{spell.name}</td><td className="left">{spell.type}</td>
            <td className="num">{spell.might}</td><td className="num">{spell.hit}</td><td>{spell.range}</td><td className="num">{spell.uses}</td>
            <td className="left wrap">{spell.effect ? <LinkedDescription text={spell.effect} /> : "?"}</td><td className="chevron"><RowCaret open={expanded} /></td>
          </tr>
          {expanded && <tr className="expand-row"><td colSpan={8}>
            <span className="expand-label">Learned by</span>
            {learners.length ? <span className="chip-list">{learners.map(({ character, rank }) => <span className="item-chip" key={character.key}><CharLink charKey={character.key}>{character.name}</CharLink> <span className="muted">{rank}</span></span>)}</span> : <span className="muted">No playable character learns this spell.</span>}
            <p className="muted small">Uses refill after each battle. Classes and abilities can change available uses and range.</p>
          </td></tr>}
        </Fragment>;
      })}</tbody></table>
      {rows.length === 0 && <NoMatches what="spells" onReset={() => { setFilter(""); setSchools([]); }} />}
    </div>
  </>;
}

function InventoryTable({ data, initial, weapons = false }: { data: ReferenceData; initial: string; weapons?: boolean }) {
  const [filter, setFilter] = useState(initial);
  const [types, setTypes] = useState<string[]>([]);
  const [ranks, setRanks] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(initial || null);
  const rankOptions = ["E", "E+", "D", "D+", "C", "C+", "B", "B+", "A", "A+", "S", "S+"].map((r) => [r, r] as const);
  const typeOptions = [...new Set(data.items.filter((i) => i.kind === "Weapon").map((i) => i.weapon_type ?? "Other"))].sort().map((t) => [t, t] as const);
  const kindOptions = [...new Set(data.items.filter((i) => i.kind !== "Weapon").map((i) => i.kind))].sort().map((t) => [t, t] as const);
  const sortKeys = weapons ? ["name", "weapon_type", "rank", "might", "hit", "crit", "weight", "range", "uses"] as const : ["name", "kind"] as const;
  const { sort, header } = useSort<(typeof sortKeys)[number]>({ key: "name", dir: 1 }, ["name", "weapon_type", "rank", "range", "kind"] as (typeof sortKeys)[number][]);
  const rows = data.items.filter((i) => (i.kind === "Weapon") === weapons &&
    (!weapons || ((!types.length || types.includes(i.weapon_type ?? "Other")) && (!ranks.length || ranks.includes(i.rank ?? "—")))) &&
    (weapons || !kinds.length || kinds.includes(i.kind)) && searchMatches(filter, i.name, i.kind, i.weapon_type ?? "", i.rank ?? "", i.effect ?? ""))
    .sort((a, b) => compareValues((a as unknown as Record<string, string | number>)[sort.key] ?? "", (b as unknown as Record<string, string | number>)[sort.key] ?? "") * sort.dir);
  const count = weapons ? types.length + ranks.length : kinds.length;
  const options = weapons ? [...typeOptions, ...rankOptions.map(([r]) => [r, `Rank ${r}`] as const)] : kindOptions;
  const selected = weapons ? [...types, ...ranks] : kinds;
  const change = (value: string[]) => weapons ? (setTypes(value.filter((x) => typeOptions.some(([t]) => t === x))), setRanks(value.filter((x) => rankOptions.some(([r]) => r === x)))) : setKinds(value);
  return <>
    <div className="toolbar"><SearchBox placeholder={weapons ? "Search weapon or effect" : "Search item, equipment or effect"} value={filter} onChange={setFilter} />
      <FilterMenu count={count} onClear={() => { setTypes([]); setRanks([]); setKinds([]); }} chips={<CheckChips options={options} value={selected} onChange={change} />}>
        {weapons ? <><CheckList label="Weapon type" columns={2} options={typeOptions} value={types} onChange={setTypes} /><CheckList label="Rank" columns={3} options={rankOptions} value={ranks} onChange={setRanks} /></> : <CheckList label="Kind" options={kindOptions} value={kinds} onChange={setKinds} />}
      </FilterMenu><span className="muted small">{rows.length} {weapons ? "weapons" : "items"}</span>
    </div>
    <div className="table-wrap"><table className="units ref-table plain"><thead><tr>
      {header("name", weapons ? "Weapon" : "Item", { className: "left" })}
      {weapons ? <>{header("weapon_type", "Type", { className: "left" })}{header("rank", "Rank")}{header("might", "Mt")}{header("hit", "Hit")}{header("crit", "Crit")}{header("weight", "Wt")}{header("range", "Range")}{header("uses", "Uses")}</> : header("kind", "Kind", { className: "left" })}
      <th aria-label="Expand" />
    </tr></thead><tbody>{rows.map((item) => { const expanded = open === item.name; return <Fragment key={item.name}>
      <tr className={`expandable${expanded ? " open" : ""}`} tabIndex={0} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : item.name)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setOpen(expanded ? null : item.name); } }}>
        <td className="left name-cell"><ItemIcon name={item.name} /><ItemLink name={item.name} /></td>
        {weapons ? <><td className="left">{item.weapon_type}</td><td>{item.rank}</td><td className="num">{item.might}</td><td className="num">{item.hit}</td><td className="num">{item.crit ?? "—"}</td><td className="num">{item.weight ?? "—"}</td><td>{item.range}</td><td className="num">{item.uses}</td></> : <td className="left">{item.kind}</td>}
        <td className="chevron"><RowCaret open={expanded} /></td>
      </tr>
      {expanded && <tr className="expand-row"><td colSpan={weapons ? 10 : 3}><span className="expand-label">Details</span><span><LinkedDescription text={item.effect || item.description || item.kind} /></span></td></tr>}
    </Fragment>; })}</tbody></table>{rows.length === 0 && <NoMatches what={weapons ? "weapons" : "items"} onReset={() => { setFilter(""); setTypes([]); setRanks([]); setKinds([]); }} />}</div>
  </>;
}
