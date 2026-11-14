/**
 * Export a battle's replay as an MP4 video (the battle page's header, beside Copy Summary). A window previews the video
 * as it will be: a title strip, the map with the turn in its corner (no legend), and the log as a list beside it
 * (16:9, 1.91:1) or under it (9:16, 4:5), the log showing what has happened up to the step on the map. Beside the preview:
 * the aspect ratio (16:9, 1.91:1, 9:16 or 4:5), the turns to cover, the replay's own speed, camera and zoom (the map's controls), the battle theme
 * to play under it (music.ts), and the video's resolution, frame rate and quality.
 *
 * The preview and the video run on one clock (ms into the video): each moment poses the replay (`useReplay`'s manual
 * mode) at a beat and how far into it, and the camera is worked out from the same moment, so the video is the preview
 * frame for frame. Exporting draws each frame of the preview (snapshot.ts) and encodes it (video.ts).
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import "./replay-export.css";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Battle, RunRoute, Unit } from "../../api";
import { clock } from "../../format";
import { Icon, IconButton } from "../Icon";
import { Modal } from "../Modal";
import { ExportActions, type ExportStatus } from "../ExportActions";
import { NotchedRange, RangeSlider } from "../Slider";
import { CardBanner, RunIcon, Segmented } from "../ui";
import { StepSlider } from "../Slider";
import { snapshotter, type Layer } from "../../exporting/snapshot";
import { savesNatively, saveFiles, safeFilename } from "../../exporting/save";
import { Cancelled, canEncode, encodeVideo, type VideoQuality } from "../../exporting/video";
import { sceneAt, type Segment } from "../../exporting/teamPages";
import { CUSTOM_ID, customSoundtrack, defaultTheme, loadCustomAudio, loadMusic, previewTheme, recording, releaseCustomAudio, setPreviewVolume, soundtrack, THEME_GROUPS, type CustomAudio, type Music, type Theme, type Version } from "../../exporting/music";
import { CameraMode, CameraModeSwitch, DEFAULT_ZOOM, ZOOM_TILES, ZoomSlider, ZoomValue, zoomText } from "./camera";
import { chronicle, type Chronicle } from "./chronicle";
import { hasMap } from "./map";
import { Minimap, type Zoom } from "./Minimap";
import { ItemList, useBattleNav } from "./parts";
import { beatDurations, beatFocus, beatOf, ReplayBanner, ReplaySpeedSlider, useReplay } from "./replay";
import { battleName, KIND_LABEL } from "./scenarios";
import { api } from "../../api";
import { sanitizeRules, type Rule } from "../../ruleset";
import { DEFAULT_RULESET_PAGE, RulesetPageSection, RulesetPageView as RulesetPageViewPlain, sanitizeRulesetPage, useRulesetPage, type RulesetPageOptions } from "./RulesetPage";
import { DEFAULT_TEAM_PAGES, sanitizeTeamPages, TeamPagesSection, TeamPageView as TeamPageViewPlain, useTeamPages, type PageFrame, type TeamPage, type TeamPagesOptions } from "./TeamPages";

/** No rules (one array, so the views it is passed to keep still). */
const NO_RULES: Rule[] = [];

/** A page's view is redrawn only when its page changes, not with every frame of the preview's clock. */
const TeamPageView = memo(TeamPageViewPlain);
const RulesetPageView = memo(RulesetPageViewPlain);

/** The frame's shape: 16:9, 1.91:1 (`wide`, laid out like 16:9), 9:16, or 4:5 (`feed`, laid out like 9:16). */
type Orientation = "landscape" | "wide" | "portrait" | "feed";
const ORIENTATIONS: readonly Orientation[] = ["landscape", "wide", "portrait", "feed"];
/** Whether a frame has the log beside the map (the wide ones) rather than under it. */
const logBeside = (o: Orientation) => o === "landscape" || o === "wide";

/** The video's frame in CSS pixels; it is drawn at a resolution's scale times that (1.5: 1920 × 1080). */
const STAGE: Record<Orientation, [number, number]> = { landscape: [1280, 720], wide: [1376, 720], portrait: [720, 1280], feed: [720, 900] };
/** The resolutions offered, by their short side, and the scale each draws the frame at. */
const RESOLUTIONS: [number, string, number][] = [
  [720, "720p HD", 1],
  [1080, "1080p Full HD", 1.5],
  [1440, "1440p Quad HD", 2],
  [2160, "4K Ultra HD", 3],
];
const QUALITIES: [VideoQuality, string][] = [["standard", "Standard (smaller file)"], ["high", "High"], ["best", "Best (bigger file)"]];
/** The last step stays on screen this long at the end of the video (ms). */
const END_HOLD_MS = 2000;
/** How long a dynamic camera takes to glide to the next step's action (ms), as on the battle map. */
const CAMERA_MS = 280;

const ORIENTATION_KEY = "divine-pulse-export-orientation";
const OPTIONS_KEY = "divine-pulse-export-video";

/** The groups of options, as tabs across the top of the options panel. */
type ExportTab = "format" | "replay" | "team" | "music";
const TABS: [ExportTab, string][] = [["format", "Format"], ["replay", "Replay"], ["team", "Team"], ["music", "Music"]];

/** The video's own options, remembered between exports. */
interface VideoOptions {
  /** The tab the options panel was last on. */
  tab: ExportTab;
  resolution: number;
  fps: 30 | 60;
  quality: VideoQuality;
  /** Which version of the battle theme plays under the video. */
  version: Version;
  /** The music's volume: a whole number of percent, 0 to 100. */
  volume: number;
  /** The team's overview shown before and after the replay (TeamPages.tsx). */
  team: TeamPagesOptions;
  /** The run's ruleset shown before or after the replay (RulesetPage.tsx). */
  rules: RulesetPageOptions;
}
const DEFAULT_OPTIONS: VideoOptions = { tab: "format", resolution: 1080, fps: 30, quality: "high", version: "rain", volume: 75, team: DEFAULT_TEAM_PAGES, rules: DEFAULT_RULESET_PAGE };

function loadOptions(): VideoOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}") as Partial<VideoOptions>;
    return {
      tab: TABS.find(([t]) => t === saved.tab)?.[0] ?? DEFAULT_OPTIONS.tab,
      resolution: RESOLUTIONS.some(([r]) => r === saved.resolution) ? saved.resolution! : DEFAULT_OPTIONS.resolution,
      fps: saved.fps === 60 ? 60 : 30,
      quality: QUALITIES.some(([q]) => q === saved.quality) ? saved.quality! : DEFAULT_OPTIONS.quality,
      version: saved.version === "thunder" ? "thunder" : "rain",
      volume: Number.isInteger(saved.volume) && saved.volume! >= 0 && saved.volume! <= 100 ? saved.volume! : DEFAULT_OPTIONS.volume,
      team: sanitizeTeamPages(saved.team),
      rules: sanitizeRulesetPage(saved.rules),
    };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

/** A video frame's two layers (snapshot.ts `Layer`). The chrome: the title, the log and the map's frame, without the
 * map or anything over it. The map: the map with its turn banner and rewind badge, over a see-through frame. */
const CHROME_LAYER: Layer = { hide: [".replay-stage-map .minimap"], remove: [".replay-banner", ".rewind-badge"] };
const MAP_LAYER: Layer = {
  hide: [".replay-stage-title", ".replay-stage-log"],
  styles: "map",
  css: ".replay-stage { background: none !important; box-shadow: none !important; }",
};

function loadOrientation(): Orientation {
  try {
    const kept = localStorage.getItem(ORIENTATION_KEY);
    return ORIENTATIONS.find((o) => o === kept) ?? "landscape";
  } catch {
    return "landscape";
  }
}

/** Whether a battle has a replay to export, and if not, why. */
export function replayExportBlocker(battle: Battle, chron: Chronicle): string | null {
  if (!hasMap(battle)) return "No positions were read for this battle, so there's no map to replay";
  if (!chron.beats.length) return "This battle has no steps to replay";
  return null;
}

/** The header button: opens the export window. */
export function ReplayExportButton({ battle, route, runName, units, part2, history }: {
  battle: Battle;
  route?: RunRoute | null;
  /** The run's name, its roster and battles, for the team pages. */
  runName?: string;
  units: Unit[];
  part2: boolean;
  history: Battle[];
}) {
  const [open, setOpen] = useState(false);
  const chron = useMemo(() => chronicle(battle), [battle]);
  const blocker = replayExportBlocker(battle, chron);
  return (
    <>
      <button
        type="button"
        className="btn small"
        onClick={() => setOpen(true)}
        disabled={!!blocker}
        title={blocker ?? "Save the replay as an MP4 video, to share"}
      >
        <Icon name={CONCEPT_ICON.share} /> Export Video
      </button>
      {open && <ReplayExportDialog battle={battle} chron={chron} route={route ?? null} runName={runName ?? "Divine Pulse"} units={units} part2={part2} history={history} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The frame's padding, the gap between its parts, the title strip's height (a line taller in the narrow frames), the map
 * frame's own padding and border, and the least room the log keeps (px). */
const PAD = 16;
const GAP = 12;
const TITLE_H: Record<Orientation, number> = { landscape: 46, wide: 46, portrait: 76, feed: 76 };
const MAP_FRAME = 14;
const LOG_MIN: Record<Orientation, number> = { landscape: 380, wide: 380, portrait: 360, feed: 240 };

/** The most room the map can have: the whole height (log beside) or width (log under) and all but the log's least. */
function mapRoom(orientation: Orientation): [number, number] {
  const [width, height] = STAGE[orientation];
  const innerW = width - 2 * PAD;
  const innerH = height - 2 * PAD - TITLE_H[orientation] - GAP;
  return logBeside(orientation)
    ? [innerW - GAP - LOG_MIN[orientation] - MAP_FRAME, innerH - MAP_FRAME]
    : [innerW - MAP_FRAME, innerH - GAP - LOG_MIN[orientation] - MAP_FRAME];
}

/**
 * The camera's view in tiles at a zoom level: the whole map zoomed out; zoomed in, `tiles` along the map's short side
 * of the frame and as many along the long side as the room there holds, so the map fills all the room it can.
 */
function viewSize(orientation: Orientation, tiles: number, board: { w: number; h: number }): [number, number] {
  if (!tiles) return [board.w + 0.3, board.h + 0.3];
  const [w, h] = mapRoom(orientation);
  const across = logBeside(orientation) ? tiles * (w / h) : tiles;
  const down = logBeside(orientation) ? tiles : tiles * (h / w);
  return [Math.min(across, board.w), Math.min(down, board.h)];
}

/** The view `size` tiles big centred on (cx, cy), kept inside the map (null: the whole map is in view). */
function viewAround([cx, cy]: [number, number], [w, h]: [number, number], board: { w: number; h: number }): Zoom | null {
  if (w >= board.w && h >= board.h) return null;
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  return { w, h, x0: clamp(cx - w / 2, board.w - w), y0: clamp(cy - h / 2, board.h - h) };
}

/**
 * The rows and columns of a frame: the title strip across the top, then the map on the left and the log beside it
 * (16:9, 1.91:1), or the map and the log under it (9:16, 4:5). The map gets what its view's shape needs (`aspect`, its
 * width over its height) of the room `mapRoom` allows; the log, the rest.
 */
function stageLayout(orientation: Orientation, aspect: number): { columns: string; rows: string } {
  const [w, h] = mapRoom(orientation);
  if (logBeside(orientation)) {
    const mapW = Math.round(Math.min(h * aspect, w) + MAP_FRAME);
    return { columns: `${mapW}px minmax(0, 1fr)`, rows: `${TITLE_H[orientation]}px minmax(0, 1fr)` };
  }
  const mapH = Math.round(Math.min(w / aspect, h) + MAP_FRAME);
  return { columns: "minmax(0, 1fr)", rows: `${TITLE_H[orientation]}px ${mapH}px minmax(0, 1fr)` };
}

/** A stretch of the video: the replay, a team page, or the ruleset page. */
type Part = { kind: "replay" } | { kind: "page"; page: TeamPage } | { kind: "rules" };
/** A picture's id among the documents drawn for the video. */
const pictureId = (part: Part) => (part.kind === "page" ? part.page.id : part.kind);

/** Where the video stands: a beat, and how far into it (ms). */
interface Moment {
  beat: number;
  elapsed: number;
}

/** The middle of the tiles a camera follows (the map's middle when there are none), as useMapCamera centres them. */
function centre(follow: [number, number][], w: number, h: number): [number, number] {
  if (!follow.length) return [w / 2, h / 2];
  const xs = follow.map(([x]) => x + 0.5);
  const ys = follow.map(([, y]) => y + 0.5);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

const easeOut = (k: number) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;

function ReplayExportDialog({ battle, chron, route, runName, units, part2, history, onClose }: {
  battle: Battle;
  chron: Chronicle;
  route: RunRoute | null;
  runName: string;
  units: Unit[];
  part2: boolean;
  history: Battle[];
  onClose: () => void;
}) {
  const nav = useBattleNav();
  const [options, setOptionsState] = useState<VideoOptions>(loadOptions);
  const keep = (next: VideoOptions) => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {
      // Not kept; fine.
    }
    return next;
  };
  const setOption = <K extends keyof VideoOptions>(key: K, value: VideoOptions[K]) => setOptionsState((o) => keep({ ...o, [key]: value }));
  const updateTeam = (patch: Partial<TeamPagesOptions>) => setOptionsState((o) => keep({ ...o, team: { ...o.team, ...patch } }));
  const updateRules = (patch: Partial<RulesetPageOptions>) => setOptionsState((o) => keep({ ...o, rules: { ...o.rules, ...patch } }));
  // The run's ruleset, for its page.
  const [rules, setRules] = useState<Rule[] | null>(null);
  useEffect(() => {
    let live = true;
    api.ruleset(battle.run_id).then((r) => { if (live) setRules(sanitizeRules(r.rules)); }, () => { if (live) setRules([]); });
    return () => { live = false; };
  }, [battle.run_id]);
  const scale = RESOLUTIONS.find(([r]) => r === options.resolution)?.[2] ?? 1.5;
  const fps = options.fps;
  // The battle themes (imported with the game files), and the one to play: the battle's own to begin with.
  const [music, setMusic] = useState<Music | null | undefined>(undefined);
  const [themeId, setThemeId] = useState<string>("");
  const [previewing, setPreviewing] = useState(false);
  // The player's own audio, if they chose a file: decoded once, held for the previews and the export, never kept between sessions.
  const [custom, setCustom] = useState<CustomAudio | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const customRef = useRef<CustomAudio | null>(null);
  customRef.current = custom;
  useEffect(() => () => releaseCustomAudio(customRef.current), []);
  useEffect(() => {
    let live = true;
    void loadMusic().then((m) => {
      if (!live) return;
      setMusic(m);
      if (m) setThemeId(defaultTheme(m, battle.scenario).id);
    });
    return () => {
      live = false;
      previewTheme(null);
    };
  }, [battle.scenario]);
  const theme = music?.themes.find((m) => m.id === themeId) ?? null;
  // Thunder needs the game files imported again (older imports only have Rain); the toggle says so when it can't be used.
  const thunderNote = !music?.themes.some((m) => m.thunder)
    ? "Thunder isn't in your game files yet. Reprocess them (Settings > Game files) to add it."
    : theme && !theme.thunder ? "This theme has no Thunder version in your game files." : null;
  /** The version a theme plays in: the chosen one, where the theme has it. */
  const versionOf = (m: Theme): Version => (options.version === "thunder" && m.thunder ? "thunder" : "rain");
  const version: Version = theme ? versionOf(theme) : "rain";
  const track = theme ? recording(theme, version) : null;
  const volume = options.volume / 100;
  const usingCustom = themeId === CUSTOM_ID && !!custom;
  const listening = usingCustom ? { id: CUSTOM_ID, url: custom.url } : track;
  /** Takes a chosen file: decoded once; if it can't be, the choice before it stays and the reason is shown. */
  const chooseFile = async (file: File) => {
    setReading(true);
    setCustomError(null);
    try {
      const next = await loadCustomAudio(file);
      releaseCustomAudio(customRef.current);
      previewTheme(null);
      setPreviewing(false);
      setCustom(next);
      setThemeId(CUSTOM_ID);
    } catch (error) {
      setCustomError((error as Error).message || "That file couldn't be read as audio.");
    } finally {
      setReading(false);
    }
  };
  /** Lets go of the chosen file and goes back to the battle's own theme. */
  const removeCustom = () => {
    releaseCustomAudio(custom);
    previewTheme(null);
    setPreviewing(false);
    setCustom(null);
    setCustomError(null);
    if (themeId === CUSTOM_ID) setThemeId(music ? defaultTheme(music, battle.scenario).id : "");
  };
  const [orientation, setOrientationState] = useState<Orientation>(loadOrientation);
  const setOrientation = (o: Orientation) => {
    setOrientationState(o);
    try {
      localStorage.setItem(ORIENTATION_KEY, o);
    } catch {
      // Not kept; fine.
    }
  };
  const [width, height] = STAGE[orientation];
  // The team pages (before and after the replay) fill the frame; their page counts follow its shape.
  const frame = useMemo<PageFrame>(() => ({ width, height, titleH: TITLE_H[orientation], portrait: !logBeside(orientation) }), [width, height, orientation]);
  const team = options.team;
  const pages = useTeamPages({ team, update: updateTeam, units, history, battle, part2, frame });
  const pageRun = useMemo(() => ({ name: runName, route }), [runName, route]);
  const rulesPage = useRulesetPage({ options: options.rules, rules: rules ?? NO_RULES, frame });
  const rulesView = useMemo(() => ({ columns: rulesPage.columns, scale: rulesPage.scale, width: rulesPage.width }), [rulesPage.columns, rulesPage.scale, rulesPage.width]);
  const [speed, setSpeed] = useState(() => nav.replaySpeed ?? 1);
  const [mode, setModeState] = useState<CameraMode>("dynamic");
  const [level, setLevel] = useState(DEFAULT_ZOOM);
  // Where a static camera looks (the middle of its view, in tiles).
  const [still, setStill] = useState<[number, number] | null>(null);

  // The turns to cover: from the first step of `from` to the last of `to`.
  const turns = useMemo(() => [...new Set(chron.beats.map((b) => b.step.turn))].sort((a, b) => a - b), [chron.beats]);
  const [from, setFrom] = useState(turns[0] ?? 1);
  const [to, setTo] = useState(turns[turns.length - 1] ?? 1);
  const first = Math.max(0, chron.beats.findIndex((b) => b.step.turn >= from));
  const lastIndex = chron.beats.length - 1 - [...chron.beats].reverse().findIndex((b) => b.step.turn <= to);
  const last = Math.max(first, Math.min(chron.beats.length - 1, lastIndex));

  const replay = useReplay(battle, chron, { speed, manual: true });
  const durations = useMemo(() => beatDurations(battle, chron, speed), [battle, chron, speed]);
  const focus = useMemo(() => beatFocus(battle, chron), [battle, chron]);
  // When each beat in the range starts (ms into the video), and how long the video is.
  const { starts, total: replayTotal } = useMemo(() => {
    const out: number[] = [];
    let t = 0;
    for (let i = first; i <= last; i++) {
      out.push(t);
      t += durations[i];
    }
    return { starts: out, total: t + END_HOLD_MS };
  }, [durations, first, last]);
  // The video: the pages before the replay (the ruleset first), the replay, the pages after it (the ruleset last), with
  // a crossfade at each cut (sceneAt).
  const pageMs = options.team.seconds * 1000;
  const rulesAt = rulesPage.enabled ? options.rules.at : null;
  const parts = useMemo<Part[]>(() => [
    ...(rulesAt === "start" ? [{ kind: "rules" } as Part] : []),
    ...pages.start.map((page): Part => ({ kind: "page", page })),
    { kind: "replay" },
    ...pages.end.map((page): Part => ({ kind: "page", page })),
    ...(rulesAt === "end" ? [{ kind: "rules" } as Part] : []),
  ], [pages.start, pages.end, rulesAt]);
  const rulesMs = rulesPage.ms;
  const segments = useMemo<Segment[]>(
    () => parts.map((p, i) => ({ id: `${i}`, ms: p.kind === "page" ? pageMs : p.kind === "rules" ? rulesMs : replayTotal })),
    [parts, pageMs, rulesMs, replayTotal],
  );
  const replayAt = parts.findIndex((p) => p.kind === "replay");
  const lead = segments.slice(0, replayAt).reduce((sum, seg) => sum + seg.ms, 0);
  const total = segments.reduce((sum, seg) => sum + seg.ms, 0);
  /** Where the replay is (ms into it) when the video is `ms` in. */
  const replayTime = (ms: number) => Math.max(0, Math.min(replayTotal, ms - lead));

  const momentAt = (ms: number): Moment => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= ms) lo = mid;
      else hi = mid - 1;
    }
    const beat = first + lo;
    return { beat, elapsed: Math.min(durations[beat], ms - starts[lo]) };
  };

  // The clock: ms into the video, played in the preview (looping) or stepped through frame by frame to export.
  const [t, setT] = useState(0);
  const [moment, setMoment] = useState<Moment>({ beat: first, elapsed: 0 });
  const [playing, setPlaying] = useState(true);
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });
  const working = status.kind === "working";
  const seekTo = (ms: number) => {
    const m = momentAt(replayTime(Math.max(0, Math.min(total, ms))));
    setT(Math.max(0, Math.min(total, ms)));
    setMoment(m);
    replay.pose(m.beat, m.elapsed);
  };
  const seekRef = useRef(seekTo);
  seekRef.current = seekTo;

  // A new range or speed starts the preview over.
  useEffect(() => {
    seekRef.current(0);
  }, [first, last, speed]);

  useEffect(() => {
    if (!playing || working) return;
    let frame = 0;
    let before = performance.now();
    let at = t;
    const tick = (now: number) => {
      at += now - before;
      before = now;
      if (at >= total) at = 0;
      seekRef.current(at);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Restarted only when playing starts or stops, or the video's length changes; `t` is where it starts from.
  }, [playing, working, total]); // eslint-disable-line react-hooks/exhaustive-deps

  // The camera, from the moment alone: a dynamic one glides from the last step's action to this one's.
  const { board } = replay;
  const size = viewSize(orientation, ZOOM_TILES[level], board);
  const viewOf = (c: [number, number]): Zoom => viewAround(c, size, board) ?? { x0: 0, y0: 0, w: board.w, h: board.h };
  const dynamicCentre = (m: Moment): [number, number] => {
    const to = viewOf(centre(focus[m.beat] ?? [], board.w, board.h));
    if (m.beat <= first) return [to.x0 + to.w / 2, to.y0 + to.h / 2];
    const from = viewOf(centre(focus[m.beat - 1] ?? [], board.w, board.h));
    const k = easeOut(m.elapsed / Math.min(CAMERA_MS, durations[m.beat] || CAMERA_MS));
    return [from.x0 + from.w / 2 + (to.x0 - from.x0) * k, from.y0 + from.h / 2 + (to.y0 - from.y0) * k];
  };
  // The team pages over the replay in the preview: a page, or two while they crossfade (the replay beneath).
  const scene = sceneAt(segments, t);
  const layers: { index: number; alpha: number }[] = [];
  {
    const a = parts[scene.a.index];
    const b = scene.b ? parts[scene.b.index] : null;
    if (a.kind !== "replay") layers.push({ index: scene.a.index, alpha: b?.kind === "replay" ? 1 - scene.mix : 1 });
    if (b && b.kind !== "replay") layers.push({ index: scene.b!.index, alpha: scene.mix });
  }
  const looking = mode === "static" ? still ?? [board.w / 2, board.h / 2] : dynamicCentre(moment);
  const zoom = viewAround(looking, size, board);

  const setMode = (m: CameraMode) => {
    // Static holds where the camera is now.
    if (m === "static") setStill(zoom ? [zoom.x0 + zoom.w / 2, zoom.y0 + zoom.h / 2] : [board.w / 2, board.h / 2]);
    setModeState(m);
  };
  /** The wheel steps the zoom around the tile under the pointer (a static camera keeps that tile where it is). */
  const onWheelAt = (x: number, y: number, deltaY: number) => {
    if (working) return;
    const next = Math.max(0, Math.min(ZOOM_TILES.length - 1, level + (deltaY < 0 ? 1 : -1)));
    if (next === level) return;
    if (mode === "static") {
      const fromView = zoom ?? { x0: 0, y0: 0, w: board.w, h: board.h };
      const toView = viewAround(looking, viewSize(orientation, ZOOM_TILES[next], board), board) ?? { x0: 0, y0: 0, w: board.w, h: board.h };
      const nx0 = x - ((x - fromView.x0) * toView.w) / fromView.w;
      const ny0 = y - ((y - fromView.y0) * toView.h) / fromView.h;
      setStill([nx0 + toView.w / 2, ny0 + toView.h / 2]);
    }
    setLevel(next);
  };
  /** Dragging places the camera, which then stays there. */
  const onDrag = (dx: number, dy: number) => {
    if (working || !zoom) return;
    setStill([zoom.x0 + zoom.w / 2 + dx, zoom.y0 + zoom.h / 2 + dy]);
    if (mode !== "static") setModeState("static");
  };

  // The camera's view keeps one shape at a zoom level (the whole map's, zoomed out), so the frame is laid out for it.
  const layout = stageLayout(orientation, size[0] / size[1]);
  const stage = useRef<HTMLDivElement>(null);
  // The page being drawn for the video, in a hidden copy of the frame.
  const [raster, setRaster] = useState<Part | null>(null);
  const rasterRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const name = battleName(battle);

  const exportVideo = async () => {
    const out = [Math.round(width * scale), Math.round(height * scale)] as const;
    if (!(await canEncode(out[0], out[1], fps))) {
      setStatus({ kind: "error", message: `This window can't encode MP4 video at ${out[0]} × ${out[1]}${fps === 60 ? " and 60 frames a second" : ""}. Try a lower resolution, or update Microsoft Edge WebView2.` });
      return;
    }
    previewTheme(null);
    setPreviewing(false);
    const controller = new AbortController();
    abort.current = controller;
    setPlaying(false);
    const frames = Math.ceil((total / 1000) * fps);
    setStatus({ kind: "working", done: 0, total: frames, label: theme || usingCustom ? "Preparing the music" : "Making the video" });
    // Each layer is loaded into one image element over and over (snapshot.ts `image`), so no decoded frame is left behind.
    const chromeImg = new Image();
    const mapImg = new Image();
    // Team pages: each is drawn to a picture once (kept as its document while the video is made), and decoded while it is on screen.
    const docs = new Map<string, string>();
    const pageImages = new Map<number, HTMLImageElement>();
    let snap!: Awaited<ReturnType<typeof snapshotter>>;
    const pageImage = async (index: number) => {
      const found = pageImages.get(index);
      if (found) return found;
      const part = parts[index];
      if (part.kind === "replay") throw new Error("Not a page");
      let doc = docs.get(pictureId(part));
      if (!doc) {
        flushSync(() => setRaster(part));
        await new Promise((resolve) => window.setTimeout(resolve, 120)); // sprites and fonts settle
        if (!rasterRef.current) throw new Cancelled();
        doc = await snap.svg(rasterRef.current, width, height, scale);
        docs.set(pictureId(part), doc);
      }
      const img = await snap.image(doc);
      pageImages.set(index, img);
      return img;
    };
    let shown = "";
    try {
      const audio = options.volume <= 0 ? null : usingCustom ? customSoundtrack(custom, frames / fps, volume) : track ? await soundtrack(track, frames / fps, volume) : null;
      snap = await snapshotter();
      // A frame in two layers: the title and the log (with the map's frame) change once a step, so they're drawn once a
      // step; the map (with its turn banner) is drawn each frame on its own, with only the styles it needs.
      let chrome: { beat: number; img: HTMLImageElement } | null = null;
      let map: { doc: string; img: HTMLImageElement } | null = null;
      const video = await encodeVideo({
        width: out[0],
        height: out[1],
        fps,
        frames,
        quality: options.quality,
        audio,
        signal: controller.signal,
        onProgress: (done) => {
          if (done % 6 === 0 || done === frames) setStatus({ kind: "working", done, total: frames, label: "Making the video" });
        },
        draw: async (i, g) => {
          const ms = (i * 1000) / fps;
          flushSync(() => seekRef.current(ms));
          const el = stage.current;
          if (!el) throw new Cancelled();
          const scene = sceneAt(segments, Math.min(total, ms));
          const a = parts[scene.a.index];
          const b = scene.b ? parts[scene.b.index] : null;
          // What is on the canvas now: a page, the replay, or a crossfade (always redrawn).
          const now = scene.b ? `fade ${i}` : a.kind !== "replay" ? `page ${scene.a.index}` : "replay";
          let changed = now !== shown || !!scene.b;
          shown = now;
          const withReplay = a.kind === "replay" || b?.kind === "replay";
          if (withReplay) {
            const beat = momentAt(replayTime(ms)).beat;
            const newChrome = chrome?.beat !== beat;
            if (newChrome) chrome = { beat, img: await snap.image(await snap.svg(el, width, height, scale, CHROME_LAYER), chromeImg) };
            const doc = await snap.svg(el, width, height, scale, MAP_LAYER);
            const newMap = map?.doc !== doc;
            if (newMap) map = { doc, img: await snap.image(doc, mapImg) };
            changed ||= newChrome || newMap;
          }
          if (!changed) return; // a held frame: the canvas still has it
          if (withReplay) {
            g.drawImage(chrome!.img, 0, 0, out[0], out[1]);
            g.drawImage(map!.img, 0, 0, out[0], out[1]);
          }
          // Pages go over the replay (fading out as the replay fades in beneath, in as it fades out), or over each other.
          if (a.kind !== "replay") {
            g.globalAlpha = b?.kind === "replay" ? 1 - scene.mix : 1;
            g.drawImage(await pageImage(scene.a.index), 0, 0, out[0], out[1]);
          }
          if (b && b.kind !== "replay") {
            g.globalAlpha = scene.mix;
            g.drawImage(await pageImage(scene.b!.index), 0, 0, out[0], out[1]);
          }
          g.globalAlpha = 1;
          // Pages behind us are let go.
          for (const [index, img] of pageImages) {
            if (index >= scene.a.index) continue;
            img.removeAttribute("src");
            pageImages.delete(index);
          }
        },
      });
      try {
        const saved = await saveFiles("mp4", [{ name: `${safeFilename(name.title)} replay.mp4`, blob: video.blob }]);
        setStatus(saved ? { kind: "saved", where: saved } : { kind: "idle" });
      } finally {
        // The video may be a temporary file on disk; a browser's download still reads it for a while.
        window.setTimeout(() => void video.release(), savesNatively() ? 0 : 120_000);
      }
    } catch (error) {
      setStatus(error instanceof Cancelled ? { kind: "idle" } : { kind: "error", message: (error as Error).message || "The video couldn't be made." });
    } finally {
      abort.current = null;
      chromeImg.removeAttribute("src");
      mapImg.removeAttribute("src");
      for (const img of pageImages.values()) img.removeAttribute("src");
      setRaster(null);
    }
  };

  const notches = useMemo(() => {
    const out: { at: number; className: string }[] = [];
    let turn: number | null = null;
    for (let i = first; i <= last; i++) {
      const step = chron.beats[i].step;
      if (step.turn !== turn) out.push({ at: lead + starts[i - first], className: `${step.phase === 0 ? "player" : step.phase === 1 ? "enemy" : "other"} major` });
      turn = step.turn;
    }
    return out;
  }, [chron.beats, first, last, starts, lead]);

  return (
    <Modal
      open
      wide
      className="replay-export-modal"
      title="Export Video"
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
    >
      <div className="replay-export">
        {pages.measure}
        {rulesPage.measure}
        {raster && raster.kind !== "replay" && (
          <div className="team-page-raster" aria-hidden>
            {raster.kind === "page"
              ? <TeamPageView ref={rasterRef} page={raster.page} frame={frame} run={pageRun} part2={part2} face={team.face} markFallen={team.markFallen} gear={pages.gear} />
              : <RulesetPageView ref={rasterRef} rules={rules ?? NO_RULES} frame={frame} run={pageRun} page={rulesView} />}
          </div>
        )}
        <ScaledStage
          width={width}
          height={height}
          footer={
              <div className="replay-bar replay-export-transport">
                <div className="replay-buttons">
                  <IconButton icon={playing ? CONCEPT_ICON.pause : CONCEPT_ICON.play} primary pressed={playing} label={playing ? "Pause the preview" : "Play the preview"} onClick={() => setPlaying((p) => !p)} disabled={working} className="replay-btn" />
                </div>
                <NotchedRange
                  className="replay-timeline"
                  variant="timeline"
                  min={0}
                  max={total}
                  step="any"
                  value={t}
                  onChange={(v) => {
                    if (working) return;
                    // Scrubbing pauses the preview; Play goes on from there.
                    setPlaying(false);
                    seekTo(v);
                  }}
                  notches={notches}
                  label="Time in the video"
                  valueText={`${clock(t / 1000)} of ${clock(total / 1000)}`}
                />
                <span className="replay-export-time">
                  {clock(t / 1000)} / {clock(total / 1000)}
                </span>
              </div>
          }
        >
            <ReplayStage
              ref={stage}
              battle={battle}
              chron={chron}
              replay={replay}
              moment={moment}
              orientation={orientation}
              layout={layout}
              route={route}
              zoom={zoom}
              onWheelAt={working ? undefined : onWheelAt}
              onDrag={working ? undefined : onDrag}
            />
            {layers.map(({ index, alpha }) => {
              const part = parts[index];
              return (
                <div key={index} className="team-page-layer" style={{ opacity: alpha }}>
                  {part.kind === "page"
                    ? <TeamPageView page={part.page} frame={frame} run={pageRun} part2={part2} face={team.face} markFallen={team.markFallen} gear={pages.gear} />
                    : <RulesetPageView rules={rules ?? NO_RULES} frame={frame} run={pageRun} page={rulesView} />}
                </div>
              );
            })}
        </ScaledStage>
        <aside className="export-side export-tabbed" aria-label="Video options">
          <ExportTabs tab={options.tab} onTab={(tab) => setOption("tab", tab)}>
            {{
              format: (
                <>
                  <fieldset className="export-group" disabled={working}>
                    <legend>Aspect ratio</legend>
                    <Segmented<Orientation>
                      label="Aspect ratio"
                      value={orientation}
                      onChange={setOrientation}
                      options={[
                        ["landscape", "16:9", "1920 × 1080, the log beside the map"],
                        ["wide", "1.91:1", "2064 × 1080, the log beside the map"],
                        ["portrait", "9:16", "1080 × 1920, the log under the map"],
                        ["feed", "4:5", "1080 × 1350, the log under the map"],
                      ]}
                    />
                  </fieldset>
                  <fieldset className="export-group" disabled={working}>
                    <legend>Video</legend>
                    <div className="export-pairs">
                      <label className="wide">
                        Resolution
                        <select value={options.resolution} onChange={(e) => setOption("resolution", Number(e.target.value))}>
                          {RESOLUTIONS.map(([r, label]) => <option key={r} value={r}>{label}</option>)}
                        </select>
                      </label>
                      <label>
                        Frame rate
                        <select value={options.fps} onChange={(e) => setOption("fps", Number(e.target.value) === 60 ? 60 : 30)}>
                          <option value={30}>30 fps</option>
                          <option value={60}>60 fps (smoother)</option>
                        </select>
                      </label>
                      <label>
                        Quality
                        <select value={options.quality} onChange={(e) => setOption("quality", e.target.value as VideoQuality)}>
                          {QUALITIES.map(([q, label]) => <option key={q} value={q}>{label}</option>)}
                        </select>
                      </label>
                    </div>
                  </fieldset>
                </>
              ),
              replay: (
                <>
                  <fieldset className="export-group" disabled={working}>
                    <legend>Turns</legend>
                    <RangeSlider
                      label="Turns"
                      min={1}
                      max={Math.max(1, turns[turns.length - 1] ?? 1)}
                      start={from}
                      end={to}
                      onChange={(a, b) => { setFrom(a); setTo(b); }}
                    />
                  </fieldset>
                  <fieldset className="export-group" disabled={working}>
                    <legend>Replay</legend>
                    <ReplaySpeedSlider value={speed} onChange={setSpeed} labelled />
                    <CameraModeSwitch value={mode} onChange={setMode} labelled />
                    <ZoomSlider stops={ZOOM_TILES.length} value={level} onChange={setLevel} valueText={zoomText(level)} after={<ZoomValue level={level} />} />
                  </fieldset>
                </>
              ),
              team: (
                <>
                  <fieldset className="export-group ruleset-pages" disabled={working}>
                    <legend>Ruleset page</legend>
                    <RulesetPageSection options={options.rules} update={updateRules} rules={rules} page={rulesPage} />
                  </fieldset>
                  {units.length > 0 ? (
                    <fieldset className="export-group team-pages" disabled={working}>
                      <legend>Team pages</legend>
                      <TeamPagesSection team={team} update={updateTeam} pages={pages} units={units} part2={part2} />
                    </fieldset>
                  ) : (
                    <p className="export-note">This run has no units to show yet.</p>
                  )}
                </>
              ),
              music: (
                <fieldset className="export-group" disabled={working}>
                  <legend>Music</legend>
                  {music === null && <p className="export-note">The battle themes need your game files reprocessed (Settings &gt; Game files). You can still use your own audio.</p>}
                  <div className="export-music">
                    <select aria-label="Soundtrack" value={themeId} disabled={music === undefined} onChange={(e) => {
                      const id = e.target.value;
                      if (id === CUSTOM_ID && !custom) {
                        picker.current?.click(); // the choice itself waits for a file that can be read
                        return;
                      }
                      setThemeId(id);
                      if (previewing) {
                        const found = music?.themes.find((m) => m.id === id);
                        const next = id === CUSTOM_ID && custom ? { id: CUSTOM_ID, url: custom.url } : found ? recording(found, versionOf(found)) : null;
                        setPreviewing(previewTheme(next, volume));
                      }
                    }}>
                      <option value="">No music</option>
                      <option value={CUSTOM_ID}>{custom ? "Your own audio" : "Your own audio…"}</option>
                      {THEME_GROUPS.map((group) => {
                        const themes = music?.themes.filter((m) => m.group === group) ?? [];
                        return themes.length ? (
                          <optgroup key={group} label={group}>
                            {themes.map((m) => <option key={m.id} value={m.id}>{m.title}{music && defaultTheme(music, battle.scenario).id === m.id ? " (Default)" : ""}</option>)}
                          </optgroup>
                        ) : null;
                      })}
                    </select>
                    <IconButton
                      icon={previewing ? CONCEPT_ICON.pause : CONCEPT_ICON.play}
                      label={previewing ? "Stop listening" : "Listen to it"}
                      pressed={previewing}
                      disabled={!listening}
                      onClick={() => setPreviewing(previewTheme(listening, volume))}
                    />
                  </div>
                  <input
                    ref={picker}
                    type="file"
                    accept="audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac"
                    hidden
                    aria-label="Choose an audio file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void chooseFile(file);
                    }}
                  />
                  {reading && <p className="export-note" role="status">Reading the file…</p>}
                  {customError && <p className="export-error" role="alert">{customError}</p>}
                  {custom && (
                    <div className={`export-file${usingCustom ? " on" : ""}`}>
                      <span className="export-file-name" title={custom.name}>{custom.name}</span>
                      <span className="export-file-length">{clock(custom.duration)}</span>
                      <button type="button" className="checklist-clear" onClick={() => picker.current?.click()}>Replace</button>
                      <button type="button" className="checklist-clear" onClick={removeCustom}>Remove</button>
                    </div>
                  )}
                  {usingCustom && <p className="export-note">{custom.duration * 1000 < total ? "Shorter than the video, so it plays again from the start." : "Longer than the video, so it stops at the end with a fade-out."}</p>}
                  {/* Only the built-in themes have two versions; hidden (not removed) for your own audio so the layout stays put. */}
                  <div style={usingCustom ? { visibility: "hidden" } : undefined} aria-hidden={usingCustom || undefined}>
                    <Segmented<Version>
                      label="Version of the theme"
                      value={version}
                      disabled={!theme || !!thunderNote}
                      onChange={(v) => {
                        setOption("version", v);
                        // The listening follows the toggle.
                        if (previewing && theme) setPreviewing(previewTheme(recording(theme, v), volume));
                      }}
                      options={[
                        ["rain", "Rain", "The calm version"],
                        ["thunder", "Thunder", "The intense version"],
                      ]}
                    />
                    {thunderNote && theme && <p className="export-note">{thunderNote}</p>}
                  </div>
                  <StepSlider
                    label="Volume"
                    stops={101}
                    value={options.volume}
                    onChange={(v) => { setOption("volume", v); setPreviewVolume(v / 100); }}
                    valueText={`${options.volume}%`}
                    variant="timeline"
                    slim
                    after={<span className="export-value">{options.volume}%</span>}
                  />
                </fieldset>
              ),
            }}
          </ExportTabs>
          <ExportActions
            facts={[`${Math.round(width * scale)} × ${Math.round(height * scale)}`, `${fps} fps`, clock(total / 1000), ...(pages.start.length + pages.end.length ? [`${pages.start.length + pages.end.length} team page${pages.start.length + pages.end.length === 1 ? "" : "s"}`] : []), ...(rulesAt ? ["Ruleset page"] : []), theme ? `${theme.title}${version === "thunder" ? " (Thunder)" : ""}` : usingCustom ? "Your audio" : "No music"]}
            status={status}
            action="Export MP4…"
            onExport={() => void exportVideo()}
            onCancel={() => abort.current?.abort()}
          />
        </aside>
      </div>
    </Modal>
  );
}

/**
 * The options panel's tabs (role tablist / tab / tabpanel): Left and Right (and Up and Down) move between them, Home and
 * End go to the first and last. Only the open tab's panel is in the page, so the panel never needs to scroll.
 */
function ExportTabs({ tab, onTab, children }: { tab: ExportTab; onTab: (tab: ExportTab) => void; children: Record<ExportTab, React.ReactNode> }) {
  const id = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent) => {
    const at = TABS.findIndex(([t]) => t === tab);
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (at + 1) % TABS.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (at + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onTab(TABS[to][0]);
    refs.current[TABS[to][0]]?.focus();
  };
  return (
    <>
      <div className="export-tabs" role="tablist" aria-label="Video options" aria-orientation="horizontal" onKeyDown={onKey}>
        {TABS.map(([t, label]) => (
          <button
            key={t}
            ref={(el) => { refs.current[t] = el; }}
            type="button"
            role="tab"
            id={`${id}-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`${id}-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            className={tab === t ? "on" : ""}
            onClick={() => onTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="export-panel" role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`}>
        {children[tab]}
      </div>
    </>
  );
}

/** Room around the frame (px), on every side. */
const ROOM_PAD = 14;

/** The video's frame at its real size, scaled down to the biggest the preview's column allows, with its transport bar
 * (`footer`) under it at the frame's width; the pair sits in the middle of the column rather than leaving the frame
 * floating in a room of its own. */
function ScaledStage({ width, height, footer, children }: { width: number; height: number; footer: React.ReactNode; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const below = foot.current ? foot.current.offsetHeight + 10 : 0;
      setRoom([el.clientWidth, el.clientHeight - below]);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (foot.current) observer.observe(foot.current);
    measure();
    return () => observer.disconnect();
  }, []);
  const k = Math.max(0, Math.min((room[0] - ROOM_PAD * 2) / width, (room[1] - ROOM_PAD * 2) / height));
  const frame: [number, number] = [width * k, height * k];
  return (
    <div className="replay-export-preview" ref={box}>
      <div className="replay-export-room" style={{ width: frame[0] + ROOM_PAD * 2, height: frame[1] + ROOM_PAD * 2 }}>
        <div className="replay-export-screen" style={{ width: frame[0], height: frame[1] }}>
          <div style={{ position: "relative", width, height, transform: `scale(${k})`, transformOrigin: "0 0" }}>{children}</div>
        </div>
      </div>
      <div className="replay-export-foot" ref={foot} style={{ width: frame[0] + ROOM_PAD * 2 }}>{footer}</div>
    </div>
  );
}

interface StageProps {
  battle: Battle;
  chron: Chronicle;
  replay: ReturnType<typeof useReplay>;
  moment: Moment;
  orientation: Orientation;
  layout: { columns: string; rows: string };
  route: RunRoute | null;
  zoom: Zoom | null;
  onWheelAt?: (x: number, y: number, deltaY: number) => void;
  onDrag?: (dx: number, dy: number) => void;
  ref?: React.Ref<HTMLDivElement>;
}

/** One frame of the video: the title strip, the map and the log. */
function ReplayStage({ battle, chron, replay, moment, orientation, layout, route, zoom, onWheelAt, onDrag, ref }: StageProps) {
  const name = battleName(battle);
  // The log up to the step on the map: rows of later steps aren't shown yet (the newest is at the bottom).
  const rows = useMemo(() => {
    const out = [];
    for (const item of chron.log) {
      const beat = beatOf(item);
      if (beat !== null && beat > moment.beat) break;
      out.push(item);
    }
    return out;
  }, [chron.log, moment.beat]);
  const date = new Date(battle.started_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return (
    // The picture is taken of the outer box, exactly the frame's size.
    <div ref={ref} className="replay-stage-theme">
    <div className={`replay-stage ${logBeside(orientation) ? "landscape" : "portrait"} ${orientation}`} style={{ gridTemplateColumns: layout.columns, gridTemplateRows: layout.rows }}>
      <header className="replay-stage-title">
        <CardBanner title={name.title} icon={<RunIcon route={route} />} />
        <div className="replay-stage-meta">
          <span className="replay-stage-facts">
            {[name.kind ? KIND_LABEL[name.kind] : null, name.place, date].filter(Boolean).join(" · ")}
          </span>
          <span className="replay-stage-credit">
            Divine Pulse <span>· by Adombs</span>
          </span>
        </div>
      </header>
      <div className="replay-stage-map map-frame">
        <Minimap
          board={replay.board}
          action={replay.action}
          animation={replay.animation}
          labels={replay.labels}
          labelsShown={replay.labelsShown}
          label={`The battle map at ${replay.label}`}
          zoom={zoom}
          onWheelAt={onWheelAt}
          onDrag={onDrag}
        />
        {replay.rewind && (
          <div className="rewind-badge" style={{ opacity: replay.rewind.badge, transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * replay.rewind.badge})` }} aria-hidden>
            <Icon name={CONCEPT_ICON.pulse} />
          </div>
        )}
        <ReplayBanner replay={replay} />
      </div>
      <section className="replay-stage-log" aria-label="Log">
        <h3 className="replay-stage-log-title">
          <Icon name={CONCEPT_ICON.log} /> Log
        </h3>
        <div className="replay-stage-rows">
          <ItemList items={rows} current={replay.at} empty="The battle begins." />
        </div>
      </section>
    </div>
    </div>
  );
}
