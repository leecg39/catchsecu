export function safeReturnTo(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://local.invalid");
    const decoded = decodeURIComponent(url.pathname);
    if (url.origin !== "https://local.invalid" || decoded.startsWith("//") || /[\\\u0000-\u0020]/.test(decoded)) return fallback;
    return url.pathname + url.search;
  } catch { return fallback; }
}
export function authPath(path: string, returnTo: string | null | undefined) {
  return path + "?returnTo=" + encodeURIComponent(safeReturnTo(returnTo));
}
