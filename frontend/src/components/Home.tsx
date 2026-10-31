/**
 * The home page, built around the throne: DIVINE [chair] PULSE, then the latest run underneath its staircase.
 * Older runs are in the load dialog. The tracker always opens here: other pages showing a run's
 * data stay hidden until one is loaded.
 */
import { FormEvent, useState } from "react";
import { api, BestUnit, RunSummary } from "../api";
import { useNav } from "../nav";
import { MAX_LEN, cleanText, runNameError } from "../validation";
import { CONCEPT_ICON } from "../icons/concepts";
import { faceUrl } from "../portraits";
import { Icon } from "./Icon";
import { PortraitImage } from "./GameImage";
import { Modal } from "./Modal";
import { RunIcon } from "./ui";
import { SpriteIndex, UnitSprite, spriteLayers, useSprites } from "./battle/mapIcons";
import { chapterTitle } from "./battle/scenarios";
import { ToastState } from "./Toasts";
import "@fontsource/cinzel/400.css";
import "@fontsource/cinzel/700.css";
import "./home.css";

export interface HomeProps {
  runs: RunSummary[];
  activeRunId: string | null;
  /** Whether a run is loaded this session; until then Continue loads the last active run. */
  loaded: boolean;
  toasts: ToastState;
  onSwitchRun: (id: string) => Promise<void>;
  onRunsChanged: () => void;
}

export const played = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Longer names than this are set smaller and may take two lines, as the design does for a long title. */
const LONG_NAME = 22;

export function Home({ runs, activeRunId, loaded, toasts, onSwitchRun, onRunsChanged }: HomeProps) {
  const nav = useNav();
  const sprites = useSprites();
  const ordered = [...runs].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const latest = ordered[0] ?? null;
  const others = ordered.slice(1);
  const [picking, setPicking] = useState(false);
  // The new-run form opens when picked, and on its own while there are no runs to load.
  const [adding, setAdding] = useState<boolean | undefined>(undefined);
  const open = adding ?? !runs.length;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const error = name.trim() ? runNameError(name, runs) : null;

  const enter = () => {
    if (!(nav.route.page === "battle" && nav.route.id)) nav.go({ page: "roster" });
  };

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || error || busy) return;
    setBusy("new");
    try {
      const run = await api.createRun(cleanText(name));
      await onSwitchRun(run.id);
      onRunsChanged();
      enter();
    } catch (err) {
      toasts.push({ kind: "error", title: "Couldn't create the run", body: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const load = async (id: string) => {
    if (busy) return;
    if (id === activeRunId && loaded) return enter();
    setBusy(id);
    try {
      await onSwitchRun(id);
      setPicking(false);
      enter();
    } catch (err) {
      toasts.push({ kind: "error", title: "Couldn't load the run", body: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="home-page">
      <div className="home-stage">
        <header className="home-head">
          <div className="home-glow" aria-hidden />
          <h1 className="home-title" aria-label="Divine Pulse">
            <span className="home-word">DIVINE</span>
            <img className="home-chair" src="/brand/home-chair.png" alt="" draggable={false} />
            <span className="home-pulse">
              <span className="home-word">PULSE</span>
              <span className="home-byline">BY ADOMBS</span>
            </span>
          </h1>
        </header>
        <div className="home-steps">
          {latest && (
            <button type="button" className="home-run" disabled={!!busy} aria-busy={busy === latest.id} onClick={() => load(latest.id)}>
              <RunDetails run={latest} sprites={sprites} />
            </button>
          )}
          {open && (
            <form className="home-new" onSubmit={start}>
              <label htmlFor="new-run-name">New run</label>
              <div className="home-new-row">
                <input
                  id="new-run-name"
                  className={error ? "invalid" : ""}
                  value={name}
                  maxLength={MAX_LEN.runName + 10}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Run name, e.g. “Azure Moon, Hard”"
                  aria-invalid={!!error}
                  autoFocus={runs.length > 0}
                />
                <button type="submit" className="btn primary" disabled={!!busy || !name.trim() || !!error}>
                  {busy === "new" ? "Starting…" : "Start run"}
                </button>
                {runs.length > 0 && (
                  <button type="button" className="btn" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                )}
              </div>
              {error && <p className="field-hint error">{error}</p>}
            </form>
          )}
          <div className="home-stairs">
            <button type="button" className="home-stair" disabled={!others.length || !!busy} aria-haspopup="dialog" onClick={() => setPicking(true)}>
              <Icon name={CONCEPT_ICON.runs} /> LOAD A RUN
            </button>
            <button type="button" className="home-stair" aria-expanded={open} onClick={() => setAdding(true)}>
              <Icon name={CONCEPT_ICON.add} /> START A NEW RUN
            </button>
          </div>
          <button type="button" className="home-stair home-settings" onClick={() => nav.go({ page: "settings" })}>
            <Icon name={CONCEPT_ICON.settings} /> SETTINGS
          </button>
        </div>
      </div>
      <Modal open={picking} onClose={() => setPicking(false)} title="Load a run" className="home-run-picker">
        <div className="home-stage home-saved-runs">
          {others.map((run) => (
            <button key={run.id} type="button" className="home-run" disabled={!!busy} aria-busy={busy === run.id} onClick={() => load(run.id)}>
              <RunDetails run={run} sprites={sprites} />
            </button>
          ))}
        </div>
      </Modal>
    </section>
  );
}

/** A run's shield, name, where it is in the story, its numbers and its best unit. */
function RunDetails({ run, sprites }: { run: RunSummary; sprites: SpriteIndex | null }) {
  const chapter = run.last_chapter && chapterTitle(run.last_chapter.scenario, run.last_chapter.name, run.route);
  return (
    <>
      <span className="home-banner"><RunIcon route={run.route} /></span>
      <span className="home-details">
        <span className={`home-name${run.name.length > LONG_NAME ? " long" : ""}`} title={run.name}>
          {run.name}
        </span>
        {(chapter || !run.battle_count) && <span className="home-chapter">{chapter || "No battles yet"}</span>}
        <span className="home-facts">
          <span>
            <b>{run.unit_count}</b> {run.unit_count === 1 ? "unit" : "units"}
          </span>
          <span>
            <b>{run.battle_count}</b> {run.battle_count === 1 ? "battle" : "battles"}
          </span>
          <span>Last played {played(run.updated_at)}</span>
        </span>
      </span>
      {run.best_unit && <BestUnitSprite unit={run.best_unit} sprites={sprites} />}
    </>
  );
}

/** The part of a sprite's 32x38 atlas cell its art fills, in pixels: x, y, width and height (on foot, and on a mount).
 * Framing that rather than the mostly empty cell gives the sprite the design's height; a stray weapon tip may stick out
 * of the frame, but it isn't cut off. */
const ON_FOOT = [4, 13, 24, 24];
const MOUNTED = [2, 6, 30, 30];

/** The run's best unit: its map sprite, or its portrait when the sprite atlases have no sprite for it (a battle saved
 * before class IDs were kept). Nothing while the sprite index loads, or when neither exists. */
function BestUnitSprite({ unit, sprites }: { unit: BestUnit; sprites: SpriteIndex | null }) {
  const layers = sprites && spriteLayers(sprites, { classId: unit.class_id, female: unit.female, side: "player", character: unit.character, look: unit.look }, true);
  const portrait = sprites && !layers && faceUrl({ character: unit.character, classId: unit.class_id, female: unit.female, name: unit.name, seed: unit.key }, false);
  // UnitSprite draws in tiles, a tile as wide as the cell, with the cell's bottom on the tile's.
  const frame = () => {
    const [w, h] = sprites!.cell;
    const [x, y, fw, fh] = layers!.mounted ? MOUNTED : ON_FOOT;
    return `${x / w} ${(y - (h - w)) / w} ${fw / w} ${fh / w}`;
  };
  return (
    <span className="home-best" title={`${unit.name} — Best unit: 1,000 points per battle MVP, plus damage dealt and healing done in completed battles.`}>
      {sprites && layers && (
        <svg viewBox={frame()} aria-hidden>
          <UnitSprite index={sprites} layers={layers} side="player" />
        </svg>
      )}
      {portrait && <PortraitImage bundled={portrait} fallback={null} alt="" draggable={false} />}
    </span>
  );
}
