export type PageGateResult = {
  manifestPath: string;
  route: string;
  status?: number;
  expectedStatus?: number;
  finalUrl?: string;
  overflow?: Partial<Record<number, boolean>>;
  refreshed?: boolean;
  backOk?: boolean;
  retried?: boolean;
  attempts?: number;
  allowedUrls?: string[];
  expectedConsoleStatuses?: number[];
  consoleErrors: string[];
  error?: string;
  skipped?: string;
};

export function summarizePageGate(expected: string[], results: PageGateResult[]) {
  const expectedSet = new Set(expected);
  const seen = new Set<string>();
  const duplicate: string[] = [];
  for (const row of results) {
    if (seen.has(row.manifestPath)) duplicate.push(row.manifestPath);
    seen.add(row.manifestPath);
  }
  const missing = expected.filter(path => !seen.has(path));
  const unexpected = results.filter(row => !expectedSet.has(row.manifestPath)).map(row => row.manifestPath);
  const skipped = results.filter(row => row.skipped).map(row => ({ path: row.manifestPath, reason: row.skipped! }));
  const urlOk = (row: PageGateResult) => !!row.finalUrl && (row.allowedUrls ? row.allowedUrls.includes(row.finalUrl) : row.finalUrl === row.route.split(/[?#]/, 1)[0]);
  const failed = results.filter(row => !row.skipped && (
    row.expectedStatus !== undefined && row.expectedStatus !== 200
      ? row.status !== row.expectedStatus || !urlOk(row)
      : !!row.error || row.status !== 200 || !urlOk(row) || row.refreshed !== true || row.backOk !== true ||
        row.consoleErrors.length > 0 || [1440, 768, 390].some(width => row.overflow?.[width] !== false)
  )).map(row => row.manifestPath);
  return { result: missing.length || duplicate.length || unexpected.length || failed.length ? "failed" : skipped.length ? "passed_with_skips" : "passed",
    expected: expected.length, recorded: results.length, checked: results.length - skipped.length,
    missing, duplicate, unexpected, skipped, failed };
}

export function resolvePageFixture(path: string, fixtures: Record<string, string | undefined>) {
  const missing: string[] = [];
  const route = path.split("/").map(segment => {
    if (!segment.startsWith(":")) return segment;
    const value = fixtures[segment];
    if (!value) { missing.push(segment); return segment; }
    return encodeURIComponent(value);
  }).join("/");
  return { route, missing };
}
