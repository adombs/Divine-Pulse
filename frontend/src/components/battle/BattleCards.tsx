/**
 * The run's battles as cards, newest first: the latest few inline, every one (searchable, filterable) in a window.
 * Each card shows the map as it ended beside the result and the key numbers.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { Battle, Unit } from "../../api";
import { EmptyState, Section } from "../layout";
import { Icon } from "../Icon";
import { FilterLabel } from "../FilterLabel";
import { Modal } from "../Modal";
import { Portrait } from "../ui";
import { CheckChips, CheckList, FilterChip, FilterMenu, NoMatches, SearchBox, Segmented } from "../common";
import { clock, plural } from "../../format";
import { useNav } from "../../nav";
import { Board, boardNow, hasMap } from "./map";
import { isLost } from "./marks";
import { Minimap, Zoom } from "./Minimap";
import { battleName, KINDS, KIND_LABEL, KIND_PLURAL, routeOf, searchText, type Kind } from "./scenarios";
import "./battle-filters.css";
import "./battle-kinds.css";

/** Cards shown inline, the battle in progress among them. */
const LATEST = 3;
const FACES = 5;

type Sort = "newest" | "oldest" | "longest" | "turns";
type Part = "any" | "1" | "2";
type Tri = "any" | "yes" | "no";
interface BattleFilters {
  kinds: Kind[];
  flawless: boolean;
  pulse: Tri;
  part: Part;
}
const NO_BATTLE_FILTERS: BattleFilters = { kinds: [], flawless: false, pulse: "any", part: "any" };
const KIND_OPTIONS = KINDS.map((k) => [k, KIND_PLURAL[k]] as const);
const SORTS = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["longest", <FilterLabel key="longest" icon={CONCEPT_ICON.speed}>Longest</FilterLabel>],
  ["turns", <FilterLabel key="turns" icon={CONCEPT_ICON.turn}>Most turns</FilterLabel>],
] as const;

const lost = (b: Battle) => b.units.filter(isLost).length;

/** Which half of the game a battle belongs to; undefined when its scenario doesn't say. */
function partOf(b: Battle): "1" | "2" | undefined {
  if (b.scenario !== null && b.scenario !== undefined && b.scenario <= 12) return "1";
  return routeOf(b) ? "2" : undefined;
}

function passes(f: BattleFilters, b: Battle): boolean {
  if (f.kinds.length) {
    const kind = battleName(b).kind;
    if (!kind || !f.kinds.includes(kind)) return false;
  }
  if (f.flawless && lost(b) > 0) return false;
  if (f.pulse !== "any" && (b.divine_pulses > 0) !== (f.pulse === "yes")) return false;
  if (f.part !== "any" && partOf(b) !== f.part) return false;
  return true;
}

function compare(sort: Sort, a: Battle, b: Battle): number {
  const byDate = Date.parse(b.started_at) - Date.parse(a.started_at);
  if (sort === "oldest") return -byDate;
  if (sort === "longest") return b.seconds - a.seconds || byDate;
  if (sort === "turns") return (b.turn ?? -1) - (a.turn ?? -1) || byDate;
  return byDate;
}

interface Props {
  history: Battle[] | null;
  live: Battle | null;
  roster: Map<string, Unit>;
  part2: boolean;
  /** Lets the app retain a selected recording while the user visits other pages. */
  onOpenRecording?: (battle: Battle) => void;
  onStats?: () => void;
}

export function BattleCards({ history, live, roster, part2, onOpenRecording, onStats }: Props) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<BattleFilters>(NO_BATTLE_FILTERS);
  const [sort, setSort] = useState<Sort>("newest");
  const [open, setOpen] = useState(false);
  // Stable, so the window doesn't take focus back from its search box on every keystroke.
  const close = useCallback(() => setOpen(false), []);
  const heading = <span className="history-stats-heading">Battles{onStats && <button type="button" className="btn small" onClick={onStats} aria-label="Run battle statistics"><Icon name={CONCEPT_ICON.history} /> Stats</button>}</span>;
  if (history === null) return <Section title={heading}><p className="muted" role="status">Loading battles…</p></Section>;
  if (!live && history.length === 0)
    return (
      <Section title={heading}><EmptyState title="No battles yet in this run">
        Battles are recorded while the tracker reads the game. Each one is filed here when it ends.
      </EmptyState></Section>
    );
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const count = filters.kinds.length + (filters.flawless ? 1 : 0) + (filters.pulse !== "any" ? 1 : 0) + (filters.part !== "any" ? 1 : 0);
  const narrowed = words.length > 0 || count > 0;
  const matches = history
    .filter((b) => passes(filters, b) && words.every((w) => searchText(b).includes(w)))
    .sort((a, b) => compare(sort, a, b));
  const reset = () => {
    setQuery("");
    setFilters(NO_BATTLE_FILTERS);
  };
  const set = (patch: Partial<BattleFilters>) => setFilters({ ...filters, ...patch });
  const latest = history.slice(0, LATEST - (live ? 1 : 0));
  const card = (b: Battle, onOpened?: () => void) => (
    <BattleCard key={b.id} battle={b} roster={roster} part2={part2} onOpened={onOpened} onOpenRecording={onOpenRecording} />
  );
  return (
    <Section
      title={heading}
      right={
        history.length > 0 && (
          <button type="button" className="btn small" onClick={() => setOpen(true)}>
            <Icon name={CONCEPT_ICON.log} /> All battles ({history.length})
          </button>
        )
      }
    >
      <ul className="card-grid latest">
        {live && <BattleCard battle={live} live roster={roster} part2={part2} onOpenRecording={onOpenRecording} />}
        {latest.map((b) => card(b))}
      </ul>
      <Modal open={open} onClose={close} title="All Battles" wide>
        <div className="toolbar">
          <span className="battle-count">{plural(matches.length, "Battle")}</span>
          <SearchBox value={query} onChange={setQuery} placeholder="Search battles, places, units" />
          <FilterMenu
            count={count}
            onClear={() => setFilters(NO_BATTLE_FILTERS)}
            chips={
              <>
                <CheckChips options={KIND_OPTIONS} value={filters.kinds} onChange={(kinds) => set({ kinds })} />
                {filters.flawless && <FilterChip onClear={() => set({ flawless: false })}>Flawless</FilterChip>}
                {filters.pulse !== "any" && (
                  <FilterChip onClear={() => set({ pulse: "any" })}><FilterLabel icon={CONCEPT_ICON.pulse}>{filters.pulse === "yes" ? "Divine Pulse used" : "No Divine Pulse"}</FilterLabel></FilterChip>
                )}
                {filters.part !== "any" && <FilterChip onClear={() => set({ part: "any" })}>Part {filters.part === "1" ? "I" : "II"}</FilterChip>}
              </>
            }
          >
            <div className="battle-filter-fields">
              <CheckList<Kind> label="Kind" columns={2} options={KIND_OPTIONS} value={filters.kinds} onChange={(kinds) => set({ kinds })} />
              <Field label="Units lost">
                <Segmented
                  label="Units lost"
                  size="mini"
                  value={filters.flawless ? "flawless" : "any"}
                  options={[["any", "Any"], ["flawless", "Flawless"]] as const}
                  onChange={(v) => set({ flawless: v === "flawless" })}
                />
              </Field>
              <Field label="Divine Pulse">
                <Segmented
                  label="Divine Pulse"
                  size="mini"
                  value={filters.pulse}
                  options={[["any", "Any"], ["yes", <FilterLabel key="used" icon={CONCEPT_ICON.pulse}>Used</FilterLabel>], ["no", <FilterLabel key="unused" icon={CONCEPT_ICON.pulse}>Not used</FilterLabel>]] as const}
                  onChange={(pulse) => set({ pulse })}
                />
              </Field>
              <Field label="Part">
                <Segmented
                  label="Part"
                  size="mini"
                  value={filters.part}
                  options={[["any", "Any"], ["1", "I"], ["2", "II"]] as const}
                  onChange={(part) => set({ part })}
                />
              </Field>
              <Field label="Sort">
                <Segmented label="Sort" size="mini" value={sort} options={SORTS} onChange={setSort} />
              </Field>
            </div>
          </FilterMenu>
        </div>
        <ul className="card-grid">
          {live && !narrowed && sort === "newest" && <BattleCard battle={live} live roster={roster} part2={part2} onOpened={close} onOpenRecording={onOpenRecording} />}
          {matches.map((b) => card(b, close))}
        </ul>
        {narrowed && matches.length === 0 && (
          <NoMatches
            what="battles"
            onReset={reset}
          />
        )}
      </Modal>
    </Section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="checklist">
      <legend>{label}</legend>
      {children}
    </fieldset>
  );
}

function BattleCard({
  battle: b,
  live,
  roster,
  part2,
  onOpened,
  onOpenRecording,
}: {
  battle: Battle;
  live?: boolean;
  roster: Map<string, Unit>;
  part2: boolean;
  /** Called as the card opens its battle (closes the window it's in). */
  onOpened?: () => void;
  onOpenRecording?: (battle: Battle) => void;
}) {
  const nav = useNav();
  const name = battleName(b);
  const fell = lost(b);
  const tone = live ? "live" : name.kind ?? "unknown";
  const open = () => {
    onOpened?.();
    if (live) nav.go({ page: "battle" });
    else {
      onOpenRecording?.(b);
      nav.go({ page: "battle", id: b.id });
    }
  };
  const deployed = b.units.filter((u) => !u.adjutant_of);
  return (
    <li className={`battle-card ${tone}`}>
      <div className="bc-thumb">
        <Thumb battle={b} part2={part2} />
        {live && <span className="bc-live">Live</span>}
      </div>
      <div className="bc-body">
        <h3 className="bc-title">
          <button type="button" className="bc-open" onClick={open} title={name.title}>
            {name.title}
          </button>
        </h3>
        <p className="bc-meta">
          {name.place && <span>{name.place}</span>}
          <time className="bc-date" dateTime={b.started_at}>{shortDate(b.started_at)}</time>
        </p>
        <dl className="bc-stats">
          <Stat label="Turns" value={b.turn ?? "—"} />
          <Stat label="Time" value={clock(b.seconds)} />
          <Stat label="Killed" value={b.enemies_defeated ?? "—"} />
          <Stat label="Lv-ups" value={b.level_ups} />
        </dl>
        {(b.divine_pulses > 0 || fell > 0) && (
          <p className="bc-flags">
            {b.divine_pulses > 0 && <span className="bc-flag pulse">{plural(b.divine_pulses, "Divine Pulse")}</span>}
            {fell > 0 && <span className="bc-flag fell">{fell} fell</span>}
          </p>
        )}
        <div className="bc-foot">
          <span className="bc-faces" aria-label={`${plural(deployed.length, "unit")}: ${deployed.map((u) => u.name).join(", ")}`}>
            {deployed.slice(0, FACES).map((u) => {
              const unit = roster.get(u.key);
              return (
                <span key={u.key} className={`bc-face ${u.on_map ? "" : "gone"}`} title={u.on_map ? u.name : `${u.name} (fell)`}>
                  {unit ? <Portrait unit={unit} part2={part2} size={22} /> : <span className="bc-initial">{u.name[0]}</span>}
                </span>
              );
            })}
            {deployed.length > FACES && <span className="bc-face more">+{deployed.length - FACES}</span>}
          </span>
          {name.kind && <span className="bc-kind" title={KIND_LABEL[name.kind]}>{KIND_LABEL[name.kind].replace(/ Battle$/, "")}</span>}
        </div>
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** The map as the battle ended (or stands, when live); a crest when no position was read. */
function Thumb({ battle, part2 }: { battle: Battle; part2: boolean }) {
  const board = useMemo(() => (hasMap(battle) ? boardNow(battle) : null), [battle]);
  const zoom = useMemo(() => (board ? closeUp(board) : null), [board]);
  if (!board)
    return (
      <div className="bc-blank" aria-hidden>
        <svg viewBox="0 0 40 48">
          <path d="M20 4 34 10v12c0 10-6 17-14 22C12 39 6 32 6 22V10Z" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path d="M20 13 26 22 20 35 14 22Z" fill="currentColor" opacity=".85" />
        </svg>
      </div>
    );
  return (
    <div className="bc-map" aria-hidden inert>
      <Minimap board={board} size="compact" part2={part2} label="" zoom={zoom} />
    </div>
  );
}

/** The thumbnail's shape, square like its frame, and the fewest tiles across it shows. */
const ASPECT = 1;
const MIN_TILES = 10;

/** The part of the map around the units still standing (all of them when none are), in the thumbnail's shape. */
function closeUp(board: Board): Zoom | null {
  const standing = board.pieces.filter((p) => !p.down);
  const pieces = standing.length ? standing : board.pieces;
  if (!pieces.length) return null;
  const xs = pieces.map((p) => p.x);
  const ys = pieces.map((p) => p.y);
  const pad = 1.5;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  let w = Math.max(...xs) + 1 + pad - x0;
  let h = Math.max(...ys) + 1 + pad - y0;
  w = Math.max(w, h * ASPECT, MIN_TILES);
  h = w / ASPECT;
  w = Math.min(w, board.w);
  h = Math.min(h, board.h);
  if (w >= board.w && h >= board.h) return null;
  const cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys) + 1) / 2;
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  return { w, h, x0: clamp(cx - w / 2, board.w - w), y0: clamp(cy - h / 2, board.h - h) };
}

/** When the battle started: mm/dd/yyyy and the time ("11/09/2026 2:33 AM"). */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${time}`;
}
