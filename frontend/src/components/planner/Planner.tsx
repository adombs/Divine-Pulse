/**
 * The Roster's Planner: a window, per unit, for where the player is taking it (classes, skill ranks, combat arts,
 * abilities, equipment, battalion) and notes. Every change saves on its own, a moment after the last one.
 */
import "./planner.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, EMPTY_PLAN, type Unit, type UnitPlan } from "../../api";
import { CONCEPT_ICON } from "../../icons/concepts";
import { useNav } from "../../nav";
import { linkRoute, rankIndex, reaches, targetsForClasses, type ArchiveEntry, type LinkKind } from "../../planner";
import { characterKeyOfUnit } from "../../portraits";
import { SKILL_KEYS, SKILL_LABEL, type ReferenceData, type SkillKey } from "../../reference/types";
import { WEAPON_RANKS } from "../../reference/weaponRanks";
import { tidyAbility } from "../../appearance";
import { RefLink, SubTabs } from "../common";
import { Icon, IconButton, type IconName } from "../Icon";
import { Modal } from "../Modal";
import { SkillIcon } from "../SkillIcon";
import type { ToastState } from "../Toasts";
import { EntryIcon, EntryPicker, useArchiveEntries } from "./entries";
import { NotesEditor } from "./NotesEditor";

const SAVE_MS = 600;

export const planIsEmpty = (p: UnitPlan | undefined) =>
  !p || (!p.classes.length && !Object.keys(p.skills).length && !p.arts.length && !p.abilities.length && !p.equipment.length && !p.battalion && !p.notes.trim());

/** The roster card's Planner button, and the window it opens. */
export function PlannerButton({ unit, runId, toasts }: { unit: Unit; runId: string; toasts: ToastState }) {
  const [open, setOpen] = useState(false);
  const planned = !planIsEmpty(unit.plan);
  return (
    <>
      <IconButton
        icon={CONCEPT_ICON.plan}
        label={planned ? "Planner (has a plan)" : "Planner"}
        onClick={() => setOpen(true)}
        className={planned ? "has-plan" : undefined}
      />
      <Modal open={open} onClose={() => setOpen(false)} title={`${unit.name}’s Plan`} ariaLabel={`${unit.name} planner`} className="planner">
        {open && <PlannerBody key={`${runId}:${unit.key}`} unit={unit} runId={runId} toasts={toasts} />}
      </Modal>
    </>
  );
}

type Tab = "build" | "notes";
const TAB_KEY = "divine-pulse-planner-tab";

function PlannerBody({ unit, runId, toasts }: { unit: Unit; runId: string; toasts: ToastState }) {
  const { ref, entries } = useArchiveEntries();
  const [plan, setPlan] = useState<UnitPlan>(() => ({ ...EMPTY_PLAN, ...unit.plan }));
  const [tab, setTabState] = useState<Tab>(() => {
    try { return localStorage.getItem(TAB_KEY) === "notes" ? "notes" : "build"; } catch { return "build"; }
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* the tab just isn't remembered */ }
  };
  const save = useSaver(runId, unit.key, toasts);
  const update = useCallback((change: Partial<UnitPlan>) => setPlan((p) => {
    const next = { ...p, ...change };
    save.queue(next);
    return next;
  }), [save]);

  const byKind = useMemo(() => {
    const m = new Map<LinkKind, ArchiveEntry[]>();
    for (const e of entries) m.set(e.kind, [...(m.get(e.kind) ?? []), e]);
    return m;
  }, [entries]);
  const kinds = (...k: LinkKind[]) => k.flatMap((x) => byKind.get(x) ?? []);

  const learnedArts = new Set([...(unit.combat_arts ?? []), ...(unit.learned_arts ?? [])]);
  const learnedAbilities = new Set([unit.personal_ability, ...unit.abilities, ...(unit.learned_abilities ?? [])].map(tidyAbility));
  const carried = new Set([...(unit.inventory ?? []).map((i) => i.name), ...(unit.accessory ? [unit.accessory] : [])]);

  return (
    <div className="planner-body">
      <div className="planner-tabs">
        <SubTabs<Tab> value={tab} onChange={setTab} label="Planner" options={[["build", "Build"], ["notes", "Notes"]]} />
        <SaveState state={save.state} />
      </div>
      {tab === "build" ? (
        <div className="planner-grid">
          <div className="planner-col">
            <ClassTargets unit={unit} plan={plan} update={update} entries={byKind.get("class") ?? []} data={ref} />
            <SkillTargets unit={unit} plan={plan} update={update} data={ref} />
            <MagicByRank unit={unit} plan={plan} data={ref} />
          </div>
          <div className="planner-col">
            <EntryList title="Combat Arts" icon={CONCEPT_ICON.art} kind="art" values={plan.arts} onChange={(arts) => update({ arts })}
              entries={kinds("art")} add="Add combat art" have={learnedArts} haveLabel="Learned" data={ref} />
            <EntryList title="Abilities" icon={CONCEPT_ICON.ability} kind="ability" values={plan.abilities} onChange={(abilities) => update({ abilities })}
              entries={kinds("ability")} add="Add ability" have={learnedAbilities} haveLabel="Learned" data={ref} />
            <EntryList title="Equipment" icon={CONCEPT_ICON.equipment} kind="item" values={plan.equipment} onChange={(equipment) => update({ equipment })}
              entries={kinds("weapon", "item", "spell")} add="Add weapon or item" have={carried} haveLabel="Carried" data={ref} />
            <EntryList title="Battalion" icon={CONCEPT_ICON.battalion} kind="battalion" values={plan.battalion ? [plan.battalion] : []} single
              onChange={([battalion = ""]) => update({ battalion })} entries={kinds("battalion")} add={plan.battalion ? "Change battalion" : "Choose battalion"}
              have={new Set(unit.battalion ? [unit.battalion] : [])} haveLabel="Current" data={ref}
              none={!ref?.battalions?.length ? "Import your game files to choose a battalion." : undefined} />
          </div>
        </div>
      ) : (
        <NotesEditor value={plan.notes} onChange={(notes) => update({ notes })} entries={entries} data={ref} label={`Notes on ${unit.name}`} />
      )}
    </div>
  );
}

/** Saves the latest plan a moment after the last change, and right away when the window closes. */
function useSaver(runId: string, key: string, toasts: ToastState) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const pending = useRef<UnitPlan | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const plan = pending.current;
    if (!plan) return;
    pending.current = null;
    setState("saving");
    api.setUnitPlan(runId, key, plan).then(
      () => setState((s) => (pending.current ? s : "saved")),
      (e: Error) => {
        setState("error");
        toasts.push({ kind: "error", title: "Couldn't save the plan", body: e.message });
      },
    );
  }, [runId, key, toasts]);
  const queue = useCallback((plan: UnitPlan) => {
    pending.current = plan;
    setState("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_MS);
  }, [flush]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
  return useMemo(() => ({ state, queue }), [state, queue]);
}

function SaveState({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  return (
    <span className={`plan-save ${state}`} role="status">
      {state === "saving" ? "Saving…" : state === "saved" ? <><Icon name={CONCEPT_ICON.done} /> Saved</> : <><Icon name={CONCEPT_ICON.warning} /> Not saved</>}
    </span>
  );
}

function Head({ icon, children, count, right }: { icon: IconName; children: ReactNode; count?: number; right?: ReactNode }) {
  return (
    <div className="plan-head">
      <h3><Icon name={icon} /> {children}{!!count && <span className="plan-count">{count}</span>}</h3>
      {right}
    </div>
  );
}

function EntryLink({ kind, id, children }: { kind: LinkKind; id: string; children: ReactNode }) {
  const nav = useNav();
  return <RefLink onClick={() => nav.go(linkRoute({ kind, id }))} title="Open in the Archive">{children}</RefLink>;
}

function Remove({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-btn plan-remove" aria-label={`Remove ${name}`} title="Remove" onClick={onClick}>
      <Icon name={CONCEPT_ICON.close} />
    </button>
  );
}

function Have({ label }: { label: string }) {
  return <span className="plan-have" title={label}><Icon name={CONCEPT_ICON.done} weight="duotone" /> {label}</span>;
}

/** A list of entries of one kind (or one, `single`), each removable, with a box to add more. */
function EntryList({
  title, icon, kind, values, onChange, entries, add, have, haveLabel, single, data, none,
}: {
  title: string;
  icon: IconName;
  kind: LinkKind;
  values: string[];
  onChange: (v: string[]) => void;
  entries: ArchiveEntry[];
  add: string;
  have: Set<string>;
  haveLabel: string;
  single?: boolean;
  data: ReferenceData | null;
  none?: string;
}) {
  const kindOf = (name: string) => entries.find((e) => e.id === name)?.kind ?? kind;
  return (
    <section className="plan-block">
      <Head icon={icon} count={single ? undefined : values.length}>{title}</Head>
      {values.length > 0 && (
        <ul className="item-list plan-list">
          {values.map((v) => (
            <li key={v}>
              <span className="plan-entry">
                <EntryIcon entry={{ kind: kindOf(v), id: v }} data={data} />
                <EntryLink kind={kindOf(v)} id={v}>{v}</EntryLink>
              </span>
              <span className="plan-row-end">
                {have.has(v) && <Have label={haveLabel} />}
                <Remove name={v} onClick={() => onChange(values.filter((x) => x !== v))} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {none ? <p className="muted plan-none">{none}</p> : (
        <EntryPicker entries={entries} placeholder={add} exclude={values} onPick={(e) => onChange(single ? [e.id] : [...values, e.id])} />
      )}
    </section>
  );
}

function ClassTargets({ unit, plan, update, entries, data }: { unit: Unit; plan: UnitPlan; update: (c: Partial<UnitPlan>) => void; entries: ArchiveEntry[]; data: ReferenceData | null }) {
  const mastered = new Set(unit.mastered_classes ?? []);
  return (
    <section className="plan-block">
      <Head icon={CONCEPT_ICON.classes} count={plan.classes.length}>Classes</Head>
      {plan.classes.length > 0 && (
        <ul className="item-list plan-list">
          {plan.classes.map((name) => {
            const c = data?.classes.find((x) => x.name === name);
            return (
              <li key={name}>
                <span className="plan-entry">
                  <EntryIcon entry={{ kind: "class", id: name }} data={data} />
                  <EntryLink kind="class" id={name}>{name}</EntryLink>
                </span>
                <span className="plan-row-end">
                  {mastered.has(name) ? <span className="plan-have" title="Mastered"><Icon name={CONCEPT_ICON.mastery} /> Mastered</span> : c && c.requirements.length > 0 && (
                    <span className="plan-reqs" title={c.requirement_any ? "Needs any one of these" : "Needs these ranks"}>
                      {c.requirements.map((r, i) => {
                        const met = reaches(unit.skills?.[r.skill]?.rank, r.rank);
                        return (
                          <span key={r.skill} className={`plan-req${met ? " met" : ""}`} title={`${SKILL_LABEL[r.skill]} ${r.rank}${met ? " (reached)" : ""}`}>
                            {i > 0 && c.requirement_any && <span className="plan-or">or</span>}
                            <SkillIcon skill={r.skill} title={`${SKILL_LABEL[r.skill]} ${r.rank}`} />{r.rank}
                          </span>
                        );
                      })}
                    </span>
                  )}
                  <Remove name={name} onClick={() => update({ classes: plan.classes.filter((x) => x !== name) })} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <EntryPicker entries={entries} placeholder="Add class" exclude={plan.classes} onPick={(e) => update({ classes: [...plan.classes, e.id] })} />
    </section>
  );
}

function SkillTargets({ unit, plan, update, data }: { unit: Unit; plan: UnitPlan; update: (c: Partial<UnitPlan>) => void; data: ReferenceData | null }) {
  const character = data?.characters.find((ch) => ch.key === characterKeyOfUnit(unit));
  const classes = plan.classes.map((n) => data?.classes.find((c) => c.name === n)).filter((c): c is NonNullable<typeof c> => !!c);
  const fromClasses = targetsForClasses<SkillKey>(plan.skills as Partial<Record<SkillKey, string>>, classes);
  const canFill = SKILL_KEYS.some((k) => fromClasses[k] !== plan.skills[k]);
  const setRank = (skill: SkillKey, rank: string | null) => {
    const skills = { ...plan.skills };
    if (rank) skills[skill] = rank; else delete skills[skill];
    update({ skills });
  };
  // A new target starts at what the planned classes need, else one rank above the current one.
  const firstTarget = (k: SkillKey) => {
    const now = rankIndex(unit.skills?.[k]?.rank);
    const needed = rankIndex(targetsForClasses<SkillKey>({}, classes)[k]);
    return WEAPON_RANKS[Math.min(WEAPON_RANKS.length - 1, needed > now ? needed : now + 1)];
  };
  const added = SKILL_KEYS.filter((k) => plan.skills[k]);
  const left = SKILL_KEYS.filter((k) => !plan.skills[k]);
  const done = added.filter((k) => reaches(unit.skills?.[k]?.rank, plan.skills[k]!)).length;
  return (
    <section className="plan-block">
      <Head
        icon={CONCEPT_ICON.growth}
        right={canFill && (
          <button type="button" className="btn small" onClick={() => update({ skills: fromClasses })} title="Add the ranks the planned classes need">
            Match classes
          </button>
        )}
      >
        Skill Ranks{added.length > 0 && <span className="plan-progress" title="Reached">{done}/{added.length}</span>}
      </Head>
      {added.length > 0 && (
        <ul className="item-list plan-list plan-skills">
          {added.map((k) => {
            const now = unit.skills?.[k]?.rank;
            const target = plan.skills[k]!;
            const aptitude = character?.skills[k]?.aptitude ?? null;
            const met = reaches(now, target);
            return (
              <li key={k} className={met ? "met" : ""}>
                <span className="plan-entry plan-skill">
                  <SkillIcon skill={k} aptitude={aptitude === "budding" || aptitude === null ? undefined : aptitude} />
                  <span className="plan-skill-name">{SKILL_LABEL[k]}</span>
                </span>
                <span className="plan-row-end">
                  <span className="plan-skill-now" title="Current rank">{now ?? "—"}</span>
                  <Icon name={CONCEPT_ICON.go} className="plan-skill-arrow" />
                  <select value={target} onChange={(e) => setRank(k, e.target.value)} aria-label={`${SKILL_LABEL[k]} target rank`}>
                    {WEAPON_RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <span className="plan-skill-met">{met && <Icon name={CONCEPT_ICON.done} title="Reached" />}</span>
                  <Remove name={SKILL_LABEL[k]} onClick={() => setRank(k, null)} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {left.length > 0 && (
        <label className="entry-picker plan-add-skill">
          <Icon name={CONCEPT_ICON.add} className="entry-picker-icon" />
          <select value="" aria-label="Add skill" onChange={(e) => e.target.value && setRank(e.target.value as SkillKey, firstTarget(e.target.value as SkillKey))}>
            <option value="">Add skill</option>
            {left.map((k) => <option key={k} value={k}>{SKILL_LABEL[k]}{unit.skills?.[k] ? ` (${unit.skills[k]!.rank})` : ""}</option>)}
          </select>
        </label>
      )}
    </section>
  );
}

/** The spells the unit learns in Reason and Faith, by rank: learned ones checked, ones its target reaches marked. */
function MagicByRank({ unit, plan, data }: { unit: Unit; plan: UnitPlan; data: ReferenceData | null }) {
  const character = data?.characters.find((ch) => ch.key === characterKeyOfUnit(unit));
  if (!character) return null;
  const schools = (["reason", "faith"] as const).filter((k) => character.spells[k].length > 0);
  return (
    <section className="plan-block">
      <Head icon={CONCEPT_ICON.spell}>Magic</Head>
      {schools.length === 0 ? <p className="muted plan-none">Learns no spells.</p> : (
        <div className="plan-magic">
          {schools.map((k) => (
            <div key={k} className="plan-school">
              <h4><SkillIcon skill={k} /> {SKILL_LABEL[k]}</h4>
              <ul>
                {character.spells[k].map((sp) => {
                  const learned = reaches(unit.skills?.[k]?.rank, sp.rank);
                  const planned = !learned && !!plan.skills[k] && reaches(plan.skills[k], sp.rank);
                  return (
                    <li key={sp.name} className={learned ? "learned" : planned ? "planned" : ""}
                      title={learned ? "Learned" : planned ? "Reached by the target rank" : undefined}>
                      <span className="plan-spell-rank">{sp.rank}</span>
                      <span className="plan-entry">
                        <EntryIcon entry={{ kind: "spell", id: sp.name }} data={data} />
                        <EntryLink kind="spell" id={sp.name}>{sp.name}</EntryLink>
                      </span>
                      <span className="plan-skill-met">{learned && <Icon name={CONCEPT_ICON.done} />}{planned && <Icon name={CONCEPT_ICON.target} />}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
