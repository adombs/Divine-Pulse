/** Keep the first spelling of each Windows path, in selection order. */
export function mergeNspPaths(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  return [...existing, ...incoming].map((path) => path.trim().replace(/^"(.*)"$/, "$1")).filter((path) => {
    if (!path) return false;
    const key = path.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
