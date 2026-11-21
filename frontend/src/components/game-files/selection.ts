/** A pasted path as the file system knows it: without the quotes a copied path may carry ("C:\…" from Windows'
 * Copy as path, '/Users/…' from a shell) and, for a Mac path, without the backslashes Terminal puts before spaces
 * and other characters when a file is dragged into it ("/Users/me/FE3H\ Base.nsp"). */
function cleanPath(path: string): string {
  const bare = path.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  return /^[/~]/.test(bare) ? bare.replace(/\\(.)/g, "$1") : bare;
}

/** Keep the first spelling of each path, in selection order (case and slashes aside, as Windows and macOS's own
 * disks ignore case). */
export function mergeNspPaths(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  // Only new paths are cleaned: the selection already is, and a second pass would take a real backslash out.
  return [...existing, ...incoming.map(cleanPath)].filter((path) => {
    if (!path) return false;
    const key = path.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
