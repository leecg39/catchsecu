"use client";
import type { ReactNode } from "react";
import { EmptyState } from "./shared";

export function RemoteTable({ columns, rows, total, page, pageSize, onPage, onPageSize, loading, error, empty = "데이터가 없습니다" }: {
  columns: string[]; rows: { id: string; cells: ReactNode[] }[]; total: number; page: number; pageSize: number;
  onPage: (page: number) => void; onPageSize: (size: number) => void; loading?: boolean; error?: string; empty?: string;
}) {
  return <><div className="cs-table-wrap"><table className="cs-table" aria-busy={loading}>
    <thead><tr>{columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead>
    <tbody>{loading ? <tr><td colSpan={columns.length}><p role="status">불러오는 중입니다.</p></td></tr> : error ?
      <tr><td colSpan={columns.length}><p role="alert">{error}</p></td></tr> : rows.length ? rows.map(row =>
        <tr key={row.id}>{row.cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>) :
        <tr><td colSpan={columns.length}><EmptyState text={empty} /></td></tr>}</tbody>
  </table></div><div className="cs-pagination"><span>총 {total}개</span>
    <select aria-label="페이지당 행 수" value={pageSize} onChange={event => onPageSize(Number(event.target.value))}>
      {[10, 20, 50, 100].map(size => <option key={size}>{size}</option>)}</select>
    <div><button aria-label="이전 페이지" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>‹</button>
      <span>{page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
      <button aria-label="다음 페이지" disabled={loading || page * pageSize >= total} onClick={() => onPage(page + 1)}>›</button></div>
  </div></>;
}
