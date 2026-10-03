"use client";
import { useState } from "react";
import Link from "next/link";
import { useResource } from "@/lib/api";
import type { Paged } from "@/contracts/forms";
import { feedbackLabels, type SuppressionRecord } from "@/contracts/email-feedback";
import { ActionButton, Panel, PageHeading } from "../shared";
import { RemoteTable } from "../RemoteTable";
export function EmailSuppressions({ serviceId, canReadContacts }: { serviceId: string; canReadContacts: boolean }) {
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [reason, setReason] = useState("all"), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const result = useResource<Paged<SuppressionRecord> & { relayConfigured: boolean; providerVerified: boolean }>(canReadContacts ? "/email-suppressions?" + new URLSearchParams({ serviceId, search, reason, page: String(page), pageSize: String(pageSize) }) : null);
  return <><PageHeading title="이메일 발송 차단" /><Link className="cs-link" href="/mail/history">발송 내역으로</Link>
    {!canReadContacts ? <Panel><p role="alert">수신자 정보를 조회할 권한이 없습니다.</p></Panel> : <Panel>
      <p>수신 거부·영구 반송·스팸 신고가 접수된 주소는 이 서비스의 새 발송과 예약 발송에서 제외됩니다. 같은 주소에서 최근 7일간 서로 다른 이메일 3건이 일시 반송된 경우에도 차단됩니다.</p>
      {result.data && <p className="campaign-note">수신 결과 연결: {result.data.relayConfigured ? "릴레이 설정 완료 · 외부 공급자 확인 전" : "외부 공급자 미연결"}. 이메일 본문의 수신거부는 사용할 수 있습니다.</p>}
      <form className="campaign-filters" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}>
        <label>이메일 검색<input className="cs-input" aria-label="차단 이메일 검색" value={query} onChange={e => setQuery(e.target.value)} placeholder="정확한 이메일 주소" maxLength={254} /></label>
        <label>차단 사유<select className="cs-input" aria-label="차단 사유" value={reason} onChange={e => { setReason(e.target.value); setPage(1); }}><option value="all">전체</option>{Object.entries(feedbackLabels).filter(([key]) => key !== "delivered").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <ActionButton secondary>차단 검색</ActionButton><ActionButton secondary type="button" onClick={result.reload}>새로고침</ActionButton>
      </form>
      <RemoteTable columns={["이름", "이메일", "차단 사유", "접수 시각"]} rows={(result.data?.items ?? []).map(item => ({ id: item.id, cells: [item.name ?? "—", item.contact ?? "원문 보관 종료", feedbackLabels[item.reason], new Date(item.createdAt).toLocaleString("ko-KR")] }))} total={result.data?.total ?? 0} page={result.data?.page ?? page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} loading={result.loading} error={result.error?.message} />
      <p className="campaign-note">차단은 새로운 동의 등록이나 뒤늦은 전달 결과로 자동 해제되지 않습니다. 원문을 삭제한 뒤에는 연락처를 표시하지 않고 재발송 방지 기록을 유지합니다.</p>
    </Panel>}</>;
}
