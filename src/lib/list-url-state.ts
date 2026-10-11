export const listPageSizes = [10, 20, 50, 100] as const;

export function positivePage(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function pageSize(value: string | null, fallback = 20) {
  const parsed = Number(value);
  return listPageSizes.includes(parsed as (typeof listPageSizes)[number]) ? parsed : fallback;
}

export function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && allowed.includes(value as T) ? value as T : fallback;
}

export function listHref(pathname: string, current: string, values: Record<string, string | number | null>) {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === "" || (key === "page" && value === 1) || (key === "pageSize" && value === 20)) params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  return pathname + (query ? "?" + query : "");
}
