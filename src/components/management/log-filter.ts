export type LogFilters = {
  search: string;
  field: string;
  service: string;
  start: string;
  end: string;
  startTime: string;
  endTime: string;
  specificTime: string;
  tab: number;
};
export const defaultLogFilters = (): LogFilters => ({
  search: '', field: '처리자명', service: '전체', start: '2026-09-02', end: '2026-10-02',
  startTime: '00:00', endTime: '23:59', specificTime: '09:00', tab: 0,
});
// The source uses local wall-clock timestamps. Parse numeric components explicitly,
// so YYYY-MM-DD never changes date through UTC conversion or browser differences.
export function parseLogTimestamp(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  const date = new Date(+year, +month - 1, +day, +hour, +minute, +second);
  if (date.getFullYear() !== +year || date.getMonth() !== +month - 1 || date.getDate() !== +day ||
      date.getHours() !== +hour || date.getMinutes() !== +minute || date.getSeconds() !== +second) return NaN;
  return date.getTime();
}
export function filterLogRows(rows: (string | number)[][], columns: string[], filters: LogFilters): (string | number)[][] {
  const dateIndex = columns.findIndex(column => ['처리일시', '일자', '수신일시'].includes(column));
  const serviceIndex = columns.findIndex(column => ['서비스명', '서비스 명'].includes(column));
  const fieldIndex = columns.indexOf(filters.field);
  const lower = filters.start ? parseLogTimestamp(`${filters.start} ${filters.startTime || '00:00'}:00`) : -Infinity;
  const upper = filters.end ? parseLogTimestamp(`${filters.end} ${filters.endTime || '23:59'}:59`) : Infinity;
  if (Number.isNaN(lower) || Number.isNaN(upper) || lower > upper) return [];
  return rows.filter(row => {
    if (filters.search && !(fieldIndex >= 0 ? String(row[fieldIndex]) : row.join(' ')).toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.service !== '전체' && serviceIndex >= 0 && row[serviceIndex] !== filters.service) return false;
    if (dateIndex >= 0) {
      const raw = String(row[dateIndex]);
      const timestamp = parseLogTimestamp(raw);
      if (!Number.isFinite(timestamp) || timestamp < lower || timestamp > upper) return false;
      if (filters.tab === 1 && filters.specificTime && raw.slice(11, 16) !== filters.specificTime) return false;
    }
    return true;
  });
}
