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

/** Images drawn smaller than this (portraits, sprites, icons) are scaled down to it once, to keep each picture small. */
const SMALL_IMAGE = 192;

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
      return canvas.toDataURL("image/png");
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

/** The page's styles, made to apply inside a picture: `:root` and `html` become the wrapper. */
async function pageCss(): Promise<string> {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) parts.push(rule.cssText);
  }
  const css = parts.join("\n").replace(/:root\b/g, ".snapshot-root").replace(/(^|[\s,}])html\b/g, "$1.snapshot-root");
  return inlineCss(css);
}

let cssCache: { key: string; css: Promise<string> } | null = null;

/** The page's styles, read again when style sheets were added or removed (another font loaded). */
function stylesNow(): Promise<string> {
  const key = Array.from(document.styleSheets).map((s) => {
    try {
      return `${s.href ?? "inline"}:${s.cssRules.length}`;
    } catch {
      return "x";
    }
  }).join("|");
  if (cssCache?.key !== key) cssCache = { key, css: pageCss() };
  return cssCache.css;
}

/** What makes a picture of an element: the page's styles, and the root element's own look (theme, variables). */
export interface Snapshotter {
  /** The element as an SVG document `width` × `height` CSS pixels, drawn `scale` times as big. */
  svg(el: HTMLElement, width: number, height: number, scale: number): Promise<string>;
  /** The SVG as a decoded image, ready to paint. */
  image(svg: string): Promise<HTMLImageElement>;
}

/** Gets the page's styles and fonts ready (read once, then kept). */
export async function snapshotter(): Promise<Snapshotter> {
  await document.fonts.ready;
  const css = await stylesNow();
  const root = document.documentElement;
  // The root's own variables (theme, fonts, text size, the minimap's tiles), with its images inlined too.
  const rootStyle = await inlineCss(root.getAttribute("style") ?? "");
  const theme = root.dataset.theme ? ` data-theme="${root.dataset.theme}"` : "";
  const fontSize = getComputedStyle(root).fontSize;

  const svg = async (el: HTMLElement, width: number, height: number, scale: number) => {
    const copy = el.cloneNode(true) as HTMLElement;
    await Promise.all(Array.from(copy.querySelectorAll<Element>("img, image")).map(async (node) => {
      const attr = node.tagName.toLowerCase() === "img" ? "src" : "href";
      const url = node.getAttribute(attr) ?? node.getAttribute("xlink:href");
      if (!url || url.startsWith("data:")) return;
      // The map's own picture is drawn big; everything else is a portrait, sprite or icon.
      const big = node.classList.contains("map-own") || node.hasAttribute("data-snapshot-full");
      try {
        node.setAttribute(attr, await inline(new URL(url, document.baseURI).href, big ? null : SMALL_IMAGE * scale));
      } catch {
        node.removeAttribute(attr);
      }
    }));
    for (const node of Array.from(copy.querySelectorAll<HTMLElement>("[style*='url(']"))) {
      node.setAttribute("style", await inlineCss(node.getAttribute("style") ?? ""));
    }
    const body = new XMLSerializer().serializeToString(copy);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}" style="font-size:${fontSize}">`
      + `<foreignObject x="0" y="0" width="${width}" height="${height}">`
      + `<div xmlns="http://www.w3.org/1999/xhtml" class="snapshot-root"${theme} style="${escapeAttr(rootStyle)};width:${width}px;height:${height}px;overflow:hidden;margin:0;font-size:${fontSize}">`
      + `<style>${escapeText(css)}</style>${body}</div></foreignObject></svg>`;
  };

  const image = async (doc: string) => {
    const img = new Image();
    img.decoding = "async";
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(doc)}`;
    await img.decode();
    return img;
  };
  return { svg, image };
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A picture of an element as a PNG, `scale` times its size on the page. */
export async function elementPng(el: HTMLElement, scale = 2): Promise<Blob> {
  const snap = await snapshotter();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const img = await snap.image(await snap.svg(el, width, height, scale));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image"))), "image/png"));
}
