import { CONCEPT_ICON } from "../icons/concepts";
import "./character/panels.css";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon, IconButton } from "./Icon";
import { api, LABELS, PortraitGender, RunSummary, STAT_KEYS, StatKey, Unit, VALUE_KEYS, ValueKey } from "../api";
import { characterKeyOfUnit, isByleth } from "../portraits";
import { useNav } from "../nav";
import { searchMatches } from "../fuzzy";
import { passes, usePeopleFilters } from "../filters";
import { useReference } from "../reference/types";
import { crestLabel } from "../reference/crests";
import { PeopleFilterChips, PeopleFilterFields, usePeopleFilterCount } from "./PeopleFilters";
import { FilterMenu, NoMatches, SearchBox, Segmented, compareValues, useSort } from "./common";
import { AbilityLink, ArtLink, CharLink, ClassLink, CrestLink, ItemLink, SpellLink } from "./Links";
import { AbilityIcon, ArtIcon, ItemIcon } from "../reference/icons";
import { SkillIcon } from "./SkillIcon";
import { SKILL_LABEL, type SkillKey } from "../reference/types";
import { GearIcon } from "./battle/gameIcons";
import { EquipMark } from "./EquipMark";
import {
  computeEbst,
  EbstConfig,
  EbstResult,
  EbstType,
  fmtEbst,
  OTHER_KEYS,
  OtherKey,
  typeLabel,
} from "../ebst";
import { ToastState } from "./Toasts";
import { Portrait, StatTip, Switch, TypeButtons } from "./ui";
import { useAffiliationIcon } from "./AffiliationIcon";
import { DetailCard, EmptyState, MasterDetail, PageHeader, Section, StatusChip } from "./layout";
import { CharacterHero } from "./character/CharacterHero";
import { BattalionPanel } from "./character/Battalion";
import { tidyAbility } from "../appearance";
import { plural } from "../format";

type SortKey = "name" | "ebst" | ValueKey;
type Mode = "base" | "displayed";

const NUMERIC_COLS: { key: SortKey; label: string; title?: string }[] = [
  { key: "hp", label: "HP" },
  { key: "mv", label: "Mv" },
  ...STAT_KEYS.map((k) => ({ key: k as SortKey, label: LABELS[k] })),
  {
    key: "ebst",
    label: "eBST",
    title: "Effective base stat total: Offense + Defense + the stats toggled on for this unit, divided by how many went in (set on the unit card)",
  },
];

const isValueKey = (k: SortKey): k is ValueKey => (VALUE_KEYS as readonly string[]).includes(k);
const isOther = (k: ValueKey): k is OtherKey => (OTHER_KEYS as readonly string[]).includes(k);

/** "Compare all as": an eBST setup applied to every unit for display only. null = each unit's own. */
type Lens = { name: string; cfgFor: (u: Unit) => EbstConfig } | null;

const valuesFor = (u: Unit, mode: Mode) => (mode === "base" ? u.base_values : u.displayed);
const cfgFor = (u: Unit, lens: Lens) => (lens ? lens.cfgFor(u) : u.ebst_effective);
const resultFor = (u: Unit, mode: Mode, lens: Lens): EbstResult => computeEbst(valuesFor(u, mode), cfgFor(u, lens));

const describeEbst = (cfg: EbstConfig) => {
  const parts = [
    `Offense ${typeLabel(cfg.offense)}`,
    `Defense ${typeLabel(cfg.defense)}`,
    ...OTHER_KEYS.filter((k) => cfg.stats.includes(k)).map((k) => LABELS[k]),
  ];
  return `(${parts.join(" + ")}) ÷ ${parts.length}`;
};

interface CompareState {
  on: boolean;
  offense: EbstType;
  defense: EbstType;
}

const COMPARE_KEY = "divine-pulse-ebst-compare";

/** The comparison switch and choices, remembered in this browser. Never saved to units. */
function useCompare(): [CompareState, (v: CompareState) => void] {
  const [value, setValue] = useState<CompareState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COMPARE_KEY) ?? "null");
      if (saved && typeof saved.on === "boolean" && saved.offense && saved.defense) return saved;
    } catch {
      /* storage unavailable */
    }
    return { on: false, offense: "auto", defense: "auto" };
  });
  const update = (v: CompareState) => {
    setValue(v);
    try {
      localStorage.setItem(COMPARE_KEY, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  };
  return [value, update];
}

// The in-game stat bars fill at roughly this value.
const BAR_MAX = 60;

function valueOf(u: Unit, key: SortKey, mode: Mode, lens: Lens = null): number | string {
  if (key === "name") return u.name.toLowerCase();
  if (key === "ebst") return resultFor(u, mode, lens).ebst;
  return valuesFor(u, mode)[key];
}

interface Props {
  run: RunSummary | null;
  units: Unit[];
  flashKey: string | null;
  /** Show post-timeskip portraits. */
  part2: boolean;
  onGoToRuns: () => void;
  toasts: ToastState;
  /** Units in the battle in progress (game memory only; empty outside a battle). */
  battleKeys: string[];
  /** Show only the units in the battle. */
  battleOnly: boolean;
  onBattleOnly: (on: boolean) => void;
}

export function Dashboard({ run, units, flashKey, part2, onGoToRuns, toasts, battleKeys, battleOnly, onBattleOnly }: Props) {
  const { sort, header: sortHeader } = useSort<SortKey>({ key: "ebst", dir: -1 }, ["name"]);
  const [mode, setMode] = useState<Mode>("displayed");
  const [filter, setFilter] = useState("");
  const nav = useNav();
  const selected = nav.route.id ?? null;
  const setSelected = (key: string, replace = false) => nav.go({ page: "roster", id: key }, { replace });
  const ref = useReference();
  // Affiliation uses the shared people filters (current run is implied here).
  const [people] = usePeopleFilters();
  const [peopleCount, clearPeople] = usePeopleFilterCount(["affiliation"]);
  const houseOf = useMemo(() => new Map(ref?.characters.map((c) => [c.key, c.house] as const) ?? []), [ref]);
  const [nameWidth, setNameWidth] = useState(() => {
    const stored = Number(localStorage.getItem("divine-pulse-roster-name-width"));
    return stored >= 140 && stored <= 420 ? stored : 200;
  });
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const [compare, setCompare] = useCompare();

  // Each unit keeps its own HP/Mv/Dex/Spd/Lck/Cha toggles; only the two types are swapped.
  const lens: Lens = useMemo(() => {
    if (!compare.on) return null;
    return {
      name: `${typeLabel(compare.offense)} / ${typeLabel(compare.defense)}`,
      cfgFor: (u: Unit) => ({ offense: compare.offense, defense: compare.defense, stats: u.ebst_effective.stats }),
    };
  }, [compare.on, compare.offense, compare.defense]);

  // Follow whichever unit was just scanned.
  useEffect(() => {
    if (flashKey) setSelected(flashKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashKey]);
  const show = (key: string) => setSelected(key);

  const battleSet = useMemo(() => new Set(battleKeys), [battleKeys]);

  const sorted = useMemo(() => {
    const list = units.filter((u) => {
      if (battleOnly && !battleSet.has(u.key)) return false;
      if (!searchMatches(filter, u.name, u.full_name, u.class_name)) return false;
      const key = characterKeyOfUnit(u);
      // Units the reference doesn't know (no portrait) only drop out for an affiliation filter.
      if (!key || !houseOf.has(key)) return !people.affiliations.length;
      return passes({ ...people, routes: [] }, { key, house: houseOf.get(key)!, inRun: true }, { ignoreRun: true });
    });
    return list.sort((a, b) => {
      return compareValues(valueOf(a, sort.key, mode, lens), valueOf(b, sort.key, mode, lens)) * sort.dir || a.name.localeCompare(b.name);
    });
  }, [units, sort, mode, filter, lens, people, houseOf, battleOnly, battleSet]);

  // With none picked, the first row's card shows.
  const current = units.find((u) => u.key === selected) ?? sorted[0] ?? null;

  const remove = async (u: Unit) => {
    if (!run || !confirm(`Delete ${u.name} from "${run.name}"?`)) return;
    try {
      await api.deleteUnit(run.id, u.key);
      toasts.push({ kind: "info", title: `Deleted ${u.name}` });
    } catch (e) {
      toasts.push({ kind: "error", title: "Delete failed", body: String((e as Error).message) });
    }
  };

  if (!run) {
    return (
      <section className="roster-page">
        <PageHeader title="Roster" />
        <EmptyState title="No run yet">
          <p>Create a run for your playthrough. Everything read from the game goes into the active run.</p>
          <button className="btn primary" onClick={onGoToRuns}>
            Create a Run
          </button>
        </EmptyState>
      </section>
    );
  }

  const toCheck = units.filter(needsCheck).length;

  const header = (key: SortKey, label: string, note?: string, className = "") =>
    sortHeader(key, key === "name" ? <>{label}<span
      className="name-resize"
      role="separator"
      aria-label="Resize name column"
      aria-orientation="vertical"
      aria-valuenow={nameWidth}
      tabIndex={0}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation();
        resizeStart.current = { x: e.clientX, width: nameWidth };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!resizeStart.current) return;
        setNameWidth(Math.max(140, Math.min(420, resizeStart.current.width + e.clientX - resizeStart.current.x)));
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        const width = resizeStart.current ? Math.max(140, Math.min(420, resizeStart.current.width + e.clientX - resizeStart.current.x)) : nameWidth;
        setNameWidth(width);
        localStorage.setItem("divine-pulse-roster-name-width", String(width));
        resizeStart.current = null;
      }}
      onPointerCancel={() => { resizeStart.current = null; }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.stopPropagation();
        const width = Math.max(140, Math.min(420, nameWidth + (e.key === "ArrowRight" ? 16 : -16)));
        setNameWidth(width);
        localStorage.setItem("divine-pulse-roster-name-width", String(width));
      }}
    /></> : label, key === "name" ? { className } : { className, stat: key, note: note && `${note}.` });

  return (
    <section className="roster-page list-page">
      <PageHeader
        title="Roster"
        status={
          <>
            {battleOnly && <StatusChip tone="live">Showing the {battleSet.size} in battle</StatusChip>}
            {toCheck > 0 && (
              <StatusChip tone="warn" title="Some values couldn't be read or have an unknown bonus. Units marked ! show which.">
                {toCheck} to check
              </StatusChip>
            )}
            {lens && (
              <StatusChip tone="accent" title="eBST is temporarily worked out this way for every unit">
                Comparing as {lens.name}
              </StatusChip>
            )}
          </>
        }
      />
      <MasterDetail
        wide
        detail={
          current && (
            <UnitCard
              unit={current}
              runId={run.id}
              mode={mode}
              lens={lens}
              part2={part2}
              toasts={toasts}
              onDelete={() => remove(current)}
            />
          )
        }
      >
        <div className="toolbar">
          <span className="toolbar-count">{plural(sorted.length, "Unit")}</span>
          <SearchBox placeholder="Search name or class" value={filter} onChange={setFilter} />
          <FilterMenu count={peopleCount} onClear={clearPeople} chips={<PeopleFilterChips fields={["affiliation"]} />}>
            <PeopleFilterFields fields={["affiliation"]} />
          </FilterMenu>
          {battleKeys.length > 0 && (
            <span className="battle-filter" title="Units in the battle in progress, read from game memory">
              <span className="filter-label"><Icon name={CONCEPT_ICON.battle} /><Switch checked={battleOnly} onChange={onBattleOnly} label={`In battle · ${battleKeys.length}`} /></span>
            </span>
          )}
          {units.length > 0 && (
            <span className="battle-filter" title="Give every unit the same offense and defense types, to compare them on equal terms. Units keep their own.">
              <Switch checked={compare.on} onChange={(on) => setCompare({ ...compare, on })} label="Compare as" />
            </span>
          )}
          <span className="toolbar-end">
            <Segmented
              label="Stat values"
              value={mode}
              onChange={setMode}
              options={[
                ["base", "Base", "Bonuses from abilities removed"],
                ["displayed", "On screen", "As shown in game"],
              ]}
            />
          </span>
        </div>

        {lens && (
          <div className="compare-bar on">
            <TypeButtons label="Offense" value={compare.offense} onChange={(offense) => setCompare({ ...compare, on: true, offense })} />
            <TypeButtons label="Defense" value={compare.defense} onChange={(defense) => setCompare({ ...compare, on: true, defense })} />
          </div>
        )}

        {units.length === 0 ? (
          <EmptyState title="No units yet">
            Start FE3H in Eden: your army is read from the game and added here by itself.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="units" style={{ "--name-width": `${nameWidth}px` } as CSSProperties}>
              <thead>
                <tr>
                  {header("name", "Name", undefined, "left")}
                  {NUMERIC_COLS.map((c) =>
                    c.key === "ebst" && lens
                      ? header(c.key, c.label, `${c.label} compared as ${lens.name} for every unit`, "ebst-col comparing")
                      : header(c.key, c.label, c.title, c.key === "ebst" ? "ebst-col" : ""),
                  )}
                </tr>
              </thead>
              <tbody>
                {sorted.map((u) => {
                  const result = resultFor(u, mode, lens);
                  const cfg = cfgFor(u, lens);
                  const suffix = lens ? ` (compared as ${lens.name})` : "";
                  return (
                    <tr
                      key={u.key}
                      className={`${current?.key === u.key ? "selected" : ""} ${flashKey === u.key ? "flash" : ""}`}
                      onClick={() => show(u.key)}
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), show(u.key))}
                      aria-selected={current?.key === u.key}
                    >
                      <td className="left name-cell" title={u.full_name || u.name}>
                        <div className="who">
                          <Portrait unit={u} part2={part2} size={34} />
                          <div className="who-text">
                            <span className="who-name">
                              {u.name}
                              {u.boosted_unexplained.length > 0 && (
                                <span className="badge warn" title="Some values need checking. Open the unit to see which.">
                                  !
                                </span>
                              )}
                            </span>
                            {u.class_name && <span className="who-class">{u.class_name}</span>}
                          </div>
                        </div>
                      </td>
                      {NUMERIC_COLS.map((c) => {
                        if (c.key === "ebst") {
                          return (
                            <td key={c.key} className="num ebst-col" title={describeEbst(cfg) + suffix}>
                              {fmtEbst(result.ebst)}
                            </td>
                          );
                        }
                        const excluded = isValueKey(c.key) && !result.used.has(c.key) ? "excluded" : "";
                        const v = valueOf(u, c.key, mode) as number;
                        const bonus = isValueKey(c.key) ? u.effective_bonuses[c.key] : undefined;
                        const boosted = mode === "displayed" && isValueKey(c.key) && u.blue.includes(c.key);
                        return (
                          <td
                            key={c.key}
                            className={`num ${boosted ? "boosted" : ""} ${excluded}`}
                            title={excluded ? "Not counted in this unit's eBST" : undefined}
                          >
                            {v}
                            {mode === "base" && bonus ? (
                              <span className="mark bonus" title={`+${bonus} from abilities (${u.displayed[c.key as ValueKey]} on screen)`}>
                                +{bonus}
                              </span>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sorted.length === 0 && (
              <NoMatches
                what="units"
                onReset={() => {
                  setFilter("");
                  clearPeople();
                  onBattleOnly(false);
                }}
              />
            )}
          </div>
        )}
      </MasterDetail>

    </section>
  );
}

const needsCheck = (u: Unit) => u.boosted_unexplained.length > 0;

/** A compact version of the in-game Status page for one unit. */
interface CardProps {
  unit: Unit;
  runId: string;
  mode: Mode;
  lens: Lens;
  part2: boolean;
  toasts: ToastState;
  onDelete: () => void;
}

function UnitCard({ unit, runId, mode, lens, part2, toasts, onDelete }: CardProps) {
  const left: StatKey[] = ["str", "mag", "dex", "spd"];
  const right: StatKey[] = ["lck", "def", "res", "cha"];
  const values = valuesFor(unit, mode);
  const cfg = unit.ebst_effective;
  const own = computeEbst(values, cfg);
  const nav = useNav();
  const ref = useReference();

  const setEbst = async (body: Partial<EbstConfig>) => {
    try {
      await api.setUnitEbst(runId, unit.key, body);
    } catch (e) {
      toasts.push({ kind: "error", title: "Couldn't update eBST", body: (e as Error).message });
    }
  };

  const setPortrait = async (gender: PortraitGender) => {
    try {
      await api.setUnitPortrait(runId, unit.key, gender);
    } catch (e) {
      toasts.push({ kind: "error", title: "Couldn't change the portrait", body: (e as Error).message });
    }
  };

  const toggle = (k: OtherKey) => {
    const on = cfg.stats.includes(k);
    setEbst({ stats: on ? cfg.stats.filter((s) => s !== k) : [...cfg.stats, k] });
  };

  const why = (k: ValueKey) => {
    const isOffense = k === "str" || k === "mag";
    const kind = isOffense ? cfg.offense : cfg.defense;
    const pair = isOffense ? "Str/Mag" : "Def/Res";
    const used = own.used.has(k);
    const how = kind === "auto" ? `the higher of ${pair}` : kind === "flex" ? `the average of ${pair}` : typeLabel(kind);
    return `${isOffense ? "Offense" : "Defense"}: ${typeLabel(kind)} (${how}). ${LABELS[k]} is ${used ? "" : "not "}counted in eBST.`;
  };

  const statRow = (k: ValueKey) => {
    const bonus = unit.effective_bonuses[k];
    const v = values[k];
    const used = own.used.has(k);
    return (
      <div className={`stat-row ${used ? "" : "excluded"}`} key={k}>
        {isOther(k) ? (
          <button
            type="button"
            className="stat-label stat-toggle"
            aria-pressed={used}
            onClick={() => toggle(k)}
          >
            <StatTip
              k={k}
              extra={
                used ? `Counted in eBST: click to leave it out.` : `Not counted in eBST: click to include it.`
              }
            >
              {LABELS[k]}
            </StatTip>
          </button>
        ) : (
          <span className="stat-label stat-toggle fixed" data-on={used}>
            <StatTip k={k} extra={why(k)}>
              {LABELS[k]}
            </StatTip>
          </span>
        )}
        {k !== "hp" && k !== "mv" && (
          <span className="stat-bar" aria-hidden>
            <span style={{ width: `${Math.min(100, (Math.max(0, v) / BAR_MAX) * 100)}%` }} />
          </span>
        )}
        <span className={`stat-value ${mode === "displayed" && unit.blue.includes(k) ? "boosted" : ""}`}>
          {v}
          {mode === "base" && bonus ? <span className="mark bonus">+{bonus}</span> : null}
          {unit.boosted_unexplained.includes(k) && (
            <span className="mark unknown" title="Blue in game, but the bonus is unknown.">
              ?
            </span>
          )}
        </span>
      </div>
    );
  };

  const abilityBonus = (name: string) => {
    const n = name.toLowerCase().replace(/\s+/g, "");
    const m = n.match(/^(hp|strength|magic|defense|resistance|speed|dexterity|movement)\+(\d)$/);
    return m ? `+${m[2]}` : null;
  };

  // The accessory is listed with the abilities, so equipment isn't repeated here.
  // Learned but not equipped.
  const equippedAbilities = new Set([unit.personal_ability, ...unit.abilities].map(tidyAbility));
  const learnedAbilities = (unit.learned_abilities ?? []).filter((a) => !equippedAbilities.has(a));
  const learnedArts = (unit.learned_arts ?? []).filter((a) => !unit.combat_arts?.includes(a));
  const carried = (unit.inventory ?? []).filter((it) => it.kind !== "spell");
  const spells = (unit.inventory ?? []).filter((it) => it.kind === "spell");

  const character = ref?.characters.find((ch) => ch.key === characterKeyOfUnit(unit));
  const crests = character?.crests ?? [];
  const icon = useAffiliationIcon(characterKeyOfUnit(unit));
  return (
    <DetailCard
      title={unit.name}
      scope="run"
      icon={icon}
      label={`${unit.name} details`}
      actions={
        <>
          <IconButton icon={CONCEPT_ICON.history} label="Battle Stats" onClick={() => nav.go({ page: "history", tab: "stats", id: unit.key })} />
          <IconButton icon={CONCEPT_ICON.delete} label="Delete" onClick={onDelete} className="danger" />
        </>
      }
    >
      <CharacterHero
        key={unit.key}
        name={unit.name}
        layout="flip"
        scope="run"
        face={<span className="cv-face"><Portrait unit={unit} part2={part2} size={104} /></span>}
        facts={[
          ["Name", <CharLink key="name" charKey={characterKeyOfUnit(unit)} title="Base stats, growths and skills in the Archive">{unit.full_name || unit.name}</CharLink>],
          ["Class", unit.class_name ? <ClassLink key="class" name={unit.class_name} /> : "—"],
          ["Crest", crests.length ? <span className="crest-marks">{crests.map((c) => <span key={`${c.name}-${c.major}`}><CrestLink name={c.name}>{crestLabel(c.name, c.major)}</CrestLink></span>)}</span> : "None"],
        ]}
        backFacts={[
          ["Gender", isByleth(unit) ? (
                <Segmented
                  key="portrait"
                  size="mini"
                  label="Byleth's portrait"
                  value={unit.portrait_gender}
                  onChange={setPortrait}
                  options={[
                    ["auto", "Auto", `Follow the gender read from the Status page${unit.gender ? ` (${unit.gender})` : ""}`],
                    ["male", "Male", "Always the male portrait"],
                    ["female", "Female", "Always the female portrait"],
                  ]}
                />
          ) : unit.gender || character?.gender || "—"],
          ["Affiliation", character?.house || "—"],
          ["Birthday", character?.birthday || "—"],
          ["Height", character?.height || "—"],
        ]}
      />

      <Section
        title="Stats"
        icon={CONCEPT_ICON.growth}
        right={
          <>
            <StatTip k="ebst" extra={`This unit: ${describeEbst(cfg)}.`}>
              <span className="bst-chip">eBST {fmtEbst(own.ebst)}</span>
            </StatTip>
          </>
        }
      >
        <div className="roster-stat-panel">
        {Object.keys(unit.skills ?? {}).length > 0 && (
          <div className="roster-skills" role="group" aria-label="Current skill ranks">
            {(Object.entries(unit.skills ?? {}) as [SkillKey, { rank: string; exp: number }][]).map(([skill, value]) => {
              const aptitude = character?.skills[skill]?.aptitude ?? null;
              const iconAptitude = aptitude === "budding" || aptitude === null ? undefined : aptitude;
              return <span className={`skill-chip roster-skill aptitude-chip ${aptitude ?? ""}`} key={skill} title={`${SKILL_LABEL[skill]}: ${value.rank} · ${value.exp} EXP within this rank${aptitude ? ` · ${aptitude.replace("_", " and ")}` : ""}`}>
                <SkillIcon skill={skill} aptitude={iconAptitude} /> <b>{value.rank}</b>
              </span>;
            })}
          </div>
        )}
        <div className="vitals">
          <div className="vital hp">{statRow("hp")}</div>
          <div className="vital">{statRow("mv")}</div>
        </div>

        <div className="ebst-setup">
          <TypeButtons label="Offense" value={cfg.offense} onChange={(offense) => setEbst({ offense })} />
          <TypeButtons label="Defense" value={cfg.defense} onChange={(defense) => setEbst({ defense })} />
        </div>
        {lens && (
          <p className="compare-note">
            The roster is comparing everyone as <b>{lens.name}</b> (for {unit.name}: eBST {fmtEbst(resultFor(unit, mode, lens).ebst)}).
            This unit's own types below are unchanged.
          </p>
        )}

        <div className="stat-grid">
          <div>{left.map(statRow)}</div>
          <div>{right.map(statRow)}</div>
        </div>
        </div>
      </Section>

      <Section title="Equipment" icon={CONCEPT_ICON.equipment}>
        {carried.length > 0 || unit.accessory ? (
          <ul className="item-list">
            {carried.map((it, i) => (
              <li key={`${it.id}-${i}`}>
                <span>
                  <GearIcon kind={it.kind === "other" ? "item" : it.kind} weapon={it.weapon} name={it.name} /> <ItemLink name={it.name} /> {it.equipped && <span className="equip-mark-wrap" title="Equipped" aria-label="Equipped"><EquipMark /></span>}
                </span>
                <span className="rank">{it.full ? `${it.uses}/${it.full}` : `×${it.uses}`}</span>
              </li>
            ))}
            {unit.accessory && !carried.some((it) => it.name === unit.accessory) && (
              <li className="accessory">
                <span>
                  <ItemIcon name={unit.accessory} />
                  <ItemLink name={unit.accessory}>{unit.accessory}</ItemLink>
                </span>
              </li>
            )}
          </ul>
        ) : (
          <p className="muted">No equipment</p>
        )}
      </Section>

      <Section title="Spells" icon={CONCEPT_ICON.spell}>
        {spells.length > 0 ? (
          <ul className="item-list">
            {spells.map((it, i) => (
              <li key={`${it.id}-${i}`}>
                <span>
                  <GearIcon kind="spell" weapon={it.weapon} name={it.name} /> <SpellLink name={it.name} />
                </span>
                <span className="rank">{it.full ? `${it.uses}/${it.full}` : it.uses}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No spells</p>
        )}
      </Section>

      <Section title="Combat Arts" icon={CONCEPT_ICON.art}>
        {(unit.combat_arts?.length ?? 0) + learnedArts.length === 0 && <p className="muted">No combat arts</p>}
        {!!unit.combat_arts?.length && (
          <ul className="item-list">
            {unit.combat_arts.map((a) => (
              <li key={a}>
                <span>
                  <ArtIcon name={a} />
                  <ArtLink name={a} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {learnedArts.length > 0 && (
          <>
            <h4 className="sub-title">Learned</h4>
            <ul className="item-list">
              {learnedArts.map((a) => (
                <li key={a}>
                  <span>
                    <ArtIcon name={a} />
                    <ArtLink name={a} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="Abilities" icon={CONCEPT_ICON.ability}>
        {![unit.personal_ability, ...unit.abilities].some(Boolean) && learnedAbilities.length === 0 && <p className="muted">No abilities</p>}
        <ul className="item-list">
          {[unit.personal_ability, ...unit.abilities].filter(Boolean).map((a, i) => (
            <li key={`${a}-${i}`} className={i === 0 && unit.personal_ability ? "personal" : ""}>
              <span>
                <AbilityIcon name={tidyAbility(a)} />
                <AbilityLink name={tidyAbility(a)} />
              </span>
              {abilityBonus(a) && <span className="mark bonus">{abilityBonus(a)}</span>}
            </li>
          ))}
        </ul>
        {learnedAbilities.length > 0 && (
          <>
            <h4 className="sub-title">Learned</h4>
            <ul className="item-list">
              {learnedAbilities.map((a) => (
                <li key={a}>
                  <span>
                    <AbilityIcon name={a} />
                    <AbilityLink name={a} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="Battalion" icon={CONCEPT_ICON.battalion} summary={unit.battalion || (unit.battalion === "" ? "No battalion" : "Not read yet")}>
        <BattalionPanel unit={unit} scope="run" />
      </Section>

      {unit.boosted_unexplained.length > 0 && (
        <p className="notice">
          Some blue stats have an unknown bonus.{" "}
          The game has not supplied these values yet.
        </p>
      )}

      <p className="muted small">
        Updated {new Date(unit.updated_at).toLocaleString()}
      </p>
    </DetailCard>
  );
}
