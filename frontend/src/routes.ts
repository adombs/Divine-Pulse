export type Page = "home" | "roster" | "battle" | "history" | "archive" | "supports" | "runs" | "settings";
const PAGES: Page[] = ["home", "roster", "battle", "history", "archive", "supports", "runs", "settings"];

export interface Route {
  page: Page;
  tab?: string;
  id?: string;
  q?: string;
}

export function toHash(r: Route): string {
  if (r.page === "battle" && r.id) return `#/battle/${encodeURIComponent(r.id)}${r.q ? `?q=${encodeURIComponent(r.q)}` : ""}`;
  const parts = [r.page, r.tab ?? "", r.id ?? ""].map(encodeURIComponent);
  while (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
  return `#/${parts.join("/")}${r.q ? `?q=${encodeURIComponent(r.q)}` : ""}`;
}

export function fromHash(hash: string): Route {
  try {
    const [path, query] = hash.replace(/^#\/?/, "").split("?");
    const parts = path.split("/").map((s) => decodeURIComponent(s || ""));
    const [page, tab, id] = parts;
    const q = new URLSearchParams(query ?? "").get("q") ?? undefined;
    if (page === "battle" && tab) return { page: "battle", id: tab, q };
    // Characters and Crests moved into the Archive: older links and bookmarks still open them there.
    if (page === "characters") return { page: "archive", tab: tab === "crests" ? "crests" : "characters", id: id || undefined, q };
    return { page: PAGES.includes(page as Page) ? (page as Page) : "home", tab: tab || undefined, id: id || undefined, q };
  } catch {
    return { page: "home" };
  }
}
