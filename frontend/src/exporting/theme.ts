/**
 * An export in a theme of its own (light or dark, whatever the app is in): the app's theme rules are written for the
 * page's root (`:root[data-theme="dark"]`, and descendants of it), so they're copied once, scoped to a class instead,
 * and put on the element the preview shows and the export draws. "app" leaves the export in the app's own theme.
 */
import { useEffect } from "react";

export type ExportTheme = "app" | "light" | "dark";

export const THEME_OPTIONS: [ExportTheme, string][] = [
  ["app", "As the app"],
  ["light", "Light"],
  ["dark", "Dark"],
];

const STYLE_ID = "export-theme-scopes";

/** The page's theme rules again, each `:root[data-theme="x"]` (alone or before a descendant) as `.export-theme-x`. */
function scopedRules(): string {
  const out: string[] = [];
  const scope = (selector: string) => selector.split(",").map((part) => part.trim()).filter((part) => /:root\[data-theme="(light|dark)"\]/.test(part))
    .map((part) => part.replace(/:root\[data-theme="(light|dark)"\]/, ".export-theme-$1"));
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const selectors = scope(rule.selectorText);
        if (selectors.length) out.push(`${selectors.join(", ")} { ${rule.style.cssText} }`);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    if ((sheet.ownerNode as Element | null)?.id === STYLE_ID) continue;
    try {
      visit(sheet.cssRules);
    } catch {
      // Another origin's sheet: not ours.
    }
  }
  // The scoped element draws its own page: its text in the theme's ink.
  out.push(".export-theme-light, .export-theme-dark { color: var(--ink); }");
  return out.join("\n");
}

/** Keeps the scoped theme rules on the page while an export window is open. */
export function useExportThemes(): void {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = scopedRules();
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
}

/** The class that puts an export in a theme ("" for the app's own). */
export const themeClass = (theme: ExportTheme) => (theme === "app" ? "" : `export-theme-${theme}`);
