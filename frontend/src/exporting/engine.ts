/** Which browser engine draws the page: Safari's (WebKit, the macOS app's window) needs a few things done its own way. */

/** Whether this is Safari's engine (the macOS app's WKWebView, or Safari), not a Chromium one (the Windows app's
 * WebView2, Chrome, Edge), whose user agents also name AppleWebKit. */
export function isSafariEngine(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|Edg\//.test(userAgent);
}
