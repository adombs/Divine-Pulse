export const bundledGameImage = (name: string) => name.startsWith("mini-") ? `images/map/minimap-pieces/${name.slice(5)}` : `images/map/${name}`;
export const bundledPortrait = (file: string) => `portrait-key:${file}`;
export const bundledHouse = (name: string) => `images/houses/${name}.png`;
/** A faction's name in the game's language -> its banner file. */
export const factionBanners = new Map<string, string>();
export const portraitKeyFromUrl = (url: string) => url.startsWith("portrait-key:") ? url.slice(13).replace(/\.png$/, "") : null;
export function importedPortrait(url: string | null, index: { app_keys?: Record<string, string> } | null): string | null {
  if (url?.startsWith("images/portraits/")) return url;
  const key = url && portraitKeyFromUrl(url);
  return key && typeof index?.app_keys?.[key] === "string" ? index.app_keys[key] : null;
}
export const importedMapImage = (url: string): string | null => url.startsWith("images/map/") ? url : null;

/** CSS for a mask from useGameImageUrl; no mask until the image is there. */
export const maskStyle = (url: string) => url ? { maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` } : {};
