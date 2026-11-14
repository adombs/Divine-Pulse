/**
 * The ruleset page of the video export (ReplayExport.tsx): the run's rules (Ruleset.tsx `RulesetList`) as a full frame,
 * before the replay or after it, for long enough to read (ruleset.ts `rulesetPageMs`). The rules are drawn as big as fit:
 * a hidden copy is measured at the frame's width, and a ruleset too tall for the frame is drawn smaller, and wider so it
 * still fills the frame across.
 */
import "./replay-export.css";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { RunRoute } from "../../api";
import { plural } from "../../format";
import { fmtSeconds, PLACEMENTS, sanitizeSeconds, type Placement } from "../../exporting/teamPages";
import { fitScale, rulesetColumns, rulesetPageMs, type Rule } from "../../ruleset";
import { CardBanner, RunIcon, Segmented } from "../ui";
import { RULE_COLUMN_GAP, RULE_COLUMN_W, RulesetList } from "../Ruleset";
import { SecondsSlider, type PageFrame } from "./TeamPages";

export interface RulesetPageOptions {
  show: boolean;
  at: Placement;
  /** How long the page stays on screen (one of `PAGE_SECONDS`), or null for Auto: longer the more rules (`rulesetPageMs`). */
  seconds: number | null;
}
export const DEFAULT_RULESET_PAGE: RulesetPageOptions = { show: false, at: "start", seconds: null };

export function sanitizeRulesetPage(saved: unknown): RulesetPageOptions {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<Record<keyof RulesetPageOptions, unknown>>;
  return {
    show: s.show === true,
    at: PLACEMENTS.find(([p]) => p === s.at)?.[0] ?? DEFAULT_RULESET_PAGE.at,
    seconds: sanitizeSeconds(s.seconds, null),
  };
}

/** A frame's padding and the gap under its title strip (px), as the team pages have them. */
const PAD = 16;
const GAP = 12;
/** The rules are drawn this much bigger than in an image, to read in a video. */
const VIDEO_TEXT = 1.25;

export interface RulesetPageState {
  /** The hidden copy the page is measured from; render once, anywhere in the window. */
  measure: ReactNode;
  /** Whether the video has the page. */
  enabled: boolean;
  columns: number;
  /** How the list is drawn: its scale, and the width it is laid out at. */
  scale: number;
  width: number;
  ms: number;
}

export function useRulesetPage({ options, rules, frame }: { options: RulesetPageOptions; rules: readonly Rule[]; frame: PageFrame }): RulesetPageState {
  const enabled = options.show && rules.length > 0;
  const columns = rulesetColumns(rules.length, frame.portrait);
  const roomW = frame.width - 2 * PAD;
  const roomH = frame.height - 2 * PAD - frame.titleH - GAP;
  const natural = columns * RULE_COLUMN_W + (columns - 1) * RULE_COLUMN_GAP;
  const host = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const key = `${columns}|${rules.map((r) => `${r.name}\u0000${r.description}`).join("\u0001")}`;
  useLayoutEffect(() => {
    const el = host.current;
    if (!enabled || !el) return;
    const measure = () => setHeight(el.offsetHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    void document.fonts.ready.then(measure);
    return () => observer.disconnect();
  }, [enabled, key]);
  // As big as fills the frame across, but no more than VIDEO_TEXT times its size in an image; if that is too tall, smaller
  // still, and then laid out wider so it fills the frame across again (wider is never taller, so it still fits).
  const fill = roomW / natural;
  const s0 = Math.min(fill, VIDEO_TEXT);
  const scale = s0 * fitScale(height * s0, roomH);
  const width = scale < s0 && scale < fill ? roomW / scale : natural;
  const measure = enabled ? (
    <div className="team-page-measure" aria-hidden>
      <div ref={host}><RulesetList rules={rules} columns={columns} /></div>
    </div>
  ) : null;
  return { measure, enabled, columns, scale, width, ms: options.seconds === null ? rulesetPageMs(rules.length) : options.seconds * 1000 };
}

/** The page at the frame's exact size: the title strip over the rules. */
export function RulesetPageView({ rules, frame, run, page, ref }: {
  rules: readonly Rule[];
  frame: PageFrame;
  run: { name: string; route: RunRoute | null };
  page: Pick<RulesetPageState, "columns" | "scale" | "width">;
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className={`team-page ruleset-page${frame.portrait ? " team-page-tall" : ""}`} style={{ width: frame.width, height: frame.height, gridTemplateRows: `${frame.titleH}px minmax(0, 1fr)` }}>
      <header className="replay-stage-title">
        <CardBanner title={`${run.name} · Ruleset`} icon={<RunIcon route={run.route} />} />
        <div className="replay-stage-meta">
          <span className="replay-stage-facts">{plural(rules.length, "rule")}</span>
          <span className="replay-stage-credit">Divine Pulse <span>· by Adombs</span></span>
        </div>
      </header>
      <div className="team-page-body ruleset-page-body">
        <div style={{ flex: "none", width: page.width * page.scale }}>
          <div style={{ width: page.width, transform: `scale(${page.scale})`, transformOrigin: "0 0" }}>
            <RulesetList rules={rules} columns={page.columns} width={page.width} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The option in the video's Team tab: whether the ruleset page is in, where, and for how long. */
export function RulesetPageSection({ options, update, rules, page }: {
  options: RulesetPageOptions;
  update: (patch: Partial<RulesetPageOptions>) => void;
  rules: readonly Rule[] | null;
  page: RulesetPageState;
}) {
  if (rules === null) return <p className="export-note">Reading the run's ruleset…</p>;
  if (!rules.length) return <p className="export-note">This run has no rules yet. Add them under Ruleset on the Runs page.</p>;
  const choice = (
    <div className="team-pages-choice">
      <label>
        <input type="checkbox" checked={options.show} onChange={(e) => update({ show: e.target.checked })} />
        Ruleset page
      </label>
      {options.show && <Segmented<Placement> size="mini" label="Ruleset page placement" value={options.at} onChange={(at) => update({ at })} options={PLACEMENTS} />}
      {options.show && <small className="team-pages-count" aria-live="polite">{plural(rules.length, "rule")}, {fmtSeconds(page.ms / 1000)}</small>}
    </div>
  );
  return (
    <>
      {choice}
      {options.show && (
        <div className="team-pages-grid">
          <SecondsSlider label="On screen" value={options.seconds} auto={fmtSeconds(rulesetPageMs(rules.length) / 1000)} onChange={(seconds) => update({ seconds })} />
        </div>
      )}
    </>
  );
}
