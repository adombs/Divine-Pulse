/**
 * A run's ruleset on the Runs page: its self-imposed rules in order, to add (one-click suggestions or the player's own),
 * edit, remove and reorder (drag a rule, or its arrows), each change saved at once. Export Image saves the ruleset as a
 * picture at Export Team's sizes and aspect ratios; the video export can show it as a page too (battle/RulesetPage.tsx).
 */
import { CONCEPT_ICON } from "../icons/concepts";
import "./ruleset.css";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type RunSummary } from "../api";
import { plural } from "../format";
import {
  addRule, hasRule, MAX_RULES, moveRule, removeRule, RULE_DESCRIPTION_LEN, RULE_NAME_LEN, RULE_SUGGESTIONS, ruleError, rulesetColumns,
  sanitizeRules, updateRule, type Rule,
} from "../ruleset";
import { elementPng, picturePixels, pictureSize } from "../exporting/snapshot";
import { safeFilename, saveFiles } from "../exporting/save";
import { ExportActions, type ExportStatus } from "./ExportActions";
import { Icon, IconButton } from "./Icon";
import { Modal } from "./Modal";
import { Segmented } from "./ui";
import { ASPECTS, FitWidth, SIZES, TeamSheet, type Aspect } from "./TeamExport";
import type { ToastState } from "./Toasts";

/** The rules as a picture shows them: numbered, in columns read top to bottom. */
export function RulesetList({ rules, columns, width }: { rules: readonly Rule[]; columns: number; /** Laid out this wide (px; none: its columns' own width). */ width?: number }) {
  return (
    <ol className="ruleset-sheet" style={{ columnCount: columns, width: width ?? columns * RULE_COLUMN_W + (columns - 1) * RULE_COLUMN_GAP, columnGap: RULE_COLUMN_GAP }}>
      {rules.map((rule, i) => (
        <li key={`${i}-${rule.name}`} className="ruleset-sheet-rule">
          <span className="ruleset-sheet-number">{i + 1}</span>
          <span className="ruleset-sheet-text">
            <b>{rule.name}</b>
            {rule.description && <span>{rule.description}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
/** A column of rules in a picture, and the room between columns (px). */
export const RULE_COLUMN_W = 420;
export const RULE_COLUMN_GAP = 28;

/** The Runs page's Ruleset section for one run. */
export function RulesetSection({ run, toasts }: { run: RunSummary; toasts: ToastState }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<{ index: number; rule: Rule } | null>(null);
  const [draft, setDraft] = useState<Rule>({ name: "", description: "" });
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const saving = useRef(0);

  useEffect(() => {
    let live = true;
    setFailed(false);
    api.ruleset(run.id).then(
      (r) => { if (live && !saving.current) setRules(sanitizeRules(r.rules)); },
      () => { if (live) setFailed(true); },
    );
    return () => { live = false; };
  }, [run.id, run.updated_at, retry]);

  /** Show the change at once, save it, and go back if it couldn't be saved. */
  const commit = async (next: Rule[]) => {
    const before = rules;
    setRules(next);
    saving.current++;
    try {
      const saved = await api.setRuleset(run.id, next);
      setRules(sanitizeRules(saved.rules));
    } catch (err) {
      setRules(before);
      toasts.push({ kind: "error", title: "Couldn't save the ruleset", body: (err as Error).message });
    } finally {
      saving.current--;
    }
  };

  if (failed) {
    return (
      <section className="block runs-ruleset">
        <div className="sec-head"><h2>Ruleset</h2></div>
        <div className="runs-battle-error" role="status">
          <p>Couldn't load this run's ruleset.</p>
          <button type="button" className="btn small" onClick={() => setRetry((n) => n + 1)}>Try again</button>
        </div>
      </section>
    );
  }
  if (rules === null) {
    return (
      <section className="block runs-ruleset">
        <div className="sec-head"><h2>Ruleset</h2></div>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  const full = rules.length >= MAX_RULES;
  const draftError = draft.name.trim() || draft.description.trim() ? ruleError(draft, rules) : null;
  const editError = editing ? ruleError(editing.rule, rules.filter((_, i) => i !== editing.index)) : null;

  const addDraft = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim() || draftError || full) return;
    void commit(addRule(rules, draft));
    setDraft({ name: "", description: "" });
  };
  const saveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing || editError) return;
    void commit(updateRule(rules, editing.index, editing.rule));
    setEditing(null);
  };
  const drop = (to: number) => {
    if (dragging !== null && dragging !== to) void commit(moveRule(rules, dragging, to));
    setDragging(null);
    setOver(null);
  };

  return (
    <section className="block runs-ruleset">
      <div className="sec-head">
        <h2>Ruleset</h2>
        <div className="sec-head-right">
          {rules.length > 0 && <span className="muted small">{plural(rules.length, "rule")}</span>}
          <button type="button" className="btn small" onClick={() => setExporting(true)} disabled={!rules.length} title={rules.length ? "Save the ruleset as an image, to share" : "Add a rule first"}>
            <Icon name={CONCEPT_ICON.share} /> Export Image
          </button>
        </div>
      </div>
      {rules.length === 0 ? (
        <p className="muted">No rules yet. Pick common challenge rules below, or write your own.</p>
      ) : (
        <ol className="ruleset-rules">
          {rules.map((rule, i) => editing?.index === i ? (
            <li key={i} className="ruleset-rule editing">
              <form className="ruleset-form" onSubmit={saveEdit} onKeyDown={(e) => e.key === "Escape" && setEditing(null)}>
                <RuleFields rule={editing.rule} onChange={(rule) => setEditing({ index: i, rule })} autoFocus idPrefix={`rule-edit-${i}`} />
                <div className="ruleset-form-actions">
                  <button className="btn small primary" type="submit" disabled={!!editError}>Save</button>
                  <button className="btn small" type="button" onClick={() => setEditing(null)}>Cancel</button>
                  {editError && <span className="field-hint error" role="status">{editError}</span>}
                </div>
              </form>
            </li>
          ) : (
            <li
              key={`${i}-${rule.name}`}
              className={`ruleset-rule${dragging === i ? " dragging" : ""}${over === i && dragging !== i ? " drop-here" : ""}`}
              draggable={!editing}
              onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
              onDragOver={(e) => { if (dragging === null) return; e.preventDefault(); setOver(i); }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => { e.preventDefault(); drop(i); }}
              onDragEnd={() => { setDragging(null); setOver(null); }}
            >
              <span className="ruleset-grip" aria-hidden title="Drag to reorder"><Icon name={CONCEPT_ICON.drag} /></span>
              <span className="ruleset-number">{i + 1}</span>
              <span className="ruleset-text">
                <b>{rule.name}</b>
                {rule.description && <span>{rule.description}</span>}
              </span>
              <span className="ruleset-actions">
                <IconButton icon={CONCEPT_ICON.up} label={`Move "${rule.name}" up`} onClick={() => void commit(moveRule(rules, i, i - 1))} disabled={i === 0} />
                <IconButton icon={CONCEPT_ICON.down} label={`Move "${rule.name}" down`} onClick={() => void commit(moveRule(rules, i, i + 1))} disabled={i === rules.length - 1} />
                <IconButton icon={CONCEPT_ICON.edit} label={`Edit "${rule.name}"`} onClick={() => setEditing({ index: i, rule })} />
                <IconButton icon={CONCEPT_ICON.delete} label={`Remove "${rule.name}"`} onClick={() => void commit(removeRule(rules, i))} className="danger" />
              </span>
            </li>
          ))}
        </ol>
      )}
      <form className="ruleset-form ruleset-add" onSubmit={addDraft}>
        <RuleFields rule={draft} onChange={setDraft} idPrefix="rule-new" placeholder="Your own rule, e.g. No Lance users" />
        <div className="ruleset-form-actions">
          <button className="btn small primary" type="submit" disabled={!draft.name.trim() || !!draftError || full}>Add Rule</button>
          {full && <span className="field-hint">A ruleset holds at most {MAX_RULES} rules.</span>}
          {draftError && <span className="field-hint error" role="status">{draftError}</span>}
        </div>
      </form>
      <div className="ruleset-suggestions" aria-label="Common challenge rules">
        <p className="ruleset-suggestions-head">Common challenge rules</p>
        {RULE_SUGGESTIONS.map((group) => (
          <div key={group.title} className="ruleset-suggestion-group">
            <span className="ruleset-suggestion-title">{group.title}</span>
            <div className="ruleset-chips">
              {group.rules.map((s) => {
                const added = hasRule(rules, s.name);
                return (
                  <button
                    key={s.name}
                    type="button"
                    className={`ruleset-chip${added ? " added" : ""}`}
                    title={s.description}
                    aria-label={added ? `${s.name} (in the ruleset)` : `Add rule: ${s.name}`}
                    aria-pressed={added}
                    disabled={added || full}
                    onClick={() => void commit(addRule(rules, s))}
                  >
                    <Icon name={added ? CONCEPT_ICON.done : CONCEPT_ICON.add} /> {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {exporting && <RulesetExportDialog run={run} rules={rules} onClose={() => setExporting(false)} />}
    </section>
  );
}

function RuleFields({ rule, onChange, autoFocus, idPrefix, placeholder }: { rule: Rule; onChange: (rule: Rule) => void; autoFocus?: boolean; idPrefix: string; placeholder?: string }) {
  return (
    <div className="ruleset-fields">
      <input
        id={`${idPrefix}-name`}
        aria-label="Rule name"
        autoFocus={autoFocus}
        placeholder={placeholder ?? "Rule name"}
        value={rule.name}
        maxLength={RULE_NAME_LEN + 10}
        onChange={(e) => onChange({ ...rule, name: e.target.value })}
      />
      <input
        id={`${idPrefix}-description`}
        aria-label="Description (optional)"
        placeholder="What it means (optional)"
        value={rule.description}
        maxLength={RULE_DESCRIPTION_LEN + 10}
        onChange={(e) => onChange({ ...rule, description: e.target.value })}
      />
    </div>
  );
}

const IMAGE_OPTIONS_KEY = "divine-pulse-export-ruleset";
/** The image's least width, and its sheet's padding across (team-export.css `.team-sheet`), so the list fills it. */
const IMAGE_WIDTH = 640;
const SHEET_PAD_X = 56;
interface ImageOptions {
  size: number;
  aspect: Aspect;
}
function loadImageOptions(): ImageOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(IMAGE_OPTIONS_KEY) ?? "{}") as Partial<ImageOptions>;
    return {
      size: SIZES.some(([k]) => k === saved.size) ? saved.size! : 1.5,
      aspect: ASPECTS.some(([a]) => a === saved.aspect) ? saved.aspect! : "auto",
    };
  } catch {
    return { size: 1.5, aspect: "auto" };
  }
}

/** Export Image: the ruleset as a picture, previewed as it will be saved. */
function RulesetExportDialog({ run, rules, onClose }: { run: RunSummary; rules: Rule[]; onClose: () => void }) {
  const [options, setOptionsState] = useState<ImageOptions>(loadImageOptions);
  const setOption = <K extends keyof ImageOptions>(key: K, value: ImageOptions[K]) => setOptionsState((o) => {
    const next = { ...o, [key]: value };
    try {
      localStorage.setItem(IMAGE_OPTIONS_KEY, JSON.stringify(next));
    } catch {
      // Not kept; fine.
    }
    return next;
  });
  const sheet = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const measure = () => setSize(sheet.current ? pictureSize(sheet.current) : [0, 0]);
    const observer = new ResizeObserver(measure);
    if (sheet.current) observer.observe(sheet.current);
    measure();
    return () => observer.disconnect();
  }, []);
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });
  const working = status.kind === "working";
  const portrait = options.aspect === "9:16" || options.aspect === "4:5";
  const columns = rulesetColumns(rules.length, portrait);

  const exportImage = async () => {
    if (!sheet.current) return;
    setStatus({ kind: "working", done: 0, total: 1, label: "Making the image" });
    try {
      const blob = await elementPng(sheet.current, options.size);
      const saved = await saveFiles("png", [{ name: `${safeFilename(run.name)} ruleset.png`, blob }]);
      setStatus(saved ? { kind: "saved", where: saved } : { kind: "idle" });
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message || "The image couldn't be made." });
    }
  };

  return (
    <Modal open wide className="team-export-modal" title="Export Ruleset" onClose={() => { if (!working) onClose(); }}>
      <div className="team-export">
        <div className="team-export-preview" aria-label="Preview">
          <figure className="team-export-figure">
            <figcaption>Ruleset</figcaption>
            <FitWidth>
              <TeamSheet ref={sheet} run={run} title="Ruleset" width={IMAGE_WIDTH} aspect={options.aspect} note={plural(rules.length, "rule")}>
                <RulesetList rules={rules} columns={columns} width={Math.max(columns * RULE_COLUMN_W + (columns - 1) * RULE_COLUMN_GAP, IMAGE_WIDTH - SHEET_PAD_X)} />
              </TeamSheet>
            </FitWidth>
          </figure>
        </div>
        <aside className="export-side" aria-label="Ruleset image options">
          <fieldset className="export-group" disabled={working}>
            <legend>Image</legend>
            <div className="export-pairs">
              <div className="wide team-choice">
                <span className="field-label">Aspect ratio</span>
                <Segmented<Aspect> label="Aspect ratio" value={options.aspect} onChange={(v) => setOption("aspect", v)} options={ASPECTS} />
              </div>
              <div className="wide team-choice">
                <span className="field-label">Size</span>
                <Segmented<string> label="Image size" value={String(options.size)} onChange={(v) => setOption("size", Number(v))} options={SIZES.map(([k, label]) => [String(k), label] as const)} />
              </div>
              <p className="export-sizes wide"><span>Ruleset <b>{picturePixels(size, options.size).map((n) => n.toLocaleString()).join(" × ")} px</b></span></p>
            </div>
          </fieldset>
          <ExportActions
            facts={[plural(rules.length, "rule"), "PNG image"]}
            status={status}
            action="Export image…"
            disabled={!rules.length}
            onExport={() => void exportImage()}
          />
        </aside>
      </div>
    </Modal>
  );
}
