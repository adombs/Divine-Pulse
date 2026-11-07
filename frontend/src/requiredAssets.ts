/** Missing game content is an error/sentinel, never permission to substitute another image. */
export type AssetIssue = { path: string; reason: "missing" | "unreadable"; message: string };
const issues = new Map<string, AssetIssue>();
const listeners = new Set<() => void>();

export class RequiredGameAssetError extends Error {
  readonly path: string;
  constructor(path: string, message = "Required game file unavailable") {
    super(`${message}: ${path}. Reimport your game files.`);
    this.name = "RequiredGameAssetError";
    this.path = path;
    reportAssetIssue(path, "unreadable");
  }
}

export function assertAssetPath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes(":")
    || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid game asset path: ${path || "(empty)"}`);
  }
}

export function reportAssetIssue(path: string, reason: AssetIssue["reason"]): void {
  if (issues.has(path)) return;
  issues.set(path, { path, reason, message: `${reason === "missing" ? "Missing" : "Unreadable"} game file: ${path}` });
  listeners.forEach((listener) => listener());
}

export function assetIssues(): readonly AssetIssue[] { return [...issues.values()]; }
export function clearAssetIssues(): void {
  if (!issues.size) return;
  issues.clear();
  listeners.forEach((listener) => listener());
}
export function onAssetIssuesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
