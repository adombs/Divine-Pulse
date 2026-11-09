/**
 * The battle map's camera, shared by the Map tab and the Overview's map: a zoom level, and where the view is centred.
 * Dynamic, the view follows the action (the game's cursor live, the units acting in a replay step); dragging or
 * zooming with the wheel moves it until the action moves on. Static, it stays wherever it was put, moved only by
 * dragging and the wheel. The mode is remembered per map.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CONCEPT_ICON } from "../../icons/concepts";
import { Icon } from "../Icon";
import { Segmented } from "../ui";
import type { Board } from "./map";
import type { Zoom } from "./Minimap";
import { StepSlider } from "../Slider";
import { useBattleNav } from "./parts";
import { ReplaySpeedSlider } from "./replay";

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

function loadMode(place: string): CameraMode {
  try {
    return localStorage.getItem(`divine-pulse-map-camera-${place}`) === "static" ? "static" : "dynamic";
  } catch {
    return "dynamic";
  }
}

/**
 * `follow`: the tiles to keep in view (their middle is centred), none for the middle of the map. `moment` changes
 * whenever the action moves on (the cursor moved, another replay step), which brings a dynamic camera back to it.
 */
export function useMapCamera(place: string, board: Board, follow: [number, number][], moment: string) {
  const [mode, setModeState] = useState<CameraMode>(() => loadMode(place));
  const [level, setLevel] = useState(DEFAULT_ZOOM);
  // Where the view was moved to by hand (null: on the action).
  const [center, setCenter] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (mode === "dynamic") setCenter(null);
  }, [mode, moment]);

  let target: [number, number] = [board.w / 2, board.h / 2];
  if (follow.length) {
    const xs = follow.map(([x]) => x + 0.5);
    const ys = follow.map(([, y]) => y + 0.5);
    target = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  const focus = center ?? target;
  const zoom = view(focus, ZOOM_TILES[level], board);
  const whole = { x0: 0, y0: 0, w: board.w, h: board.h };
  const middle = (): [number, number] => (zoom ? [zoom.x0 + zoom.w / 2, zoom.y0 + zoom.h / 2] : [board.w / 2, board.h / 2]);

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
  return { mode, setMode, level, setLevel, zoom, onWheelAt, onDrag };
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
