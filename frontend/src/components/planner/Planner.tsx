/**
 * The Roster's Planner: a window, per unit, for where the player is taking it (classes, skill ranks, combat arts,
 * abilities, equipment, battalion, supports) and notes, all on one page. Every change saves on its own, a moment
 * after the last one. Lists the player fills in can be dragged into any order.
 */
import "./planner.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, EMPTY_PLAN, PLAN_MAX, type PlanSupportRank, type Unit, type UnitPlan } from "../../api";
import { CONCEPT_ICON } from "../../icons/concepts";
import { useNav } from "../../nav";
import { linkRoute, rankIndex, reaches, targetsForClasses, type ArchiveEntry, type LinkKind } from "../../planner";
import { characterKeyOfUnit } from "../../portraits";
import { SKILL_KEYS, SKILL_LABEL, type Aptitude, type Character, type ReferenceData, type SkillKey } from "../../reference/types";
import { WEAPON_RANKS } from "../../reference/weaponRanks";
import { useSupports, type SupportPair } from "../../reference/supports";
import { visibleRanks } from "../reference/supports/shared";
import { tidyAbility } from "../../appearance";
import { RefLink } from "../common";
import { Icon, IconButton, type IconName } from "../Icon";
import { Modal } from "../Modal";
import { SkillIcon } from "../SkillIcon";
import { RankIcon, RankPicker } from "../RankIcon";
import type { ToastState } from "../Toasts";
import { EntryIcon, EntryPicker, useArchiveEntries } from "./entries";
import { NotesEditor } from "./NotesEditor";

const SAVE_MS = 600;
type SaveStatus = "idle" | "saving" | "saved" | "error";
type Update = (change: Partial<UnitPlan>) => void;

export const planIsEmpty = (p: UnitPlan | undefined) =>
  !p || (!p.classes.length && !Object.keys(p.skills).length && !p.arts.length && !p.abilities.length && !p.equipment.length
    && !p.battalion && !(p.supports ?? []).length && !p.notes.trim());

/** The roster card's Planner button, and the window it opens. */
export function PlannerButton({ unit, runId, toasts }: { unit: Unit; runId: string; toasts: ToastState }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const reset = useRef<() => void>(() => {});
  // The last plan this window saved, so reopening shows it even before the roster has reloaded.
  const latest = useRef<{ key: string; plan: UnitPlan } | null>(null);
  const known = latest.current?.key === unit.key ? latest.current.plan : unit.plan;
  const planned = !planIsEmpty(known);
  return (
    <>
      <IconButton
        icon={CONCEPT_ICON.plan}
        label={planned ? "Planner (has a plan)" : "Planner"}
        onClick={() => { setStatus("idle"); setOpen(true); }}
        className={planned ? "has-plan" : undefined}
      />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${unit.name}’s Plan`}
        ariaLabel={`${unit.name} planner`}
        className="planner"
        actions={<>
          <SaveState state={status} />
          <IconButton icon={CONCEPT_ICON.reset} label="Reset to current" onClick={() => setConfirm(true)} className="plan-reset" />
        </>}
      >
        {open && <PlannerBody key={`${runId}:${unit.key}`} unit={unit} initial={known} runId={runId} toasts={toasts} onStatus={setStatus} resetRef={reset}
          onSaved={(plan) => { latest.current = { key: unit.key, plan }; }} />}
      </Modal>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Reset plan?" className="planner-confirm">
        <p>Replace {unit.name}’s plan with what they have now? Notes are kept.</p>
        <div className="planner-confirm-actions">
          <button type="button" className="btn" onClick={() => setConfirm(false)}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => { reset.current(); setConfirm(false); }}>Reset</button>
        </div>
      </Modal>
    </>
  );
}

/** What the unit has now: its class, equipped combat arts and abilities, equipped gear and battalion. A new plan
 * starts from it, and Reset returns to it. */
export function currentKit(unit: Unit): UnitPlan {
  const equipped = (unit.inventory ?? []).filter((i) => i.equipped && i.kind !== "spell").map((i) => i.name);
  return {
    ...EMPTY_PLAN,
    classes: unit.class_name ? [unit.class_name] : [],
    arts: [...new Set(unit.combat_arts ?? [])].slice(0, PLAN_MAX.arts),
    abilities: [...new Set(unit.abilities.map(tidyAbility).filter(Boolean))].slice(0, PLAN_MAX.abilities),
    equipment: [...new Set([...equipped, ...(unit.accessory ? [unit.accessory] : [])])].slice(0, PLAN_MAX.equipment),
    battalion: unit.battalion ?? "",
  };
}

function PlannerBody({ unit, initial, runId, toasts, onStatus, resetRef, onSaved }: {
  unit: Unit; initial: UnitPlan | undefined; runId: string; toasts: ToastState; onStatus: (s: SaveStatus) => void;
  resetRef: React.MutableRefObject<() => void>; onSaved: (plan: UnitPlan) => void;
}) {
  const { ref, entries } = useArchiveEntries();
  const [plan, setPlan] = useState<UnitPlan>(() => (planIsEmpty(initial) ? currentKit(unit) : { ...EMPTY_PLAN, ...initial }));
  const save = useSaver(runId, unit.key, toasts, onSaved);
  useEffect(() => onStatus(save.state), [save.state, onStatus]);
  const update = useCallback<Update>((change) => setPlan((p) => {
    const next = { ...p, ...change };
    save.queue(next);
    return next;
  }), [save]);
  resetRef.current = () => setPlan((p) => {
    const next = { ...currentKit(unit), notes: p.notes };
    save.queue(next);
    return next;
  });

  const byKind = useMemo(() => {
    const m = new Map<LinkKind, ArchiveEntry[]>();
    for (const e of entries) m.set(e.kind, [...(m.get(e.kind) ?? []), e]);
    return m;
  }, [entries]);
  const kinds = (...k: LinkKind[]) => k.flatMap((x) => byKind.get(x) ?? []);
  const character = ref?.characters.find((ch) => ch.key === characterKeyOfUnit(unit));

  const learnedArts = new Set([...(unit.combat_arts ?? []), ...(unit.learned_arts ?? [])]);
  const learnedAbilities = new Set([unit.personal_ability, ...unit.abilities, ...(unit.learned_abilities ?? [])].map(tidyAbility));
  const carried = new Set([...(unit.inventory ?? []).map((i) => i.name), ...(unit.accessory ? [unit.accessory] : [])]);
  const suggestArts = useMemo(() => obtainable("arts", unit, plan, ref, character, byKind.get("art") ?? []), [unit, plan, ref, character, byKind]);
  const suggestAbilities = useMemo(() => obtainable("abilities", unit, plan, ref, character, byKind.get("ability") ?? []), [unit, plan, ref, character, byKind]);

  return (
    <div className="planner-body">
      <div className="planner-grid">
        <div className="planner-col">
          <ClassTargets unit={unit} plan={plan} update={update} entries={byKind.get("class") ?? []} data={ref} />
          <SkillTargets unit={unit} plan={plan} update={update} data={ref} character={character} />
        </div>
        <div className="planner-col">
          <EntryList title="Abilities" icon={CONCEPT_ICON.ability} kind="ability" values={plan.abilities} onChange={(abilities) => update({ abilities })} max={PLAN_MAX.abilities}
            entries={kinds("ability")} suggested={suggestAbilities} add="Empty slot" have={learnedAbilities} haveLabel="Learned" data={ref} />
          <EntryList title="Battalion" icon={CONCEPT_ICON.battalion} kind="battalion" values={plan.battalion ? [plan.battalion] : []} max={1}
            onChange={([battalion = ""]) => update({ battalion })} entries={kinds("battalion")} add="Empty slot"
            have={new Set(unit.battalion ? [unit.battalion] : [])} haveLabel="Current" data={ref}
            none={!ref?.battalions?.length ? "Import your game files to choose one." : undefined} />
          <MagicByRank unit={unit} plan={plan} data={ref} character={character} />
        </div>
        <div className="planner-col">
          <EntryList title="Equipment" icon={CONCEPT_ICON.equipment} kind="item" values={plan.equipment} onChange={(equipment) => update({ equipment })} max={PLAN_MAX.equipment}
            entries={kinds("weapon", "item", "spell")} add="Empty slot" have={carried} haveLabel="Carried" data={ref} />
          <EntryList title="Combat Arts" icon={CONCEPT_ICON.art} kind="art" values={plan.arts} onChange={(arts) => update({ arts })} max={PLAN_MAX.arts}
            entries={kinds("art")} suggested={suggestArts} add="Empty slot" have={learnedArts} haveLabel="Learned" data={ref} />
          <SupportTargets unit={unit} plan={plan} update={update} entries={byKind.get("unit") ?? []} character={character} />
        </div>
      </div>
      <section className="plan-block plan-notes">
        <Head icon={CONCEPT_ICON.notes}>Notes</Head>
        <NotesEditor value={plan.notes} onChange={(notes) => update({ notes })} entries={entries} data={ref} label={`Notes on ${unit.name}`} />
      </section>
    </div>
  );
}

const GENERIC_RANKS = ["E+", "D+", "C+", "B+", "A+"];
const GENERIC_ABILITY: Partial<Record<SkillKey, string>> = {
  sword: "Sword Prowess", lance: "Lance Prowess", axe: "Axe Prowess", bow: "Bow Prowess", brawling: "Brawling Prowess",
  reason: "Reason", faith: "Faith", authority: "Authority",
};

/** Combat arts or abilities the plan puts within reach: the unit's own at its current or target ranks, the planned
 * classes' abilities and mastery rewards, and what it has already learned. Each with where it comes from. */
function obtainable(
  what: "arts" | "abilities", unit: Unit, plan: UnitPlan, data: ReferenceData | null, character: Character | undefined, entries: ArchiveEntry[],
): { entry: ArchiveEntry; note: string }[] {
  const byId = new Map(entries.map((e) => [e.id, e] as const));
  const out = new Map<string, string>();
  const add = (name: string, note: string) => { const id = tidyAbility(name); if (byId.has(id) && !out.has(id)) out.set(id, note); };
  for (const name of what === "arts" ? [...(unit.combat_arts ?? []), ...(unit.learned_arts ?? [])] : [...unit.abilities, ...(unit.learned_abilities ?? [])]) add(name, "Learned");
  for (const r of what === "arts" ? character?.arts ?? [] : character?.abilities ?? []) {
    const skill = r.skill || null;
    if (!skill) { add(r.name, r.rank); continue; }
    const best = [unit.skills?.[skill]?.rank, plan.skills[skill]].reduce<string | undefined>((a, b) => (rankIndex(b) > rankIndex(a) ? b ?? a : a), undefined);
    if (reaches(best, r.rank)) add(r.name, `${SKILL_LABEL[skill]} ${r.rank}`);
  }
  // Every unit's own skill-rank abilities: Lv 1 to 5 at E+, D+, C+, B+ and A+.
  if (what === "abilities") {
    for (const skill of SKILL_KEYS) {
      const label = GENERIC_ABILITY[skill];
      if (!label) continue;
      const best = [unit.skills?.[skill]?.rank, plan.skills[skill]].reduce<string | undefined>((a, b) => (rankIndex(b) > rankIndex(a) ? b ?? a : a), undefined);
      GENERIC_RANKS.forEach((rank, i) => { if (reaches(best, rank)) add(`${label} Lv ${i + 1}`, `${SKILL_LABEL[skill]} ${rank}`); });
    }
  }
  for (const name of plan.classes) {
    const c = data?.classes.find((x) => x.name === name);
    if (!c) continue;
    if (what === "arts") { if (c.mastery_art) add(c.mastery_art, `${c.name} mastery`); continue; }
    if (c.mastery_ability) add(c.mastery_ability, `${c.name} mastery`);
    for (const a of c.abilities) add(a, c.name);
  }
  return [...out].map(([id, note]) => ({ entry: byId.get(id)!, note }));
}

/** Saves the latest plan a moment after the last change, and right away when the window closes. */
function useSaver(runId: string, key: string, toasts: ToastState, onSaved: (plan: UnitPlan) => void) {
  const [state, setState] = useState<SaveStatus>("idle");
  const pending = useRef<UnitPlan | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const plan = pending.current;
    if (!plan) return;
    pending.current = null;
    setState("saving");
    api.setUnitPlan(runId, key, plan).then(
      () => { onSaved(plan); setState((s) => (pending.current ? s : "saved")); },
      (e: Error) => {
        setState("error");
        toasts.push({ kind: "error", title: "Couldn't save the plan", body: e.message });
      },
    );
  }, [runId, key, toasts]); // eslint-disable-line react-hooks/exhaustive-deps
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

function SaveState({ state }: { state: SaveStatus }) {
  if (state === "idle") return null;
  return (
    <span className={`plan-save ${state}`} role="status">
      {state === "saving" ? "Saving…" : state === "saved" ? <><Icon name={CONCEPT_ICON.done} /> Saved</> : <><Icon name={CONCEPT_ICON.warning} /> Not saved</>}
    </span>
  );
}

function Head({ icon, children, count, max, right }: { icon: IconName; children: ReactNode; count?: number; max?: number; right?: ReactNode }) {
  return (
    <div className="plan-head">
      <h3><Icon name={icon} /> {children}{max && max > 1 ? <span className="plan-count">{count ?? 0}/{max}</span> : !!count && <span className="plan-count">{count}</span>}</h3>
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
  return <span className="plan-have" title={label}><Icon name={CONCEPT_ICON.done} /> {label}</span>;
}

/** Rows that drag into a new order by their handle (or move with the arrow keys on it). */
function SortableList({ ids, onReorder, label, rowClass, render, className }: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  label: (id: string) => string;
  rowClass?: (id: string) => string;
  render: (id: string) => ReactNode;
  className?: string;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const move = (from: number, to: number, focus = false) => {
    if (to < 0 || to >= ids.length || from === to) return;
    const next = [...ids];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onReorder(next);
    if (focus) requestAnimationFrame(() => list.current?.querySelectorAll<HTMLElement>(".plan-drag")[to]?.focus());
  };
  const end = () => { setDrag(null); setOver(null); setArmed(false); };
  const sortable = ids.length > 1;
  return (
    <ul ref={list} className={`item-list plan-list${className ? ` ${className}` : ""}`}>
      {ids.map((id, i) => (
        <li
          key={id}
          className={`${rowClass?.(id) ?? ""}${drag === i ? " dragging" : ""}${over === i && drag !== null && drag !== i ? (drag < i ? " drop-after" : " drop-before") : ""}`}
          draggable={sortable && armed}
          onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); }}
          onDragOver={(e) => { if (drag === null) return; e.preventDefault(); setOver(i); }}
          onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); end(); }}
          onDragEnd={end}
        >
          {sortable && (
            <button
              type="button"
              className="plan-drag"
              aria-label={`Move ${label(id)}`}
              title="Drag to reorder"
              onMouseDown={() => setArmed(true)}
              onMouseUp={() => setArmed(false)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();
                move(i, i + (e.key === "ArrowUp" ? -1 : 1), true);
              }}
            >
              <Icon name={CONCEPT_ICON.drag} />
            </button>
          )}
          {render(id)}
        </li>
      ))}
    </ul>
  );
}

/** A list of entries of one kind, each removable and in the player's order, with a box to add more until `max`. */
function EntryList({
  title, icon, kind, values, onChange, entries, suggested, add, have, haveLabel, max, data, none,
}: {
  title: string;
  icon: IconName;
  kind: LinkKind;
  values: string[];
  onChange: (v: string[]) => void;
  entries: ArchiveEntry[];
  suggested?: { entry: ArchiveEntry; note: string }[];
  add: string;
  have: Set<string>;
  haveLabel: string;
  max?: number;
  data: ReferenceData | null;
  none?: string;
}) {
  const kindOf = (name: string) => entries.find((e) => e.id === name)?.kind ?? kind;
  const full = max !== undefined && values.length >= max;
  return (
    <section className="plan-block">
      <Head icon={icon} count={values.length} max={max}>{title}</Head>
      {values.length > 0 && (
        <SortableList
          ids={values}
          onReorder={onChange}
          label={(v) => v}
          render={(v) => <>
            <span className="plan-entry">
              <EntryIcon entry={{ kind: kindOf(v), id: v }} data={data} />
              <EntryLink kind={kindOf(v)} id={v}>{v}</EntryLink>
            </span>
            <span className="plan-row-end">
              {have.has(v) && <Have label={haveLabel} />}
              <Remove name={v} onClick={() => onChange(values.filter((x) => x !== v))} />
            </span>
          </>}
        />
      )}
      {none && !values.length ? <p className="muted plan-none">{none}</p> : max !== undefined ? (
        // Fixed slots, like the game's: each empty one is a box to fill.
        !full && (
          <div className="plan-slots">
            {Array.from({ length: max - values.length }, (_, i) => (
              <EntryPicker key={values.length + i} entries={entries} suggested={suggested} placeholder={add} exclude={values} onPick={(e) => onChange([...values, e.id])} />
            ))}
          </div>
        )
      ) : (
        <EntryPicker entries={entries} suggested={suggested} placeholder={add} exclude={values} onPick={(e) => onChange([...values, e.id])} />
      )}
    </section>
  );
}

function ClassTargets({ unit, plan, update, entries, data }: { unit: Unit; plan: UnitPlan; update: Update; entries: ArchiveEntry[]; data: ReferenceData | null }) {
  const mastered = new Set(unit.mastered_classes ?? []);
  return (
    <section className="plan-block">
      <Head icon={CONCEPT_ICON.classes} count={plan.classes.length}>Classes</Head>
      {plan.classes.length > 0 && (
        <SortableList
          ids={plan.classes}
          onReorder={(classes) => update({ classes })}
          label={(n) => n}
          render={(name) => {
            const c = data?.classes.find((x) => x.name === name);
            return <>
              <span className="plan-entry plan-class">
                <span className="plan-class-name">
                  <EntryIcon entry={{ kind: "class", id: name }} data={data} />
                  <EntryLink kind="class" id={name}>{name}</EntryLink>
                </span>
                {mastered.has(name) ? <span className="plan-have" title="Mastered"><Icon name={CONCEPT_ICON.mastery} /> Mastered</span> : c && c.requirements.length > 0 && (
                  <span className="plan-reqs" title={c.requirement_any ? "Any one of these" : undefined}>
                    {c.requirements.map((r, i) => {
                      const met = reaches(unit.skills?.[r.skill]?.rank, r.rank);
                      return (
                        <span key={r.skill} className={`plan-req${met ? " met" : ""}`} title={`${SKILL_LABEL[r.skill]} ${r.rank}${met ? " (reached)" : ""}`}>
                          {i > 0 && c.requirement_any && <span className="plan-or">or</span>}
                          <SkillIcon skill={r.skill} title={`${SKILL_LABEL[r.skill]} ${r.rank}`} /><RankIcon rank={r.rank} />
                        </span>
                      );
                    })}
                  </span>
                )}
              </span>
              <Remove name={name} onClick={() => update({ classes: plan.classes.filter((x) => x !== name) })} />
            </>;
          }}
        />
      )}
      <EntryPicker entries={entries} placeholder="Add class" exclude={plan.classes} onPick={(e) => update({ classes: [...plan.classes, e.id] })} />
    </section>
  );
}

function SkillTargets({ unit, plan, update, data, character }: { unit: Unit; plan: UnitPlan; update: Update; data: ReferenceData | null; character: Character | undefined }) {
  const classes = plan.classes.map((n) => data?.classes.find((c) => c.name === n)).filter((c): c is NonNullable<typeof c> => !!c);
  const fromClasses = targetsForClasses<SkillKey>(plan.skills as Partial<Record<SkillKey, string>>, classes);
  const canFill = SKILL_KEYS.some((k) => fromClasses[k] !== plan.skills[k]);
  // In the player's order (the plan's own), then any the classes added.
  const added = (Object.keys(plan.skills) as SkillKey[]).filter((k) => SKILL_KEYS.includes(k) && plan.skills[k]);
  const left = SKILL_KEYS.filter((k) => !plan.skills[k]);
  const setRank = (skill: SkillKey, rank: string | null) => {
    const skills = { ...plan.skills };
    if (rank) skills[skill] = rank; else delete skills[skill];
    update({ skills });
  };
  const reorder = (keys: string[]) => update({ skills: Object.fromEntries(keys.map((k) => [k, plan.skills[k as SkillKey]])) });
  // A new target starts at what the planned classes need, else one rank above the current one.
  const firstTarget = (k: SkillKey) => {
    const now = rankIndex(unit.skills?.[k]?.rank);
    const needed = rankIndex(targetsForClasses<SkillKey>({}, classes)[k]);
    return WEAPON_RANKS[Math.min(WEAPON_RANKS.length - 1, needed > now ? needed : now + 1)];
  };
  const aptitudeOf = (k: SkillKey) => {
    const a = character?.skills[k]?.aptitude ?? null;
    return a === "budding" || a === null ? undefined : a;
  };
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
        <SortableList
          ids={added}
          onReorder={reorder}
          label={(k) => SKILL_LABEL[k as SkillKey]}
          className="plan-skills"
          rowClass={(k) => (reaches(unit.skills?.[k as SkillKey]?.rank, plan.skills[k as SkillKey]!) ? "met" : "")}
          render={(id) => {
            const k = id as SkillKey;
            const now = unit.skills?.[k]?.rank;
            return <>
              <span className="plan-entry plan-skill">
                <SkillIcon skill={k} aptitude={aptitudeOf(k)} />
              </span>
              <span className="plan-row-end">
                <span className="plan-skill-now"><RankIcon rank={now} title={`Now ${now ?? "unranked"}`} /></span>
                <Icon name={CONCEPT_ICON.go} className="plan-skill-arrow" />
                <RankPicker value={plan.skills[k]!} onChange={(r) => setRank(k, r)} label={`${SKILL_LABEL[k]} target rank`} />
                <Remove name={SKILL_LABEL[k]} onClick={() => setRank(k, null)} />
              </span>
            </>;
          }}
        />
      )}
      {left.length > 0 && <SkillAdder skills={left} aptitudeOf={aptitudeOf} onPick={(k) => setRank(k, firstTarget(k))} />}
    </section>
  );
}

/** "Add skill": the skills not planned yet, as their icons. */
function SkillAdder({ skills, aptitudeOf, onPick }: { skills: SkillKey[]; aptitudeOf: (k: SkillKey) => Aptitude | undefined; onPick: (k: SkillKey) => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key, true); };
  }, [open]);
  useLayoutEffect(() => { if (open) menu.current?.querySelector<HTMLElement>("button")?.focus(); }, [open]);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="plan-add-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setAnchor(button.current?.getBoundingClientRect() ?? null); setOpen((o) => !o); }}
      >
        <Icon name={CONCEPT_ICON.add} /> Add skill
      </button>
      {open && anchor && createPortal(
        <div ref={menu} className="skill-menu" role="menu" aria-label="Add skill" style={{ top: anchor.bottom + 4, left: anchor.left }}>
          {skills.map((k) => (
            <button key={k} type="button" role="menuitem" title={SKILL_LABEL[k]} aria-label={SKILL_LABEL[k]} onClick={() => { onPick(k); setOpen(false); }}>
              <SkillIcon skill={k} aptitude={aptitudeOf(k)} title={SKILL_LABEL[k]} />
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

const SUPPORT_RANKS: PlanSupportRank[] = ["C", "B", "A", "S"];
const baseName = (n: string) => n.replace(/ \([MF]\)$/, "");

/** Planned support partners, each with the rank to reach (only ranks the pair can have), in the player's order. */
function SupportTargets({ unit, plan, update, entries, character }: { unit: Unit; plan: UnitPlan; update: Update; entries: ArchiveEntry[]; character: Character | undefined }) {
  const supports = useSupports();
  const nav = useNav();
  const me = character?.name ?? unit.name;
  const pairs = useMemo(() => {
    const m = new Map<string, SupportPair>();
    for (const p of supports?.pairs ?? []) {
      const [a, b] = [baseName(p.a), baseName(p.b)];
      if (a === me) m.set(b, p);
      else if (b === me) m.set(a, p);
    }
    return m;
  }, [supports, me]);
  const nameOf = (key: string) => entries.find((e) => e.id === key)?.label ?? key;
  const ranksFor = (key: string): PlanSupportRank[] => {
    const pair = pairs.get(nameOf(key));
    const have = pair ? SUPPORT_RANKS.filter((r) => visibleRanks(pair).includes(r)) : [];
    return have.length ? have : ["C", "B", "A"];
  };
  const others = entries.filter((e) => e.id !== character?.key);
  const suggested = others.filter((e) => pairs.has(e.label)).map((e) => ({ entry: e, note: `up to ${ranksFor(e.id).at(-1)}` }));
  const list = plan.supports ?? [];
  const set = (supports: UnitPlan["supports"]) => update({ supports });
  return (
    <section className="plan-block">
      <Head icon={CONCEPT_ICON.supports} count={list.length}>Supports</Head>
      {list.length > 0 && (
        <SortableList
          ids={list.map((s) => s.partner)}
          onReorder={(ids) => set(ids.map((id) => list.find((s) => s.partner === id)!))}
          label={nameOf}
          render={(partner) => {
            const s = list.find((x) => x.partner === partner)!;
            return <>
              <span className="plan-entry">
                <RefLink onClick={() => nav.go({ page: "supports", tab: "character", id: me })} title="Support partners and gifts">{nameOf(partner)}</RefLink>
              </span>
              <span className="plan-row-end">
                <span className="plan-support-ranks" role="radiogroup" aria-label={`Support rank with ${nameOf(partner)}`}>
                  {ranksFor(partner).map((r) => (
                    <button key={r} type="button" role="radio" aria-checked={s.rank === r} className={s.rank === r ? "on" : ""}
                      onClick={() => set(list.map((x) => (x.partner === partner ? { ...x, rank: r } : x)))}>{r}</button>
                  ))}
                </span>
                <Remove name={nameOf(partner)} onClick={() => set(list.filter((x) => x.partner !== partner))} />
              </span>
            </>;
          }}
        />
      )}
      <EntryPicker
        entries={others}
        suggested={suggested}
        placeholder="Add support"
        exclude={list.map((s) => s.partner)}
        onPick={(e) => { const ranks = ranksFor(e.id); set([...list, { partner: e.id, rank: ranks.includes("A") ? "A" : ranks.at(-1)! }]); }}
      />
    </section>
  );
}

/** The spells the unit learns in Reason and Faith, by rank: learned ones checked, ones its target reaches marked. */
function MagicByRank({ unit, plan, data, character }: { unit: Unit; plan: UnitPlan; data: ReferenceData | null; character: Character | undefined }) {
  if (!character) return null;
  const schools = (["reason", "faith"] as const).filter((k) => character.spells[k].length > 0);
  if (!schools.length) return null;
  return (
    <section className="plan-block">
      <Head icon={CONCEPT_ICON.spell}>Magic</Head>
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
                    <span className="plan-spell-rank"><RankIcon rank={sp.rank} /></span>
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
    </section>
  );
}
