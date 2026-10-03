import { subjectName, subjectEmail } from "@/contracts/subjects";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { normalizedCatalogName } from "@/contracts/processing-catalog";
import type { ImportMapping, ImportPayload, ImportRowError, ImportSnapshot } from "@/contracts/imports";
import { MAX_FILE_BYTES } from "@/contracts/files";
import { tokenHash } from "./crypto";
import { fail } from "./http";

export function parseImportCsv(bytes: Buffer, encoding: string) {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) fail(413, "CSV_SIZE", "CSV 파일은 10MB 이하로 선택해주세요.");
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { fail(422, "CSV_ENCODING", "선택한 인코딩으로 파일을 읽을 수 없습니다."); }
  if (text.includes("\0")) fail(422, "CSV_ENCODING", "CSV 파일에 허용되지 않는 문자가 있습니다.");
  let records: { record: string[]; info: { lines: number } }[];
  try { records = parse(text, { bom: true, info: true, skip_empty_lines: true, relax_column_count: true,
    max_record_size: 1024 * 1024, to: 10002 }) as unknown as typeof records; }
  catch { fail(422, "CSV_SYNTAX", "CSV의 따옴표·구분자 또는 행 크기를 확인해주세요."); }
  const headers = records[0]?.record.map(value => value.trim()) ?? [];
  if (!headers.length || headers.length > 100 || headers.some(value => !value || value.length > 200))
    fail(422, "CSV_HEADERS", "첫 행에 비어 있지 않은 헤더를 100개 이하로 입력해주세요.");
  if (new Set(headers.map(normalizedCatalogName)).size !== headers.length) fail(422, "CSV_DUPLICATE_HEADER", "CSV 헤더 이름이 중복되었습니다.");
  if (records.length > 10001) fail(422, "CSV_ROW_LIMIT", "CSV는 데이터 10,000행까지 처리할 수 있습니다.");
  const rows = records.slice(1).map((entry, i) => ({ raw: entry.record, rowNo: i + 2, lineNo: entry.info.lines }))
    .filter(row => row.raw.some(value => value.trim()));
  if (!rows.length) fail(422, "CSV_EMPTY", "CSV에 데이터 행이 없습니다.");
  return { headers, rows };
}
export function csvDate(value: string): Date | null {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  // Date-only collection/expiry is midnight in the workspace's Korean business timezone.
  const day = value.slice(0, 10), dayUtc = new Date(day + "T00:00:00Z");
  if (Number.isNaN(dayUtc.getTime()) || dayUtc.toISOString().slice(0, 10) !== day) return null;
  const result = new Date(dateOnly ? value + "T00:00:00+09:00" : value);
  return Number.isNaN(result.getTime()) ? null : result;
}
export function checkImportMapping(mapping: ImportMapping, headers: string[], snapshot: ImportSnapshot) {
  const { purpose } = snapshot;
  const identity = mapping.fields.filter(f => f.subjectRole);
  if (identity.length && (identity.length !== 2 || new Set(identity.map(f => f.subjectRole)).size !== 2 ||
      mapping.fields.some((f, i) => f.subjectRole && (f.column === null || !purpose.items[i]?.required || (f.subjectRole === "email" ? f.type !== "email" : f.type !== "text")))))
    fail(422, "SUBJECT_MAPPING", "정보주체 이름(텍스트)과 이메일을 각각 필수 수집 항목의 컬럼에 지정해주세요.");
  if (mapping.fields.length !== purpose.items.length || mapping.fields.some((f, i) => f.name !== purpose.items[i].name || (purpose.items[i].required && f.column === null)))
    fail(422, "IMPORT_FIELDS", "수집 목적의 항목 순서와 필수 컬럼 매핑을 확인해주세요.");
  const mapped = mapping.fields.flatMap(f => f.column === null ? [] : [f.column]);
  if (new Set(mapped).size !== mapped.length) fail(422, "IMPORT_DUPLICATE_COLUMN", "서로 다른 개인정보 항목에 같은 컬럼을 지정할 수 없습니다.");
  const refs = [...mapped, mapping.consentColumn, mapping.evidenceColumn,
    mapping.collectedAt.mode === "column" ? mapping.collectedAt.column : null,
    mapping.retentionUntil?.mode === "column" ? mapping.retentionUntil.column : null];
  if (refs.some(col => col !== null && col >= headers.length)) fail(422, "IMPORT_COLUMN", "파일에 없는 컬럼입니다.");
  if (purpose.lawfulBasis === "consent" && mapping.consentColumn === null) fail(422, "IMPORT_CONSENT", "동의 근거에는 행별 동의 컬럼이 필요합니다.");
  if (purpose.retentionMode !== "days" && !mapping.retentionUntil) fail(422, "IMPORT_RETENTION", "실제 보유 종료일을 지정해주세요.");
  for (const source of [mapping.collectedAt, mapping.retentionUntil])
    if (source?.mode === "fixed" && !csvDate(source.value)) fail(422, "IMPORT_DATE", "고정 날짜를 YYYY-MM-DD 또는 시간대가 포함된 ISO 날짜로 입력해주세요.");
}
export function validateImportRows(csv: ReturnType<typeof parseImportCsv>, mapping: ImportMapping, snapshot: ImportSnapshot, now = new Date()) {
  checkImportMapping(mapping, csv.headers, snapshot);
  const seen = new Map<string, number>();
  return csv.rows.map(row => {
    const errors: ImportRowError[] = [];
    const add = (field: string, code: string, message: string) => errors.push({ field, code, message });
    if (row.raw.length !== csv.headers.length) add("행", "COLUMN_COUNT", "헤더와 열 수가 다릅니다.");
    if (row.raw.some(value => value.length > 10000)) add("행", "CELL_LENGTH", "셀은 10,000자까지 입력할 수 있습니다.");
    const values = mapping.fields.map((f, i) => {
      let value = f.column === null ? "" : (row.raw[f.column] ?? "").trim();
      if (!value) { if (snapshot.purpose.items[i].required) add(f.name, "REQUIRED", "필수 값이 비어 있습니다."); return ""; }
      if (f.subjectRole === "name" && !subjectName.safeParse(value).success) add(f.name, "SUBJECT_NAME", "정보주체 이름은 1~100자로 입력해주세요.");
      if (f.subjectRole === "email" && !subjectEmail.safeParse(value).success) add(f.name, "SUBJECT_EMAIL", "정보주체 이메일 형식을 확인해주세요.");
      if (f.type === "email" && !z.email().safeParse(value).success) add(f.name, "EMAIL", "이메일 형식이 아닙니다.");
      if (f.type === "phone") { value = value.replace(/[\s()-]/g, ""); if (!/^\+?\d{8,15}$/.test(value)) add(f.name, "PHONE", "전화번호 형식이 아닙니다."); }
      if (f.type === "number" && !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) add(f.name, "NUMBER", "숫자 형식이 아닙니다.");
      if (f.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !csvDate(value))) add(f.name, "DATE", "유효한 YYYY-MM-DD 날짜가 아닙니다.");
      return value;
    });
    const from = (source: ImportMapping["collectedAt"] | null) => source ? csvDate(source.mode === "fixed" ? source.value : (row.raw[source.column] ?? "").trim()) : null;
    const collected = from(mapping.collectedAt);
    if (!collected || collected > now) add("수집일", "COLLECTED_AT", "수집일이 없거나 유효하지 않거나 미래입니다.");
    const retention = snapshot.purpose.retentionMode === "days" && collected ?
      new Date(collected.getTime() + snapshot.purpose.retentionDays! * 86400000) : from(mapping.retentionUntil);
    if (!retention || retention <= now || (collected && retention <= collected)) add("보유 종료일", "RETENTION", "종료일이 유효하지 않거나 보유 기한이 끝났습니다.");
    const consent = mapping.consentColumn !== null && /^(true|1|y|yes|동의|동의함)$/i.test((row.raw[mapping.consentColumn] ?? "").trim());
    if (snapshot.purpose.lawfulBasis === "consent" && !consent) add("동의", "CONSENT", "동의 값이 확인되지 않습니다.");
    const payload: ImportPayload = { raw: row.raw, values, collectedAt: collected?.toISOString() ?? "", retentionUntil: retention?.toISOString() ?? "",
      consent: snapshot.purpose.lawfulBasis === "consent" && consent,
      evidence: mapping.evidenceColumn === null ? "" : (row.raw[mapping.evidenceColumn] ?? "") };
    // Only valid, identical records within this file are deduplicated. Separate imports are independent collections.
    const digest = tokenHash(JSON.stringify(payload)), duplicateOf = !errors.length ? seen.get(digest) ?? null : null;
    if (duplicateOf !== null) add("행", "DUPLICATE", "같은 파일의 " + duplicateOf + "번 행과 중복됩니다.");
    if (!errors.length) seen.set(digest, row.rowNo);
    return { rowNo: row.rowNo, lineNo: row.lineNo, payload, digest, duplicateOf, errors,
      status: duplicateOf !== null ? "duplicate" : errors.length ? "error" : "valid" };
  });
}
export function safeCsvCell(value: string) {
  const dangerous = /^[\s\uFEFF]*[=+@-]/.test(value.normalize("NFKC")) || /^[\t\r\n]/.test(value);
  return '"' + ((dangerous ? "'" : "") + value).replaceAll('"', '""') + '"';
}
export function encodeErrorCsv(headers: string[], rows: { raw: string[]; rowNo: number; errors: ImportRowError[] }[]) {
  return "\uFEFF" + [["CSV 행 번호", "오류", ...headers], ...rows.map(row => [String(row.rowNo), row.errors.map(e => e.field + ": " + e.message).join(" / "), ...row.raw])]
    .map(row => row.map(safeCsvCell).join(",")).join("\r\n") + "\r\n";
}
