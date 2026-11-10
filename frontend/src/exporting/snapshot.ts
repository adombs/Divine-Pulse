/**
 * Pictures of the app's own views, for exports (a battle's replay as a video, the team as images): an element is
 * copied into an SVG `foreignObject` with the page's styles, so the picture is drawn by the browser exactly as the
 * element is drawn on the page, then painted onto a canvas.
 *
 * An SVG drawn as an image can't load anything, so everything it needs is put inside it: the page's style sheets
 * (`:root` and `html` rules made to apply to the copy's wrapper, as the page's root element doesn't come along),
 * the fonts and every image, as data URLs. Those are read once and kept. The copy loses scroll positions, so views
 * meant for a picture are laid out not to need scrolling.
 *
 * A data URL, not a blob URL: Chromium marks a canvas painted with a blob URL's `foreignObject` as unreadable.
 */

/** Portraits and icons are never drawn bigger than this (CSS pixels; a portrait on the most zoomed-in map), so they're
 * scaled down to it once, times the picture's scale, and kept as WebP: each picture carries them all, so smaller is
 * faster. */
const SMALL_IMAGE = 128;

const dataUrls = new Map<string, Promise<string>>();

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read an image"));
    reader.readAsDataURL(blob);
  });
}

/** A URL's file as a data URL; images bigger than `shrink` pixels on their long side are scaled down to it. */
function inline(url: string, shrink: number | null): Promise<string> {
  const key = `${shrink ?? "full"} ${url}`;
  let found = dataUrls.get(key);
  if (!found) {
    found = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Couldn't read ${url} (${response.status})`);
      const blob = await response.blob();
      if (shrink === null || !blob.type.startsWith("image/") || blob.type === "image/svg+xml") return readAsDataUrl(blob);
      const bitmap = await createImageBitmap(blob);
      const long = Math.max(bitmap.width, bitmap.height);
      if (long <= shrink) {
        bitmap.close();
        return readAsDataUrl(blob);
      }
      const k = shrink / long;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * k));
      canvas.height = Math.max(1, Math.round(bitmap.height * k));
      const g = canvas.getContext("2d")!;
      g.imageSmoothingQuality = "high";
      g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return canvas.toDataURL("image/webp", 0.92);
    })();
    found.catch(() => dataUrls.delete(key));
    dataUrls.set(key, found);
  }
  return found;
}

const URL_IN_CSS = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/** Every `url(...)` in some CSS swapped for its data URL (left as it was if it can't be read). Fonts other than woff2
 * are dropped: woff2 is all Chromium needs, and the others would only make every picture bigger. */
async function inlineCss(css: string): Promise<string> {
  const urls = new Set<string>();
  for (const m of css.matchAll(URL_IN_CSS)) {
    const url = m[2];
    if (!url.startsWith("data:") && !url.startsWith("#") && !/\.(woff|ttf|otf|eot)(\?|$)/i.test(url)) urls.add(url);
  }
  const found = new Map<string, string>();
  await Promise.all([...urls].map(async (url) => {
    try {
      found.set(url, await inline(new URL(url, document.baseURI).href, null));
    } catch {
      // Left as it is: the picture just goes without it.
    }
  }));
  return css.replace(URL_IN_CSS, (all, _q, url: string) => {
    if (/\.(woff|ttf|otf|eot)(\?|$)/i.test(url)) return "url(data:,)";
    const data = found.get(url);
    return data ? `url("${data}")` : all;
  });
}

/** Which of the page's style rules a picture needs: all of them, or only those a layer of the battle map uses. */
export type StyleSet = "all" | "map";

/** A rule a picture of the battle map (with its turn banner) can use: by what its selector names. Rules for the
 * root's variables, fonts and every element (`*`) stay; media queries and keyframes don't apply in a fixed frame. */
const MAP_SELECTOR = /snapshot-root|map|minimap|replay|rewind|icon|game-asset|portrait|sprite|^\s*\*|^\s*svg/;

function keepRule(text: string, set: StyleSet): boolean {
  if (set === "all") return true;
  if (text.startsWith("@font-face")) return true;
  if (text.startsWith("@")) return false;
  return MAP_SELECTOR.test(text.slice(0, text.indexOf("{")));
}

/**
 * A style sheet's top-level rules as its author wrote them (comments dropped), split where each rule ends. The source is
 * read rather than the browser's `cssText`: Chromium writes a shorthand that uses `var()` and is then partly overridden
 * in the same rule (`font: 600 0.82rem var(--display); line-height: 1.15`) as empty longhands (`font-size: ;`), which
 * a copy then ignores, so the picture would be laid out in the wrong font and come out a different size.
 */
export function splitRules(css: string): string[] {
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  let out = "";
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      out += css.slice(i, j + 1);
      i = j;
      continue;
    }
    out += c;
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      rules.push(out.slice(start).trim());
      start = out.length;
    } else if (c === ";" && depth === 0) {
      // A statement (@import, @charset, @layer a, b;): its sheet's own rules come separately.
      start = out.length;
    }
  }
  return rules.filter(Boolean);
}

/** Every relative `url(...)` in a sheet's source made absolute against the sheet's own address. */
const absoluteUrls = (css: string, base: string) => css.replace(URL_IN_CSS, (all, q: string, url: string) => (
  /^(data:|#|[a-z][a-z0-9+.-]*:)/i.test(url) ? all : `url(${q}${new URL(url, base).href}${q})`
));

/** A sheet's rules as written: a <style>'s text, a <link>'s file, or (neither readable) the browser's own `cssText`. */
async function sheetRules(sheet: CSSStyleSheet): Promise<string[]> {
  const node = sheet.ownerNode;
  let source: string | null = null;
  if (node instanceof HTMLStyleElement) source = node.textContent;
  else if (sheet.href) {
    try {
      const response = await fetch(sheet.href);
      if (response.ok) source = absoluteUrls(await response.text(), sheet.href);
    } catch {
      // Read from the CSSOM below.
    }
  }
  const rules = Array.from(sheet.cssRules);
  // Sheets it @imports aren't in its text: read each of those the same way.
  const imported = await Promise.all(rules.filter((r): r is CSSImportRule => r instanceof CSSImportRule && !!r.styleSheet).map((r) => sheetRules(r.styleSheet!)));
  const own = source !== null ? splitRules(source) : rules.filter((r) => !(r instanceof CSSImportRule)).map((r) => r.cssText);
  return [...imported.flat(), ...own];
}

/** The page's styles, made to apply inside a picture: `:root` and `html` become the wrapper. */
async function pageCss(set: StyleSet): Promise<string> {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: string[];
    try {
      rules = await sheetRules(sheet);
    } catch {
      continue;
    }
    for (const rule of rules) {
      const text = rule.replace(/:root\b/g, ".snapshot-root").replace(/(^|[\s,}])html\b/g, "$1.snapshot-root");
      if (keepRule(text, set)) parts.push(text);
    }
  }
  // A picture restarts every CSS animation at its first instant (a fade-in would be invisible) and has no time for a
  // transition: everything is drawn as it finally stands. The export moves things frame by frame itself.
  const still = ".snapshot-root *, .snapshot-root *::before, .snapshot-root *::after { animation: none !important; transition: none !important; }";
  return `${await inlineCss(parts.join("\n"))}\n${still}`;
}

const cssCache = new Map<StyleSet, { key: string; css: Promise<string> }>();

/** The page's styles, read again when style sheets were added or removed (another font loaded). */
function stylesNow(set: StyleSet): Promise<string> {
  const key = Array.from(document.styleSheets).map((s) => {
    try {
      return `${s.href ?? "inline"}:${s.cssRules.length}`;
    } catch {
      return "x";
    }
  }).join("|");
  const cached = cssCache.get(set);
  if (cached?.key === key) return cached.css;
  const css = pageCss(set);
  cssCache.set(set, { key, css });
  return css;
}

/**
 * One layer of a picture: parts of the element left out, so a frame can be drawn in layers that change at different
 * rates (a video's log changes once a step, its map every frame).
 */
export interface Layer {
  /** These stay in place, keeping their size, but are drawn empty and see-through (their contents dropped). */
  hide?: string[];
  /** These are dropped. */
  remove?: string[];
  /** The style rules it needs (default: all). */
  styles?: StyleSet;
  /** More rules for this layer (a see-through background, say). */
  css?: string;
}

/** What makes a picture of an element: the page's styles, and the root element's own look (variables). */
export interface Snapshotter {
  /** The element (or one layer of it) as an SVG document `width` × `height` CSS pixels, drawn `scale` times as big. */
  svg(el: HTMLElement, width: number, height: number, scale: number, layer?: Layer): Promise<string>;
  /** The SVG as a decoded image, ready to paint. With `into`, that image element is loaded afresh (what it showed is
   * let go at once) instead of a new one being made: a video needs a new picture every frame, and an element per
   * frame would leave a big decoded picture behind for each until the browser got round to collecting it. */
  image(svg: string, into?: HTMLImageElement): Promise<HTMLImageElement>;
}

/** The inherited properties a picture's wrapper takes from where the element stands on the page. */
const INHERITED = [
  "font-family", "font-size", "font-weight", "font-style", "font-stretch", "font-variant-numeric", "font-feature-settings",
  "line-height", "color", "letter-spacing", "word-spacing", "text-transform", "text-align", "direction",
];

/** Gets the page's styles and fonts ready (read once, then kept). */
export async function snapshotter(): Promise<Snapshotter> {
  await document.fonts.ready;
  const styles: Record<StyleSet, string> = { all: await stylesNow("all"), map: await stylesNow("map") };
  const root = document.documentElement;
  // The root's own variables (fonts, text size, the minimap's tiles), with its images inlined too.
  const rootStyle = await inlineCss(root.getAttribute("style") ?? "");
  const fontSize = getComputedStyle(root).fontSize;

  const svg = async (el: HTMLElement, width: number, height: number, scale: number, layer: Layer = {}) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const selector of layer.remove ?? []) for (const node of Array.from(copy.querySelectorAll(selector))) node.remove();
    for (const selector of layer.hide ?? []) {
      for (const node of Array.from(copy.querySelectorAll<HTMLElement | SVGElement>(selector))) {
        node.replaceChildren();
        node.setAttribute("style", `${node.getAttribute("style") ?? ""};visibility:hidden`);
      }
    }
    await Promise.all(Array.from(copy.querySelectorAll<Element>("img, image")).map(async (node) => {
      const attr = node.tagName.toLowerCase() === "img" ? "src" : "href";
      const url = node.getAttribute(attr) ?? node.getAttribute("xlink:href");
      if (!url || url.startsWith("data:")) return;
      // Portraits and icons are drawn whole and small, so they're scaled down. The map's own picture is drawn big, and a
      // sprite sheet is cut into cells (an <svg> inside the map, its viewBox showing one cell): those keep every pixel.
      const inner = node.parentElement?.closest("svg");
      const sheet = !!inner?.hasAttribute("viewBox") && !!inner.parentElement?.closest("svg");
      const big = node.classList.contains("map-own") || node.hasAttribute("data-snapshot-full") || sheet;
      try {
        node.setAttribute(attr, await inline(new URL(url, document.baseURI).href, big ? null : SMALL_IMAGE * scale));
      } catch {
        node.removeAttribute(attr);
      }
    }));
    for (const node of Array.from(copy.querySelectorAll<HTMLElement>("[style*='url(']"))) {
      node.setAttribute("style", await inlineCss(node.getAttribute("style") ?? ""));
    }
    shareImages(copy);
    const body = new XMLSerializer().serializeToString(copy);
    const css = `${styles[layer.styles ?? "all"]}\n${layer.css ?? ""}`;
    // What the element inherits where it stands (the body's font and line height, say), so the copy starts from the
    // same text as the page: the page's <body> doesn't come along, and the wrapper alone would have the root's.
    const around = getComputedStyle(el.parentElement ?? root);
    const inherited = INHERITED.map((p) => `${p}:${around.getPropertyValue(p)}`).join(";");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}" style="font-size:${fontSize}">`
      + `<foreignObject x="0" y="0" width="${width}" height="${height}">`
      + `<div xmlns="http://www.w3.org/1999/xhtml" class="snapshot-root" style="${escapeAttr(`${rootStyle};width:${width}px;height:${height}px;overflow:hidden;margin:0;${inherited}`)}">`
      + `<style>${escapeText(css)}</style>${body}</div></foreignObject></svg>`;
  };

  const image = async (doc: string, into?: HTMLImageElement) => {
    const img = into ?? new Image();
    img.decoding = "async";
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(doc)}`;
    await img.decode();
    return img;
  };
  return { svg, image };
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK = "http://www.w3.org/1999/xlink";

/**
 * Each picture once per drawing: an SVG <image> drawn in several places (the sprite sheet under every unit, the same
 * portrait twice) is put once in the drawing's <defs>, and each place shows it with a <use>, moved to where it was.
 * Every picture is inlined as a data URL, so without this a map with 40 units carries the sprite sheet 40 times.
 */
function shareImages(copy: Element): void {
  const groups = new Map<string, SVGImageElement[]>();
  for (const node of Array.from(copy.querySelectorAll("image")) as SVGImageElement[]) {
    const href = node.getAttribute("href") ?? node.getAttributeNS(XLINK, "href");
    const root = outermostSvg(node);
    if (!href?.startsWith("data:") || !root) continue;
    // The same picture at the same size; where it goes (x, y) is the <use>'s.
    const key = [href, ...["width", "height", "preserveAspectRatio", "class"].map((a) => node.getAttribute(a) ?? "")].join("|");
    const list = groups.get(key) ?? [];
    list.push(node);
    groups.set(key, list);
  }
  let n = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const root = outermostSvg(list[0])!;
    let defs = Array.from(root.children).find((c) => c.localName === "defs");
    if (!defs) {
      defs = document.createElementNS(SVG_NS, "defs");
      root.insertBefore(defs, root.firstChild);
    }
    const id = `snapshot-image-${n++}`;
    const shared = list[0].cloneNode(false) as SVGImageElement;
    for (const a of ["x", "y", "id", "class", "style", "clip-path", "opacity", "transform"]) shared.removeAttribute(a);
    shared.setAttribute("id", id);
    defs.appendChild(shared);
    for (const node of list) {
      const use = document.createElementNS(SVG_NS, "use");
      use.setAttribute("href", `#${id}`);
      for (const a of Array.from(node.attributes)) {
        if (!["href", "width", "height", "preserveAspectRatio", "id"].includes(a.name) && a.namespaceURI !== XLINK) use.setAttribute(a.name, a.value);
      }
      node.replaceWith(use);
    }
  }
}

/** The topmost <svg> an element is drawn in (the same picture can be shared anywhere inside it). */
function outermostSvg(node: Element): Element | null {
  let found: Element | null = null;
  for (let at: Element | null = node.parentElement; at; at = at.parentElement) if (at.localName === "svg") found = at;
  return found;
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The size (CSS pixels) a picture of an element is made at: its box, or what it draws past that. Export dialogs show
 * this times the chosen scale, so what they promise is exactly what is saved.
 */
export function pictureSize(el: HTMLElement): [number, number] {
  return [Math.max(el.offsetWidth, el.scrollWidth), Math.max(el.offsetHeight, el.scrollHeight)];
}

/** A picture's size in pixels at `scale`, as the PNG will be. */
export const picturePixels = ([w, h]: [number, number], scale: number): [number, number] => [Math.round(w * scale), Math.round(h * scale)];

/** A picture of an element as a PNG, `scale` times its size on the page (`pictureSize`). */
export async function elementPng(el: HTMLElement, scale = 2): Promise<Blob> {
  const snap = await snapshotter();
  const [width, height] = pictureSize(el);
  const img = await snap.image(await snap.svg(el, width, height, scale));
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = picturePixels([width, height], scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image"))), "image/png"));
}
