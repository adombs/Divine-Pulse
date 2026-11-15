/**
 * The battle map's camera, shared by the Map tab and the Overview's map: a zoom level, and where the view is centred.
 * Dynamic, the view follows the action (the game's cursor live, the units acting in a replay step); dragging or
 * zooming with the wheel moves it until the action moves on. Static, it stays wherever it was put, moved only by
 * dragging and the wheel. The mode is remembered per map.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CONCEPT_ICON } from "../../icons/concepts";
import { Icon } from "../Icon";
import { Segmented } from "../ui";
import type { Board } from "./map";
import type { Zoom } from "./Minimap";
import { StepSlider } from "../Slider";
import { useBattleNav } from "./parts";
import { ReplaySpeedSlider } from "./replay";
import { framed } from "./framing";

export { framed };

/** How long the camera takes to pan to the next action at normal pan speed (ms). */
export const PAN_MS = 400;
/** The pan speeds Settings and the video export offer (1 normal). */
export const PAN_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const;
/** The pan sensitivities offered: how far in from the view's edges (a share of the zoom's tiles across) the units
 * acting must stand before the camera pans to them. 0 pans only once they're out of view; 0.5 always centres them. */
export const PAN_MARGINS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5] as const;

/** How the dynamic camera pans (Settings > Battle map; the video export can change it for one video). */
export interface CameraPan {
  /** 1 normal: a pan takes PAN_MS. */
  speed: number;
  /** A share of the zoom's tiles across (PAN_MARGINS). */
  margin: number;
}
export const DEFAULT_PAN: CameraPan = { speed: 1, margin: 0.1 };

/** How long a pan takes at `speed` (ms). */
export const panMs = (speed: number) => PAN_MS / (speed > 0 && Number.isFinite(speed) ? speed : 1);

/** The camera's pan speed stops, in Settings and the video export. */
export function PanSpeedSlider({ value, onChange, labelled }: { value: number; onChange: (value: number) => void; labelled?: boolean }) {
  const stop = PAN_SPEEDS.reduce<number>((best, speed, i) => (Math.abs(speed - value) < Math.abs(PAN_SPEEDS[best] - value) ? i : best), 0);
  return (
    <StepSlider
      label={labelled ? "Pan speed" : "Camera pan speed"}
      bare={!labelled}
      stops={PAN_SPEEDS.length}
      value={stop}
      onChange={(i) => onChange(PAN_SPEEDS[i])}
      valueText={`${value}× pan speed`}
      icon={CONCEPT_ICON.camera}
      variant="timeline"
      slim
      after={<span className="replay-speed-value">{value}×</span>}
    />
  );
}

const marginText = (margin: number) =>
  margin >= 0.5 ? "Always centre the action" : margin <= 0 ? "Pan only once the action leaves the view" : `Pan when the action comes within ${Math.round(margin * 100)}% of the view's edge`;

/** The camera's pan sensitivity stops: how near the view's edge the action may come before the camera pans. */
export function PanSensitivitySlider({ value, onChange, labelled }: { value: number; onChange: (value: number) => void; labelled?: boolean }) {
  const stop = PAN_MARGINS.reduce<number>((best, margin, i) => (Math.abs(margin - value) < Math.abs(PAN_MARGINS[best] - value) ? i : best), 0);
  return (
    <StepSlider
      label={labelled ? "Pan sensitivity" : "Camera pan sensitivity"}
      bare={!labelled}
      stops={PAN_MARGINS.length}
      value={stop}
      onChange={(i) => onChange(PAN_MARGINS[i])}
      valueText={marginText(value)}
      icon={CONCEPT_ICON.target}
      variant="timeline"
      slim
      after={<span className="replay-speed-value" title={marginText(value)}>{value >= 0.5 ? "Centre" : `${Math.round(value * 100)}%`}</span>}
    />
  );
}

// Tiles across (and down) the view at each stop of the zoom slider, 0 being the whole map; the wheel steps through
// them too.
export const ZOOM_TILES = [0, 24, 20, 16, 13, 10, 8, 7, 6, 5];
export const DEFAULT_ZOOM = 5;

export type CameraMode = "dynamic" | "static";

/** The view `tiles` across centred on (cx, cy), kept inside the map (null: the whole map is in view). */
export function view([cx, cy]: [number, number], tiles: number, board: Board): Zoom | null {
  const w = tiles ? Math.min(tiles, board.w) : board.w;
  const h = tiles ? Math.min(tiles, board.h) : board.h;
  if (w >= board.w && h >= board.h) return null;
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  return { w, h, x0: clamp(cx - w / 2, board.w - w), y0: clamp(cy - h / 2, board.h - h) };
}

/** How many tiles across a view needs to hold all of `follow` with a tile to spare on each side. */
export function fitTiles(follow: [number, number][]): number {
  const xs = follow.map(([x]) => x);
  const ys = follow.map(([, y]) => y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 3;
}

function loadMode(place: string): CameraMode {
  try {
    return localStorage.getItem(`divine-pulse-map-camera-${place}`) === "static" ? "static" : "dynamic";
  } catch {
    return "dynamic";
  }
}

/**
 * `follow`: the tiles to keep in view, none for the middle of the map. `moment` changes whenever the action moves on
 * (the cursor moved, another replay step), which brings a dynamic camera back to it: it pans only as far as it takes to
 * have what it follows `pan.margin` of the zoom in from the view's edges (framed), taking panMs(`pan.speed`). `onPan`
 * hears, before the frame it starts on is drawn, how long the pan to each new moment takes (0: the camera stayed put).
 */
export function useMapCamera(place: string, board: Board, follow: [number, number][], moment: string, pan: CameraPan = DEFAULT_PAN, onPan?: (ms: number) => void) {
  const [mode, setModeState] = useState<CameraMode>(() => loadMode(place));
  const [level, setLevel] = useState(DEFAULT_ZOOM);
  // Where the view was moved to by hand (null: on the action).
  const [center, setCenter] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (mode === "dynamic") setCenter(null);
  }, [mode, moment]);

  // Following the action, the view is as wide as the zoom says, or wider while what it follows (several units moving
  // together) wouldn't fit: all of it in view, with a tile to spare around it.
  let tiles = ZOOM_TILES[level];
  if (follow.length && tiles && center === null) tiles = Math.max(tiles, fitTiles(follow));
  // The view drawn last, which a dynamic camera pans on from.
  const shown = useRef<Zoom | null>(null);
  // Where a dynamic camera rests for a moment (and zoom), worked out once from where it was.
  const rest = useRef<{ key: string; focus: [number, number] } | null>(null);
  let target: [number, number] = [board.w / 2, board.h / 2];
  if (follow.length) {
    const key = `${moment}|${tiles}|${board.w}x${board.h}|${pan.margin}|${follow.join(";")}`;
    if (rest.current?.key !== key) {
      const w = tiles ? Math.min(tiles, board.w) : board.w;
      const h = tiles ? Math.min(tiles, board.h) : board.h;
      const was = shown.current;
      // From the view before, as it would stand at this size around the same middle.
      const from: [number, number] | null = was ? [was.x0 + was.w / 2 - w / 2, was.y0 + was.h / 2 - h / 2] : null;
      const [x0, y0] = framed(from, follow, [w, h], ZOOM_TILES[level] || Math.max(w, h), pan.margin, [board.w - w, board.h - h]);
      rest.current = { key, focus: [x0 + w / 2, y0 + h / 2] };
    }
    target = rest.current.focus;
  }
  const focus = center ?? target;
  const zoom = view(focus, tiles, board);
  const whole = { x0: 0, y0: 0, w: board.w, h: board.h };
  const middle = (): [number, number] => (zoom ? [zoom.x0 + zoom.w / 2, zoom.y0 + zoom.h / 2] : [board.w / 2, board.h / 2]);

  // At a new moment, how long the camera pans to it (0 when it stays put), for the replay to wait on.
  const duration = panMs(pan.speed);
  const heard = useRef<string | null>(null);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = zoom;
    if (heard.current === moment) return;
    heard.current = moment;
    const moved = mode === "dynamic" && !!before && !!zoom && (Math.abs(before.x0 - zoom.x0) > 0.01 || Math.abs(before.y0 - zoom.y0) > 0.01);
    onPan?.(moved ? duration : 0);
  });

  // Static, the camera holds where it is now: the first view is kept as the action moves on.
  const here = useRef(focus);
  here.current = focus;
  useEffect(() => {
    if (mode === "static") setCenter((c) => c ?? here.current);
  }, [mode]);

  const setMode = (m: CameraMode) => {
    setModeState(m);
    try {
      localStorage.setItem(`divine-pulse-map-camera-${place}`, m);
    } catch {
      // Not kept; fine.
    }
  };
  /** The wheel steps the zoom around the tile under the pointer, keeping it where it is on screen. */
  const onWheelAt = (x: number, y: number, deltaY: number) => {
    const next = Math.max(0, Math.min(ZOOM_TILES.length - 1, level + (deltaY < 0 ? 1 : -1)));
    if (next === level) return;
    const from = zoom ?? whole;
    const to = view(focus, ZOOM_TILES[next], board) ?? whole;
    const nx0 = x - ((x - from.x0) * to.w) / from.w;
    const ny0 = y - ((y - from.y0) * to.h) / from.h;
    setLevel(next);
    setCenter([nx0 + to.w / 2, ny0 + to.h / 2]);
  };
  const onDrag = (dx: number, dy: number) => {
    const [mx, my] = middle();
    setCenter([mx + dx, my + dy]);
  };
  return { mode, setMode, level, setLevel, zoom, onWheelAt, onDrag, panMs: duration };
}

export type MapCamera = ReturnType<typeof useMapCamera>;

export const zoomText = (level: number) => (ZOOM_TILES[level] ? `${ZOOM_TILES[level]} tiles across` : "The whole map");

/** The zoom slider and the static / dynamic switch. */
export function CameraTools({ camera }: { camera: MapCamera }) {
  const { level, setLevel, mode, setMode } = camera;
  const nav = useBattleNav();
  return (
    <div className="map-tools">
      {nav.setReplaySpeed && <ReplaySpeedSlider value={nav.replaySpeed ?? 1} onChange={nav.setReplaySpeed} />}
      <CameraModeSwitch value={mode} onChange={setMode} />
      <ZoomSlider stops={ZOOM_TILES.length} value={level} onChange={setLevel} valueText={zoomText(level)} after={<ZoomValue level={level} />} />
    </div>
  );
}

/** Dynamic (follow the action) or static (stay where it was put): the map's switch, and the replay export's. */
export function CameraModeSwitch({ value, onChange, labelled }: { value: CameraMode; onChange: (mode: CameraMode) => void; labelled?: boolean }) {
  return (
    <span className="camera-mode">
      {labelled ? <span className="field-label">Camera</span> : <Icon name={CONCEPT_ICON.camera} />}
      <Segmented
        size="mini"
        label="Camera"
        value={value}
        onChange={onChange}
        options={[
          ["dynamic", "Dynamic", "Follow the action"],
          ["static", "Static", "Stay where you put it"],
        ]}
      />
    </span>
  );
}

/** The map's zoom stop in a few characters, after its slider as the speed slider's "1×" is after its own. */
export function ZoomValue({ level }: { level: number }) {
  return <span className="replay-speed-value" title={zoomText(level)}>{ZOOM_TILES[level] ? `${ZOOM_TILES[level]} tiles` : "All"}</span>;
}

/** The zoom slider every zoomable view uses (the map, the log's timelines), in a `map-tools` box: the same look. */
export function ZoomSlider({ stops, value, onChange, valueText, after }: { stops: number; value: number; onChange: (v: number) => void; valueText?: string; after?: ReactNode }) {
  return <StepSlider label="Zoom" stops={stops} value={value} onChange={onChange} valueText={valueText} icon="search" variant="timeline" slim after={after} />;
}
