// Builds src/components/iconPaths.ts, the app's icons, from Phosphor Icons (@phosphor-icons/core, MIT): only the
// icons below, in the weights used (duotone, and fill for a few), so the app doesn't ship the whole pack.
// Dev-only, like the tools/ scripts; run after changing the list:
//
//     node scripts/build-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "..", "node_modules", "@phosphor-icons", "core", "assets");
const out = join(here, "..", "src", "components", "iconPaths.ts");

// The app's name for an icon -> Phosphor's, and the weight besides duotone it's drawn in (if any).
const ICONS = {
  // Pages (the sidebar)
  home: ["house"],
  roster: ["users-three"],
  battle: ["sword"],
  history: ["clock-counter-clockwise"],
  characters: ["identification-badge"],
  classes: ["shield-chevron"],
  archive: ["books"],
  supports: ["hand-heart"],
  runs: ["flag-banner"],
  settings: ["gear-six"],
  // Moving around: one step, all the way, back
  prev: ["caret-left"],
  next: ["caret-right"],
  first: ["caret-line-left"],
  last: ["caret-line-right"],
  play: ["play"],
  pause: ["pause"],
  back: ["arrow-u-up-left"],
  open: ["caret-right"],
  down: ["caret-down"],
  up: ["caret-up"],
  go: ["arrow-right"],
  tip: ["coffee"],
  // Controls
  close: ["x"],
  search: ["magnifying-glass"],
  zoomOut: ["magnifying-glass-minus"],
  zoomIn: ["magnifying-glass-plus"],
  camera: ["camera"],
  speed: ["hourglass"],
  hide: ["eye-slash"],
  edit: ["pencil-simple"],
  delete: ["trash"],
  done: ["check-circle"],
  info: ["info"],
  warning: ["warning", "fill"],
  section: ["gear-six", "fill"],
  log: ["list-bullets"],
  // What happened in a battle (the log, model.ts ICON)
  phase: ["flag"],
  move: ["footprints"],
  wait: ["hourglass-simple"],
  attack: ["sword"],
  counter: ["arrow-bend-up-left"],
  defeat: ["skull"],
  fell: ["x-circle"],
  heal: ["first-aid"],
  spell: ["magic-wand"],
  item: ["flask"],
  act: ["hand-pointing"],
  art: ["lightning"],
  rally: ["megaphone"],
  pulse: ["clock-counter-clockwise"],
  start: ["flag-banner"],
  turn: ["arrows-clockwise"],
  end: ["flag-checkered"],
  statUp: ["plus"],
  joined: ["sign-in"],
  left: ["sign-out"],
  enemies: ["users-three"],
  // Marks in tables and cards
  inRun: ["diamond", "fill"],
  ending: ["heart", "fill"],
  linked: ["sword"],
  male: ["gender-male"],
  female: ["gender-female"],
  // A unit's state (the Overview's unit list, the Units tab) and what it carries
  lowHp: ["heart-half"],
  danger: ["heartbeat"],
  critical: ["crown"],
  noMagic: ["drop-slash"],
  broken: ["link-break"],
  worn: ["wrench"],
  adjutant: ["users"],
  equipment: ["shield"],
  // Shared domain concepts (src/icons/concepts.ts).
  ability: ["star-four"],
  battalion: ["flag-banner-fold"],
  // A portrait that turns over to show the map sprite
  flip: ["arrows-left-right"],
  crest: ["seal"],
  growth: ["trend-up"],
  position: ["map-pin"],
  tea: ["tea-bag"],
  meals: ["fork-knife"],
  gifts: ["gift"],
  training: ["graduation-cap"],
  liked: ["thumbs-up"],
  disliked: ["thumbs-down"],
  target: ["target"],
  avoid: ["shield-slash"],
  carry: ["barbell"],
  absorb: ["shield-check"],
};

const inner = (name, weight) => {
  const svg = readFileSync(join(assets, weight, `${name}-${weight}.svg`), "utf8");
  return svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
};

const lines = Object.entries(ICONS).map(([id, [name, extra]]) => {
  const weights = { duotone: inner(name, "duotone") };
  if (extra) weights[extra] = inner(name, extra);
  return `  ${id}: ${JSON.stringify(weights)},`;
});
writeFileSync(
  out,
  `// Built by scripts/build-icons.mjs from Phosphor Icons (MIT, https://phosphoricons.com): don't edit by hand.\n` +
    `// Each icon's SVG content (viewBox 0 0 256 256, currentColor) by weight.\n` +
    `export const ICON_PATHS = {\n${lines.join("\n")}\n} as const satisfies Record<string, { duotone: string; fill?: string }>;\n`,
);
console.log(`${out}: ${lines.length} icons`);
