import { fail } from "./http";

const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;

export function analyticsPeriod(input: { from?: string; to?: string }, asOf: Date) {
  const requestedTo = input.to ? new Date(input.to) : asOf;
  const koreaDate = new Date(requestedTo.getTime() + KOREA_OFFSET_MS);
  const from = input.from ? new Date(input.from) : new Date(
    Date.UTC(koreaDate.getUTCFullYear(), koreaDate.getUTCMonth(), 1) - KOREA_OFFSET_MS);
  const to = requestedTo > asOf ? asOf : requestedTo;
  if (from >= to || requestedTo.getTime() - from.getTime() > 366 * 86400000)
    fail(422, "ANALYTICS_PERIOD", "조회 기간은 최대 366일이며 현재까지 지정할 수 있습니다.");
  return { from, to };
}
