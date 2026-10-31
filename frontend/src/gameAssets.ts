// Assets extracted from the user's own game dump, served by the backend under /game-assets/ (see
// docs/game-assets/README.md and docs/api-contracts.md "Game assets"). Everything here falls back quietly: with no
// import, or a missing file, callers get null and keep using the app's bundled files.

export interface GameAssetsStatus {
  available: boolean;
  /** When the import was made: a new value means the files changed. */
  created?: string;
  languages?: string[];
}

let status: GameAssetsStatus = { available: false };
let statusRequest: Promise<GameAssetsStatus> | null = null;
const jsonCache = new Map<string, Promise<unknown>>();
const listeners = new Set<(status: GameAssetsStatus) => void>();

export function gameAssetsAvailable(): boolean {
  return status.available;
}

/** Ask the backend once (or again with refresh), e.g. at start and after an import finishes. */
export function loadGameAssetsStatus(refresh = false): Promise<GameAssetsStatus> {
  if (statusRequest && !refresh) return statusRequest;
  statusRequest = fetch("/api/game-assets/status")
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
    .then((loaded: GameAssetsStatus | null) => {
      const next = loaded && typeof loaded.available === "boolean" ? loaded : { available: false };
      const changed = next.available !== status.available || next.created !== status.created;
      status = next;
      if (changed) {
        jsonCache.clear();
        listeners.forEach((listener) => listener(status));
      }
      return status;
    });
  return statusRequest;
}

/** Called with the new status whenever an import adds, replaces or removes the assets. */
export function onGameAssetsChange(listener: (status: GameAssetsStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** URL of an extracted file by its path in the output folder, e.g. "images/icons/abilities/12.png". */
export function gameAssetUrl(rel: string): string {
  return `/game-assets/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

/** The extracted file's URL when assets are imported, otherwise the bundled fallback (or null). */
export function preferGameAsset(rel: string | null | undefined, fallback: string | null = null): string | null {
  return rel && status.available ? gameAssetUrl(rel) : fallback;
}

/** An extracted JSON file (cached until the assets change), or null when absent or unreadable. */
export function loadGameJson<T>(rel: string): Promise<T | null> {
  if (!status.available) return Promise.resolve(null);
  let request = jsonCache.get(rel);
  if (!request) {
    request = fetch(gameAssetUrl(rel))
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    jsonCache.set(rel, request);
  }
  return request as Promise<T | null>;
}

/** One category of names or descriptions from text/<language>.json, keyed by game id; {} when absent. */
export async function loadGameText(category: string, language = "ENG_U"): Promise<Record<string, string>> {
  const text = await loadGameJson<{ categories?: Record<string, Record<string, string>> }>(`text/${language}.json`);
  return text?.categories?.[category] ?? {};
}
