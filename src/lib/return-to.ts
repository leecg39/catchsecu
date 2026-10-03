function internalPath(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, "https://local.invalid");
    let decoded = url.pathname;
    for (let depth = 0; depth < 3; depth++) {
      decoded = decodeURIComponent(decoded);
      if (decoded.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(decoded)) return null;
      if (!/%[0-9a-f]{2}/i.test(decoded)) break;
    }
    if (url.origin !== "https://local.invalid") return null;
    return url.pathname + url.search;
  } catch { return null; }
}
export function safeReturnTo(value: string | null | undefined, fallback = "/dashboard"): string {
  return value ? internalPath(value) ?? fallback : fallback;
}
export function isSafeAuthCallback(value: unknown, origin: string): boolean {
  if (typeof value !== "string" || !value || /[\\\u0000-\u0020\u007f]/.test(value)) return false;
  if (value.startsWith("/")) return internalPath(value) !== null;
  try {
    const url = new URL(value);
    return url.origin === new URL(origin).origin && !url.username && !url.password && internalPath(url.pathname + url.search) !== null;
  } catch { return false; }
}
export function authPath(path: string, returnTo: string | null | undefined) {
  return path + "?returnTo=" + encodeURIComponent(safeReturnTo(returnTo));
}
