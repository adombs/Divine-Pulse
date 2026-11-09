import { createContext, useEffect, useState } from "react";
import type { PortraitPhase } from "./portraits";
import { useSpoilers } from "./spoilers";
import { FACE_LOOKS, type MapLook, UNIT_LOOKS } from "./components/battle/mapIcons";

export const PortraitPhaseContext = createContext<PortraitPhase>("auto");

export interface FontOption {
  id: string;
  label: string;
  description: string;
  /** Titles, names, labels and buttons. */
  heading: string;
  /** Running text. */
  text: string;
  /** Stat numbers. */
  nums: string;
  /** Size correction so every font looks about the same size. */
  scale: number;
  /** Loads the bundled font files (code-split, so only fonts you use are fetched). None = system font. */
  load?: () => Promise<unknown>;
}

const SERIF_FALLBACK = "Garamond, Georgia, 'Times New Roman', serif";
const SANS_FALLBACK = "system-ui, 'Segoe UI', sans-serif";

export const FONTS: FontOption[] = [
  {
    id: "fodlan",
    label: "Fódlan",
    description: "EB Garamond for a classic, readable look close to the game.",
    heading: `'EB Garamond', ${SERIF_FALLBACK}`,
    text: `'EB Garamond', ${SERIF_FALLBACK}`,
    nums: `'EB Garamond', ${SERIF_FALLBACK}`,
    scale: 1,
    load: () => Promise.all([import("@fontsource/eb-garamond/latin-400.css"), import("@fontsource/eb-garamond/latin-500.css"), import("@fontsource/eb-garamond/latin-600.css"), import("@fontsource/eb-garamond/latin-700.css")]),
  },
  {
    id: "cormorant",
    label: "Cormorant",
    description: "Fine, high-contrast Garamond. Elegant, but thin at small sizes.",
    heading: `'Cormorant Garamond', ${SERIF_FALLBACK}`,
    text: `'Cormorant Garamond', ${SERIF_FALLBACK}`,
    nums: `'Cormorant Garamond', ${SERIF_FALLBACK}`,
    scale: 1.06,
    load: () => Promise.all([import("@fontsource/cormorant-garamond/latin-500.css"), import("@fontsource/cormorant-garamond/latin-600.css"), import("@fontsource/cormorant-garamond/latin-700.css")]),
  },
  {
    id: "cinzel",
    label: "Cinzel",
    description: "Carved Roman letterforms throughout the app, including text and numbers.",
    heading: `'Cinzel', ${SERIF_FALLBACK}`,
    text: `'Cinzel', ${SERIF_FALLBACK}`,
    nums: `'Cinzel', ${SERIF_FALLBACK}`,
    scale: 0.94,
    load: () => Promise.all([import("@fontsource/cinzel/latin-400.css"), import("@fontsource/cinzel/latin-500.css"), import("@fontsource/cinzel/latin-600.css"), import("@fontsource/cinzel/latin-700.css")]),
  },
  {
    id: "alegreya",
    label: "Alegreya",
    description: "Lively calligraphic book face with old-style warmth.",
    heading: `'Alegreya', ${SERIF_FALLBACK}`,
    text: `'Alegreya', ${SERIF_FALLBACK}`,
    nums: `'Alegreya', ${SERIF_FALLBACK}`,
    scale: 0.96,
    load: () => Promise.all([import("@fontsource/alegreya/latin-400.css"), import("@fontsource/alegreya/latin-500.css"), import("@fontsource/alegreya/latin-700.css")]),
  },
  {
    id: "spectral",
    label: "Spectral",
    description: "Crisp modern serif designed for screens.",
    heading: `'Spectral', ${SERIF_FALLBACK}`,
    text: `'Spectral', ${SERIF_FALLBACK}`,
    nums: `'Spectral', ${SERIF_FALLBACK}`,
    scale: 0.92,
    load: () => Promise.all([import("@fontsource/spectral/latin-400.css"), import("@fontsource/spectral/latin-500.css"), import("@fontsource/spectral/latin-600.css"), import("@fontsource/spectral/latin-700.css")]),
  },
  {
    id: "atkinson",
    label: "Atkinson Hyperlegible",
    description: "Sans serif built for maximum legibility. Best if you want readability over flavour.",
    heading: `'Atkinson Hyperlegible', ${SANS_FALLBACK}`,
    text: `'Atkinson Hyperlegible', ${SANS_FALLBACK}`,
    nums: `'Atkinson Hyperlegible', ${SANS_FALLBACK}`,
    scale: 0.9,
    load: () => Promise.all([import("@fontsource/atkinson-hyperlegible/latin-400.css"), import("@fontsource/atkinson-hyperlegible/latin-700.css")]),
  },
  {
    id: "system",
    label: "System (Segoe UI)",
    description: "Windows' own interface font. Nothing to download, works offline.",
    heading: SANS_FALLBACK,
    text: SANS_FALLBACK,
    nums: SANS_FALLBACK,
    scale: 0.88,
  },
];

/** Text size, as a share of the normal size: the Settings slider's range and step. */
export const TEXT_SCALE = { min: 0.7, max: 1.3, step: 0.05 } as const;
/** What 100% means: the root font scale at a textScale of 1. */
const BASE_SCALE = 1.1;

export interface Appearance {
  font: string;
  /** Text size (TEXT_SCALE). */
  textScale: number;
  /** Which unit portraits to show: Auto = Part II once a house leader has their post-timeskip class. */
  portraits: PortraitPhase;
  /** How units are drawn on the battle map. */
  mapMine: MapLook["mine"];
  mapOthers: MapLook["others"];
  /** The faces in the battle view's Units section and on a unit's card. */
  myUnitFaces: MapLook["myFaces"];
  otherUnitFaces: MapLook["otherFaces"];
  /** How fast the battle map's replay plays (1 normal). */
  replaySpeed: number;
}

const KEY = "divine-pulse-appearance";

const isUnitLook = (v: unknown): v is MapLook["mine"] => UNIT_LOOKS.some(([look]) => look === v);

export function loadAppearance(): Appearance {
  const fallback: Appearance = {
    font: "fodlan",
    portraits: "auto",
    textScale: 1,
    mapMine: "portraits",
    mapOthers: "sprites",
    myUnitFaces: "portraits",
    otherUnitFaces: "portraits",
    replaySpeed: 1,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && typeof saved === "object") {
      const { mapNamed, mapGeneric, unitFaces, ...current } = saved;
      // A theme saved by an earlier version (the app has one theme now) is dropped.
      delete (current as Record<string, unknown>).theme;
      const out: Appearance = { ...fallback, ...current };
      out.mapMine = isUnitLook(out.mapMine) ? out.mapMine : fallback.mapMine;
      out.mapOthers = isUnitLook(out.mapOthers) ? out.mapOthers : fallback.mapOthers;
      if (!("mapMine" in current) && isUnitLook(mapNamed)) out.mapMine = mapNamed;
      if (!("mapOthers" in current) && isUnitLook(mapGeneric)) out.mapOthers = mapGeneric;
      for (const key of ["myUnitFaces", "otherUnitFaces"] as const) {
        if (!(key in current) && FACE_LOOKS.some(([look]) => look === unitFaces)) out[key] = unitFaces;
        if (!FACE_LOOKS.some(([look]) => look === out[key])) out[key] = fallback[key];
      }
      return out;
    }
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

export function fontById(id: string): FontOption {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

const loaded = new Set<string>();

/** Loads a font's files once. They're bundled with the app, so this works offline. */
export function loadFont(font: FontOption): void {
  if (!font.load || loaded.has(font.id)) return;
  loaded.add(font.id);
  font.load().catch(() => loaded.delete(font.id));
}

export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  const font = fontById(a.font);
  const size = Math.min(TEXT_SCALE.max, Math.max(TEXT_SCALE.min, Number(a.textScale) || 1));
  loadFont(font);
  root.style.setProperty("--display", font.heading);
  root.style.setProperty("--text", font.text);
  root.style.setProperty("--nums", font.nums);
  root.style.setProperty("--font-scale", String(font.scale * size * BASE_SCALE));
}

/** Font and text size are saved in the desktop window's profile. */
export function useAppearance() {
  // Refresh pure portrait lookups throughout the app when a spoiler preference changes.
  useSpoilers();
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);
  useEffect(() => {
    applyAppearance(appearance);
    try {
      localStorage.setItem(KEY, JSON.stringify(appearance));
    } catch {
      /* storage unavailable */
    }
  }, [appearance]);
  const update = (patch: Partial<Appearance>) => setAppearance((a) => ({ ...a, ...patch }));
  return {
    appearance,
    update,
  };
}

export type AppearanceState = ReturnType<typeof useAppearance>;

/** Ability names from game data or typing ("HP+5", "Lance Prowess LV 2", "Authority Lv I") → tidy display text. */
export function tidyAbility(name: string): string {
  return name
    .replace(/\s*L[Vv]\s*([0-9IlS|])(?![A-Za-z])/g, (_, n: string) => ` Lv ${n.replace(/[Il|]/g, "1").replace(/S/g, "5")}`)
    .replace(/([A-Za-z])\s*\+\s*(\d)/g, "$1 +$2")
    .trim();
}
