import { CONCEPT_ICON } from "../../icons/concepts";
import { isStoryClass } from "../../reference/links";
import { gameLanguageLocale } from "../../gameLanguage";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
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
import { AbilityIcon, ArtIcon, ItemIcon, SpellIcon, WeaponIcon } from "../../reference/icons";
import { DetailCard, MasterDetail, Section } from "../layout";
import { artSummary } from "./CharactersPage";
import { TierIcon, TierLabel, tierMetalStyle } from "./TierIcon";
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

const TIER_OPTIONS = TIERS.map((t) => [t, <TierLabel key={t} tier={t} />] as const);
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

/** A class's skill requirements as skill icons, each with its rank, joined by "or" when any one is enough. */
function Requirements({ c }: { c: GameClass }) {
  return (
    <span className="class-reqs" title={`${requirementText(c)}${c.requirement_any ? " (either)" : ""}`}>
      {c.requirements.map((r, i) => (
        <Fragment key={r.skill}>
          {i > 0 && c.requirement_any && <span className="class-reqs-or">or</span>}
          <span className="class-req">
            <SkillIcon skill={r.skill} title={SKILL_LABEL[r.skill]} />
            <span className="class-req-rank">{r.rank}</span>
          </span>
        </Fragment>
      ))}
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
                      <span className="who-name class-name">
                        <TierIcon tier={c.tier} size={20} />
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

/** The four steps of the class-change ladder, in order (DLC classes sit on the Advanced step). */
const LADDER: Tier[] = ["Beginner", "Intermediate", "Advanced", "Master"];

/** The level each step's exam asks for, from the classes on it. */
function ladderGates(classes: GameClass[]): Partial<Record<Tier, number>> {
  const gates: Partial<Record<Tier, number>> = {};
  for (const c of classes) if (c.level && !gates[c.tier]) gates[c.tier] = c.level;
  return gates;
}

/** The biggest growth change any class makes, so every class's growth bars share one scale. */
function growthScale(classes: GameClass[]): number {
  return Math.max(10, ...classes.flatMap((c) => STAT_KEYS.map((k) => Math.abs(c.growths[k] ?? 0))));
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
  const [people] = usePeopleFilters();
  const runKeys = runCharacterKeys(units);
  const gates = useMemo(() => ladderGates(data.classes), [data.classes]);
  const scale = useMemo(() => growthScale(data.classes), [data.classes]);
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

  return (
    <DetailCard title={c.name} icon={<TierIcon tier={c.tier} size={30} />} label={`${c.name} reference`}>
      {/* display: contents, so the sections stay the card's own panes; it only carries the tier's metal. */}
      <div className="class-detail" style={tierMetalStyle(c.tier)}>
        <ClassHero c={c} data={data} units={units} sprites={sprites} gates={gates} restriction={restriction} />

        <Section title="Stats" icon={CONCEPT_ICON.growth}>
          <ClassLedger c={c} scale={scale} />
        </Section>

        <Section title="Abilities" icon={CONCEPT_ICON.ability}>
          <ClassAbilities c={c} data={data} />
        </Section>

        <Section title="Units" icon={CONCEPT_ICON.roster}>
          <>
            <WhoFilters />
            {starters.length > 0 && (
              <>
                <h3 className="class-subhead">Starts in this class</h3>
                {c.name === "Death Knight" ? <Spoiler category="identities"><PeopleRow people={starters} part2={part2} /></Spoiler> : <PeopleRow people={starters} part2={part2} />}
              </>
            )}
            {fits.length > 0 ? (
              <>
                <h3 className="class-subhead" title="Strengths (or budding talents) in at least half of the required skills, and no weakness in any of them">
                  Strong in its skills
                </h3>
                <PeopleRow people={fits.map((f) => f.ch)} part2={part2} skills={c.requirements.map((r) => r.skill)} />
              </>
            ) : (
              starters.length === 0 && <p className="muted">{restricted ? "Restricted class." : "Nobody stands out for this class."}</p>
            )}
          </>
        </Section>
      </div>
    </DetailCard>
  );
}

/**
 * A class's description. A compact card clamps it to two lines (classes.css); "Show all" appears only when the clamp
 * actually hides text, and opens it in place. Keyed by class, so another class starts closed; it also re-measures
 * whenever the text changes, since a new text can overflow the same box without resizing it.
 */
function ClassLore({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    const watch = new ResizeObserver(check);
    watch.observe(el);
    return () => watch.disconnect();
  }, [text]);
  return (
    <div className={`class-lore-wrap${open ? " open" : ""}`}>
      <p ref={ref} className="class-lore">
        <LinkedDescription text={text} />
      </p>
      {(clamped || open) && (
        <button type="button" className="class-lore-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}

/**
 * The top of a class card: its unit on a dais lit in the tier's metal, what the class is, what it takes to get in and
 * how it moves, and where it sits on the class-change ladder.
 */
function ClassHero({
  c,
  data,
  units,
  sprites,
  gates,
  restriction,
}: {
  c: GameClass;
  data: ReferenceData;
  units: Unit[];
  sprites: SpriteIndex | null;
  gates: Partial<Record<Tier, number>>;
  restriction: ReactNode;
}) {
  const step: Tier = c.tier === "DLC" ? "Advanced" : c.tier;
  const onLadder = LADDER.includes(step);
  const here = LADDER.indexOf(step);
  const kicker = c.tier === "DLC" ? "DLC class, Advanced tier" : `${c.tier} class`;
  const weakTo = c.types
    .filter((t) => t !== "Infantry")
    .map((t) => (t === "Armored" ? "armorslayers" : t === "Cavalry" ? "horseslayers" : "bows"));
  const mountMv = c.mount_boosts.mv;

  return (
    <header className="class-hero">
      <div className="class-hero-top">
        <div className="class-dais">
          <ClassSprite c={c} index={sprites} units={units} data={data} size={104} />
        </div>
        <div className="class-hero-body">
          <p className="class-kicker">{kicker}</p>
          {c.description && <ClassLore key={c.name} text={c.description} />}
          <dl className="class-exam">
            <div>
              <dt>Requires</dt>
              <dd>{c.requirements.length ? <Requirements c={c} /> : <span className="class-exam-text">{restriction || "Nothing"}</span>}</dd>
            </div>
            {!!c.level && (
              <div>
                <dt>Exam</dt>
                <dd>
                  <span className="class-exam-big">Lv {c.level}</span>
                  {c.seal && <span className="class-exam-note">{c.seal}</span>}
                </dd>
              </div>
            )}
            <div>
              <dt>Moves</dt>
              <dd title={mountMv ? `${mountMv > 0 ? "+" : ""}${mountMv} while mounted` : "Movement in this class"}>
                <span className="class-exam-big">{c.bases.mv}</span>
                <span className="class-exam-note">{c.types.join(", ")}</span>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {onLadder && (
        <ol className="class-rail" aria-label="Class tiers">
          {LADDER.map((t, i) => (
            <li
              key={t}
              className={i === here ? "here" : i < here ? "past" : ""}
              style={tierMetalStyle(t)}
              aria-current={i === here ? "step" : undefined}
            >
              <TierIcon tier={t} size={32} decorative />
              <span className="rung-name">{t}</span>
              {gates[t] && <span className="rung-gate">Lv {gates[t]}</span>}
            </li>
          ))}
        </ol>
      )}

      {(weakTo.length > 0 || c.gender || c.restriction) && (
        <div className="class-notes">
          {weakTo.map((w) => (
            <span key={w} className="class-note warn">
              <Icon name={CONCEPT_ICON.warning} />
              Weak to {w}
            </span>
          ))}
          {c.gender && (
            <span className="class-note">
              <Icon name={c.gender === "Male" ? CONCEPT_ICON.male : CONCEPT_ICON.female} />
              {c.gender === "Male" ? "Men" : "Women"} only
            </span>
          )}
          {c.requirements.length > 0 && c.restriction && <span className="class-note plain">{restriction}</span>}
          {c.restriction && (
            <a className="class-wiki" href="https://fireemblemwiki.org/wiki/Class_change" target="_blank" rel="noreferrer">
              Class change on Fire Emblem Wiki
            </a>
          )}
        </div>
      )}
    </header>
  );
}

/** A growth change as a bar from the middle: right and green for a gain, left and red for a loss. */
function GrowthBar({ value, scale }: { value: number; scale: number }) {
  const share = Math.min(50, (Math.abs(value) / scale) * 50);
  const tone = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return (
    <span className={`growth-bar ${tone}`}>
      <span className="growth-track" aria-hidden>
        <span className="growth-fill" style={{ width: `${share}%` }} />
      </span>
      <span className="growth-value">{value ? `${value > 0 ? "+" : ""}${value}%` : "·"}</span>
    </span>
  );
}

function MountMark({ value }: { value: number | undefined }) {
  if (!value) return null;
  return (
    <span className={`ledger-mount${value < 0 ? " neg" : ""}`} title={`${value > 0 ? "+" : ""}${value} more while mounted`}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

/** The class's stats as one ledger: the floor it sets, what it adds while worn, and how it bends growth. */
function ClassLedger({ c, scale }: { c: GameClass; scale: number }) {
  const growthTotal = STAT_KEYS.reduce((n, k) => n + (c.growths[k] ?? 0), 0);
  const boostTotal = STAT_KEYS.reduce((n, k) => n + (c.boosts[k] ?? 0), 0);
  const trains = c.proficient.length > 0 || Object.values(c.skill_bonus).some(Boolean);
  const sign = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : "flat");
  return (
    <>
      <div className="class-ledger-wrap">
        <table className="class-ledger">
          <thead>
            <tr>
              <th aria-label="Stat" />
              <th title={VIEW_HINT.bases}>Base</th>
              <th title={VIEW_HINT.boosts}>Boost</th>
              <th className="ledger-growth" title={VIEW_HINT.growths}>Growth</th>
            </tr>
          </thead>
          <tbody>
            {STAT_KEYS.map((k) => (
              <tr key={k}>
                <th scope="row">{STAT_LABEL[k]}</th>
                <td className="ledger-base">{c.bases[k]}</td>
                <td className={`ledger-boost ${sign(c.boosts[k])}`}>
                  {fmt(c.boosts[k], "boosts")}
                  <MountMark value={c.mount_boosts[k]} />
                </td>
                <td className="ledger-growth">
                  <GrowthBar value={c.growths[k]} scale={scale} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="ledger-mv">
              <th scope="row">Mv</th>
              <td className="ledger-base">{c.bases.mv}</td>
              <td className={`ledger-boost ${sign(c.boosts.mv)}`}>
                {fmt(c.boosts.mv, "boosts")}
                <MountMark value={c.mount_boosts.mv} />
              </td>
              <td className="ledger-growth ledger-aside">Movement has no growth</td>
            </tr>
            <tr className="ledger-total">
              <th scope="row">Total</th>
              <td />
              <td className={`ledger-boost ${sign(boostTotal)}`} title="Sum of the nine stat boosts (Mv not included)">{fmt(boostTotal, "boosts")}</td>
              <td className="ledger-growth" title="Sum of the nine growth changes">
                <span className={`growth-sum ${sign(growthTotal)}`}>{growthTotal ? `${growthTotal > 0 ? "+" : ""}${growthTotal}%` : "·"}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {trains && (
        <>
          <h3 className="class-subhead">Skills it trains</h3>
          <SkillChips gameClass={c} />
        </>
      )}
    </>
  );
}

/** What the class gives: its abilities while worn, then what mastering it teaches for good. */
function ClassAbilities({ c, data }: { c: GameClass; data: ReferenceData }) {
  const ability = (name: string) => data.abilities.find((a) => a.name === name);
  const art = data.combat_arts.find((a) => a.name === c.mastery_art);
  return (
    <>
      <h3 className="class-subhead">While in the class</h3>
      {c.abilities.length ? (
        <ul className="class-perks">
          {c.abilities.map((a) => (
            <li key={a}>
              <AbilityIcon name={a} />
              <span>
                <b><AbilityLink name={a} /></b>
                {ability(a) && <span className="class-perk-desc"><LinkedDescription text={ability(a)!.description} /></span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None</p>
      )}
      {(c.mastery_ability || c.mastery_art) && (
        <>
          <h3 className="class-subhead">Mastery rewards</h3>
          <p className="class-subnote">Unlocked through class mastery.</p>
          <div className="class-mastery">
            {c.mastery_ability && (
              <article className="mastery-tile">
                <span className="mastery-kind">Ability</span>
                <b>
                  <AbilityIcon name={c.mastery_ability} />
                  <AbilityLink name={c.mastery_ability} />
                </b>
                {ability(c.mastery_ability) && <p><LinkedDescription text={ability(c.mastery_ability)!.description} /></p>}
              </article>
            )}
            {c.mastery_art && (
              <article className="mastery-tile">
                <span className="mastery-kind">Combat art</span>
                <b>
                  <ArtIcon name={c.mastery_art} />
                  <ArtLink name={c.mastery_art} />
                </b>
                {art && <p>{artSummary(art)}</p>}
              </article>
            )}
          </div>
        </>
      )}
    </>
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
