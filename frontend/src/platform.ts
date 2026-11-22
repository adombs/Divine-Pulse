/**
 * Which computer the app runs on, for what differs there: shortcut names (⌥ and ⌘ on a Mac, Alt and Ctrl on
 * Windows), the words for files and folders, and the history keys the macOS window lacks.
 *
 * The page is always shown on the computer the tracker runs on (the server only listens on 127.0.0.1), so the
 * browser's own platform is the tracker's.
 */

export type Platform = "macos" | "windows" | "linux";

interface NavigatorLike {
  platform?: string;
  userAgent?: string;
}

const here = (): NavigatorLike => (typeof navigator === "undefined" ? {} : navigator);

/** The platform from the browser's own report: a Mac's says MacIntel (Apple silicon too) and Macintosh, Linux's Linux. */
export function detectPlatform(nav: NavigatorLike = here()): Platform {
  if (/^Mac/.test(nav.platform ?? "") || /Macintosh|Mac OS X/.test(nav.userAgent ?? "")) return "macos";
  if (/Linux/.test(nav.platform ?? "") || /Linux|X11/.test(nav.userAgent ?? "")) return "linux";
  return "windows";
}

/** The platform's name, as the app shows it. */
export const PLATFORM_NAME: Record<Platform, string> = { macos: "macOS", windows: "Windows", linux: "Linux" };

export const PLATFORM: Platform = detectPlatform();
export const IS_MAC = PLATFORM === "macos";

/** Whether this is Safari's engine (the macOS app's WKWebView, or Safari), not a Chromium one (the Windows app's
 * WebView2, Chrome, Edge), whose user agents also name AppleWebKit. */
export function isSafariEngine(userAgent = here().userAgent ?? ""): boolean {
  return /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|Edg\//.test(userAgent);
}

/** Whether this is the macOS app's own window (WKWebView), not Safari: Safari's user agent ends in "Safari/…", the
 * bare WKWebView's doesn't. Safari has its own Back menu; the app's window has none. */
export function isMacAppWindow(userAgent = here().userAgent ?? ""): boolean {
  return isSafariEngine(userAgent) && !/Safari\//.test(userAgent);
}

const MAC_KEYS: Record<string, string> = { Alt: "⌥", Ctrl: "⌃", Cmd: "⌘", Shift: "⇧" };

/** A shortcut as the platform writes it: ["Alt", "←"] is "Alt+←" on Windows and "⌥←" on a Mac. */
export function keyLabel(keys: string[], mac = IS_MAC): string {
  return mac ? keys.map((k) => MAC_KEYS[k] ?? k).join("") : keys.join("+");
}

/** The Alt key's name in a sentence: "Option" on a Mac. */
export const altKeyName = (mac = IS_MAC) => (mac ? "Option" : "Alt");

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** A Mac's history keys: ⌘[ goes back and ⌘] forward (as in Safari and Finder). ⌘← and ⌘→ the window does itself.
 * Returns the step, or null for any other key. */
export function historyKeyStep(e: KeyLike): -1 | 1 | null {
  if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  return e.key === "[" ? -1 : e.key === "]" ? 1 : null;
}

/** A mouse's back (button 3) and forward (button 4) buttons, which the macOS window reports but doesn't act on. */
export function historyButtonStep(button: number): -1 | 1 | null {
  return button === 3 ? -1 : button === 4 ? 1 : null;
}
