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
import { planIsEmpty } from "../../planTransfer";
import { canTakeClass, linkRoute, rankIndex, reaches, targetsForClasses, type ArchiveEntry, type LinkKind } from "../../planner";
import { characterKeyOfUnit, portraitKey } from "../../portraits";
import { SKILL_KEYS, SKILL_LABEL, type Aptitude, type Character, type ReferenceData, type SkillKey } from "../../reference/types";
import { WEAPON_RANKS } from "../../reference/weaponRanks";
import { useSupports } from "../../reference/supports";
import { pairsByPartner, runBylethGender, visibleRanks } from "../reference/supports/shared";
import { tidyAbility } from "../../appearance";
import { RefLink } from "../common";
import { Icon, IconButton, type IconName } from "../Icon";
import { Modal } from "../Modal";
import { SkillIcon } from "../SkillIcon";
import { RankIcon, RankPicker } from "../RankIcon";
import { useSpoiler } from "../../spoilers";
import type { ToastState } from "../Toasts";
import { EntryIcon, EntryPicker, useArchiveEntries } from "./entries";
import { NotesEditor } from "./NotesEditor";

const SAVE_MS = 600;
type SaveStatus = "idle" | "saving" | "saved" | "error";
type Update = (change: Partial<UnitPlan>) => void;

export { planIsEmpty };

// The last plan each window saved, by run and unit, so reopening shows it even before the roster has reloaded.
const savedPlans = new Map<string, UnitPlan>();
/** Forget them for a run whose plans changed elsewhere (an import), so the roster's own are shown. */
export function forgetSavedPlans(runId: string) {
  for (const key of [...savedPlans.keys()]) if (key.startsWith(`${runId}:`)) savedPlans.delete(key);
}

/** The roster card's Planner button, and the window it opens. */
export function PlannerButton({ unit, units, runId, toasts }: { unit: Unit; units: Unit[]; runId: string; toasts: ToastState }) {
  const [open, setOpen] = useState(false);
  const planned = !planIsEmpty(savedPlans.get(`${runId}:${unit.key}`) ?? unit.plan);
  return (
    <>
      <IconButton
        icon={CONCEPT_ICON.plan}
        label={planned ? "Planner (has a plan)" : "Planner"}
        onClick={() => setOpen(true)}
        className={`plan-open${planned ? " has-plan" : ""}`}
      />
      <PlannerWindow open={open} onClose={() => setOpen(false)} start={unit} units={units} runId={runId} toasts={toasts} />
    </>
  );
}

/** Whose plan the window shows: a unit on the Roster, or a character who isn't (by Characters page key). */
type Subject = { kind: "unit"; key: string } | { kind: "character"; key: string };
const sameSubject = (a: Subject, b: Subject) => a.kind === b.kind && a.key === b.key;

/** A character off the Roster as the plan sees them: no class, gear or progress yet. */
function stubUnit(c: Character): Unit {
  return {
    key: c.key, name: c.name, full_name: c.full_name, class_name: "", gender: c.gender === "Either" ? "" : c.gender,
    displayed: {} as Unit["displayed"], bonuses: {}, effective_bonuses: {}, base_values: {} as Unit["base_values"],
    ebst_effective: {} as Unit["ebst_effective"], blue: [], boosted_unexplained: [], personal_ability: "", abilities: [],
    accessory: null, updated_at: "",
  };
}

/** The Planner window: one plan at a time, the previous and next ones a click away, and a search for anyone else,
 * on the Roster or not. */
function PlannerWindow({ open, onClose, start, units, runId, toasts }: {
  open: boolean; onClose: () => void; start: Unit; units: Unit[]; runId: string; toasts: ToastState;
}) {
  const { ref, entries } = useArchiveEntries();
  const [subject, setSubject] = useState<Subject>({ kind: "unit", key: start.key });
  const [offRoster, setOffRoster] = useState<Record<string, UnitPlan> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Deleting a plan starts the body over, so it shows what a new plan would.
  const [generation, setGeneration] = useState(0);
  const body = useRef<BodyHandle | null>(null);
  useEffect(() => {
    if (!open) return;
    setSubject({ kind: "unit", key: start.key });
    setStatus("idle");
    let live = true;
    api.plans(runId).then((r) => live && setOffRoster(r.plans), () => live && setOffRoster({}));
    return () => { live = false; };
  }, [open, runId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Roster units by Characters page key, so picking someone on the Roster opens their unit's plan.
  const rosterByCharacter = useMemo(() => {
    const m = new Map<string, Unit>();
    for (const u of units) { const k = characterKeyOfUnit(u); if (k && !m.has(k)) m.set(k, u); }
    return m;
  }, [units]);
  // The order Previous and Next walk: the Roster as listed, then those planned off it, then whoever is open now.
  const order = useMemo(() => {
    const nameOf = (key: string) => ref?.characters.find((c) => c.key === key)?.name ?? key;
    const out: Subject[] = units.map((u) => ({ kind: "unit", key: u.key }));
    const planned = Object.entries(offRoster ?? {}).filter(([k, p]) => !rosterByCharacter.has(k) && !planIsEmpty(p)).map(([k]) => k);
    planned.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    for (const key of planned) out.push({ kind: "character", key });
    if (!out.some((s) => sameSubject(s, subject))) out.push(subject);
    return out;
  }, [units, offRoster, rosterByCharacter, subject, ref]);
  const go = (next: Subject) => { setStatus("idle"); setSubject(next); };
  const step = (by: number) => {
    const at = order.findIndex((s) => sameSubject(s, subject));
    go(order[(at + by + order.length) % order.length]);
  };

  const unit = subject.kind === "unit" ? units.find((u) => u.key === subject.key) ?? (subject.key === start.key ? start : null) : null;
  const character = subject.kind === "character" ? ref?.characters.find((c) => c.key === subject.key) ?? null : null;
  const shown = useMemo(() => unit ?? (character ? stubUnit(character) : null), [unit, character]);
  const initial = unit ? savedPlans.get(`${runId}:${unit.key}`) ?? unit.plan : character ? offRoster?.[character.key] : undefined;
  const name = shown?.name ?? "";
  const current = shown ? characterKeyOfUnit(shown) : null;

  const unitEntries = useMemo(() => entries.filter((e) => e.kind === "unit"), [entries]);
  const notes = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of unitEntries) {
      if (rosterByCharacter.has(e.id)) m.set(e.id, "Roster");
      else if (!planIsEmpty(offRoster?.[e.id])) m.set(e.id, "Planned");
    }
    return m;
  }, [unitEntries, rosterByCharacter, offRoster]);
  // With nothing typed: the Roster, then those planned off it, in the order Previous and Next walk.
  const suggested = useMemo(() => order.flatMap((s) => {
    const key = s.kind === "character" ? s.key : characterKeyOfUnit(units.find((u) => u.key === s.key) ?? start);
    const entry = key ? unitEntries.find((e) => e.id === key) : undefined;
    return entry ? [{ entry, note: notes.get(entry.id) ?? "" }] : [];
  }), [order, units, start, unitEntries, notes]);
  const pick = (e: ArchiveEntry) => {
    const u = rosterByCharacter.get(e.id);
    go(u ? { kind: "unit", key: u.key } : { kind: "character", key: e.id });
  };
  // One save at a time, in order: an edit still on its way can't land after the plan is deleted.
  const lastSave = useRef<Promise<unknown>>(Promise.resolve());
  const save = useCallback((plan: UnitPlan) => {
    const send = () => (subject.kind === "unit"
      ? api.setUnitPlan(runId, subject.key, plan).then(() => { savedPlans.set(`${runId}:${subject.key}`, plan); })
      : api.setPlan(runId, subject.key, plan).then(() => setOffRoster((p) => ({ ...p, [subject.key]: plan }))));
    const sent = lastSave.current.then(send, send);
    lastSave.current = sent;
    return sent;
  }, [runId, subject]);
  // An empty plan is no plan (the server forgets it).
  const deletePlan = async () => {
    const from = body.current;
    const unsaved = from?.cancel() ?? null;
    setDeleting(true);
    try {
      await save({ ...EMPTY_PLAN });
      setGeneration((g) => g + 1);
      setConfirmDelete(false);
      toasts.push({ kind: "ok", title: `Deleted ${name}’s plan` });
    } catch (error) {
      if (unsaved) from?.queue(unsaved);
      toasts.push({ kind: "error", title: "Couldn't delete the plan", body: (error as Error).message });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`${name}’s Plan`}
        ariaLabel={`${name} planner`}
        className="planner"
        actions={<>
          <span className="plan-nav">
            <button type="button" className="plan-nav-step" aria-label="Previous plan" title="Previous plan" onClick={() => step(-1)} disabled={order.length < 2}>
              <Icon name={CONCEPT_ICON.prev} />
            </button>

            <button type="button" className="plan-nav-step" aria-label="Next plan" title="Next plan" onClick={() => step(1)} disabled={order.length < 2}>
              <Icon name={CONCEPT_ICON.next} />
            </button>
            <EntryPicker
              className="plan-find"
              icon={CONCEPT_ICON.search}
              entries={unitEntries}
              placeholder="Find a unit"
              exclude={current ? [current] : []}
              notes={notes}
              suggested={suggested}
              onPick={pick}
            />
          </span>
        </>}
        footer={<>
          <SaveState state={status} />
          {unit && (
            <button type="button" className="plan-nav-step plan-reset" aria-label="Reset to current" title="Reset to current" onClick={() => setConfirm(true)}>
              <Icon name={CONCEPT_ICON.reset} />
            </button>
          )}
          <button type="button" className="plan-nav-step plan-delete" aria-label="Delete plan" title="Delete plan" onClick={() => setConfirmDelete(true)} disabled={planIsEmpty(initial)}>
            <Icon name={CONCEPT_ICON.delete} />
          </button>
        </>}
      >
        {open && shown && (unit || offRoster) && (
          <PlannerBody key={`${runId}:${subject.kind}:${subject.key}:${generation}`} unit={shown} units={units} onRoster={!!unit} initial={initial} toasts={toasts}
            onStatus={setStatus} handle={body} save={save} />
        )}
      </Modal>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Reset plan?" className="planner-confirm">
        <p>Replace {name}’s plan with what they have now? Notes are kept.</p>
        <div className="planner-confirm-actions">
          <button type="button" className="btn" onClick={() => setConfirm(false)}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => { body.current?.reset(); setConfirm(false); }}>Reset</button>
        </div>
      </Modal>
      <Modal open={confirmDelete} onClose={() => { if (!deleting) setConfirmDelete(false); }} title="Delete plan?" className="planner-confirm">
        <p>Delete {name}’s plan, notes included? This can’t be undone.</p>
        <div className="planner-confirm-actions">
          <button type="button" className="btn" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button type="button" className="btn danger" disabled={deleting} onClick={() => void deletePlan()}>{deleting ? "Deleting…" : "Delete"}</button>
        </div>
      </Modal>
    </>
  );
}

/** What the unit has now: its class, equipped combat arts and abilities, everything in its equipment field and its battalion. A new plan
 * starts from it, and Reset returns to it. */
export function currentKit(unit: Unit): UnitPlan {
  const carried = (unit.inventory ?? []).filter((i) => i.kind !== "spell").map((i) => i.name);
  return {
    ...EMPTY_PLAN,
    classes: unit.class_name ? [unit.class_name] : [],
    arts: [...new Set(unit.combat_arts ?? [])].slice(0, PLAN_MAX.arts),
    abilities: [...new Set(unit.abilities.map(tidyAbility).filter(Boolean))].slice(0, PLAN_MAX.abilities),
    equipment: [...new Set([...carried, ...(unit.accessory ? [unit.accessory] : [])])].slice(0, PLAN_MAX.equipment),
    battalion: unit.battalion ?? "",
  };
}

/** What the window's own buttons ask of the plan it shows. */
interface BodyHandle {
  reset: () => void;
  /** Drops the change waiting to be saved, and returns it. */
  cancel: () => UnitPlan | null;
  queue: (plan: UnitPlan) => void;
}

function PlannerBody({ unit, units, onRoster, initial, toasts, onStatus, handle, save: send }: {
  unit: Unit; units: Unit[]; onRoster: boolean; initial: UnitPlan | undefined; toasts: ToastState; onStatus: (s: SaveStatus) => void;
  handle: React.MutableRefObject<BodyHandle | null>; save: (plan: UnitPlan) => Promise<unknown>;
}) {
  const { ref, entries } = useArchiveEntries();
  // A character off the Roster has nothing yet to start from.
  const [plan, setPlan] = useState<UnitPlan>(() => (planIsEmpty(initial) ? (onRoster ? currentKit(unit) : { ...EMPTY_PLAN }) : { ...EMPTY_PLAN, ...initial }));
  const save = useSaver(send, toasts);
  useEffect(() => onStatus(save.state), [save.state, onStatus]);
  const update = useCallback<Update>((change) => setPlan((p) => {
    const next = { ...p, ...change };
    save.queue(next);
    return next;
  }), [save]);
  handle.current = {
    reset: () => setPlan((p) => {
      const next = { ...currentKit(unit), notes: p.notes };
      save.queue(next);
      return next;
    }),
    cancel: save.cancel,
    queue: save.queue,
  };

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
          <ClassTargets unit={unit} plan={plan} update={update} entries={byKind.get("class") ?? []} data={ref} character={character} />
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
          <SupportTargets unit={unit} units={units} plan={plan} update={update} entries={byKind.get("unit") ?? []} character={character} />
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
function useSaver(send: (plan: UnitPlan) => Promise<unknown>, toasts: ToastState) {
  const [state, setState] = useState<SaveStatus>("idle");
  const pending = useRef<UnitPlan | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const plan = pending.current;
    if (!plan) return;
    pending.current = null;
    setState("saving");
    send(plan).then(
      () => setState((s) => (pending.current ? s : "saved")),
      (e: Error) => {
        setState("error");
        toasts.push({ kind: "error", title: "Couldn't save the plan", body: e.message });
      },
    );
  }, [send, toasts]);
  const queue = useCallback((plan: UnitPlan) => {
    pending.current = plan;
    setState("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_MS);
  }, [flush]);
  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    const plan = pending.current;
    pending.current = null;
    return plan;
  }, []);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
  return useMemo(() => ({ state, queue, cancel }), [state, queue, cancel]);
}

function SaveState({ state }: { state: SaveStatus }) {
  // Always the same width, so nothing beside it moves as it changes.
  return (
    <span className={`plan-save ${state}`} role="status">
      {state === "idle" ? null : state === "saving" ? "Saving…" : state === "saved" ? <><Icon name={CONCEPT_ICON.done} /> Saved</> : <><Icon name={CONCEPT_ICON.warning} /> Not saved</>}
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

function ClassTargets({ unit, plan, update, entries, data, character }: { unit: Unit; plan: UnitPlan; update: Update; entries: ArchiveEntry[]; data: ReferenceData | null; character: Character | undefined }) {
  const mastered = new Set(unit.mastered_classes ?? []);
  const [identities] = useSpoiler("identities");
  // Opened empty, the list leaves out classes the unit can never take; typing still finds them. While hidden
  // identities are, whose class Death Knight is isn't told either.
  const suggested = useMemo(() => {
    const who = {
      key: characterKeyOfUnit(unit),
      gender: unit.gender || (character && character.gender !== "Either" ? character.gender : ""),
      house: character?.house,
      startClass: character?.start_class,
      has: [unit.class_name, ...(unit.mastered_classes ?? [])],
    };
    return entries.filter((e) => {
      const c = data?.classes.find((x) => x.name === e.id);
      if (e.id === "Death Knight" && !identities && !who.has.includes(e.id)) return false;
      return !c || canTakeClass(who, c);
    }).map((entry) => ({ entry, note: "" }));
  }, [unit, character, entries, data, identities]);
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
      <EntryPicker entries={entries} suggested={suggested} placeholder="Add class" exclude={plan.classes} onPick={(e) => update({ classes: [...plan.classes, e.id] })} />
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

const SUPPORT_RANKS: PlanSupportRank[] = ["C", "B", "A", "A+", "S"];

/** Planned support partners, each with the rank to reach (only ranks the pair can have), in the player's order. */
function SupportTargets({ unit, units, plan, update, entries, character }: { unit: Unit; units: Unit[]; plan: UnitPlan; update: Update; entries: ArchiveEntry[]; character: Character | undefined }) {
  const supports = useSupports();
  const nav = useNav();
  const me = character?.name ?? unit.name;
  const myKey = character?.key ?? characterKeyOfUnit(unit);
  // The same lookup as the Supports page: by Characters page key, with the run's Byleth.
  const byleth = myKey === "byleth" ? (portraitKey(unit) === "byleth_f" ? "F" : "M") : runBylethGender(units);
  const pairs = useMemo(() => pairsByPartner(supports?.pairs ?? [], myKey ?? "", byleth), [supports, myKey, byleth]);
  const nameOf = (key: string) => entries.find((e) => e.id === key)?.label ?? key;
  /** The ranks the pair can reach; none when the two can't support (or the data hasn't loaded). */
  const ranksFor = (key: string): PlanSupportRank[] => {
    const pair = pairs.get(key);
    return pair ? SUPPORT_RANKS.filter((r) => visibleRanks(pair).includes(r)) : [];
  };
  // Only people this unit can support with: anyone else has no rank to aim for.
  const others = entries.filter((e) => e.id !== myKey && pairs.has(e.id));
  const suggested = others.map((e) => ({ entry: e, note: `up to ${ranksFor(e.id).at(-1)}` }));
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
                {ranksFor(partner).length ? (
                  <span className="plan-support-ranks" role="radiogroup" aria-label={`Support rank with ${nameOf(partner)}`}>
                    {ranksFor(partner).map((r) => (
                      <button key={r} type="button" role="radio" aria-checked={s.rank === r} className={s.rank === r ? "on" : ""}
                        onClick={() => set(list.map((x) => (x.partner === partner ? { ...x, rank: r } : x)))}>{r}</button>
                    ))}
                  </span>
                ) : supports && <span className="muted small">No support</span>}
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
