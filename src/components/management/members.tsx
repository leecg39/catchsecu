"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useApplication } from "../ApplicationContext";
import { RemoteTable } from "../RemoteTable";
import { ActionButton, Modal, PageHeading, Panel } from "../shared";
import { api, errorText, useResource } from "@/lib/api";
import { invitationStatuses, memberStatuses, roleLabels, type InvitationRecord, type MemberRecord, type MemberRole } from "@/contracts/members";
import type { Paged } from "@/contracts/forms";
import type { AccessRequestList, AccessRequestRecord } from "@/contracts/access-requests";
import { accessStatusLabels } from "@/contracts/access-requests";

function RequestsReview() {
  const [status, setStatus] = useState("pending"), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const [selection, setSelection] = useState<{ item: AccessRequestRecord; decision: "approve" | "reject" }>();
  const [note, setNote] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const requests = useResource<AccessRequestList>("/access-requests?scope=review&status=" + status + "&page=" + page + "&pageSize=" + pageSize);
  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selection || lock.current) return; lock.current = true;
    setError(""); setNotice(""); setBusy(true);
    try {
      await api("/access-requests/" + selection.item.id, { method: "PATCH", body: JSON.stringify({
        version: selection.item.version, decision: selection.decision, note: note.trim(),
      }) });
      setNotice(selection.decision === "approve" ? "서비스 권한을 부여했습니다." : "접근 요청을 거절했습니다.");
      setSelection(undefined); setNote(""); requests.reload();
    } catch (cause) { setError(errorText(cause)); requests.reload(); } finally { lock.current = false; setBusy(false); }
  }
  return <><Panel title="서비스 접근 요청">
    <p className="cs-muted">승인하면 해당 구성원의 현재 역할 권한으로 요청한 서비스 접근이 부여됩니다.</p>
    <label>상태 <select className="cs-input" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
      <option value="pending">검토 대기</option><option value="approved">승인</option><option value="rejected">거절</option><option value="cancelled">취소</option><option value="all">전체</option>
    </select></label>
    {notice && <p role="status">{notice}</p>}
    {requests.error && <p role="alert">{requests.error.message} <button className="cs-link" onClick={requests.reload}>다시 시도</button></p>}
    <RemoteTable columns={["요청자", "서비스", "사유", "상태", "요청 시각", "검토"]}
      rows={(requests.data?.items ?? []).map(item => ({ id: item.id, cells: [
        <span key="requester">{item.requesterName}<small className="member-email">{item.requesterEmail}</small></span>,
        item.serviceName, item.reason || "-", accessStatusLabels[item.status], new Date(item.createdAt).toLocaleString("ko-KR"),
        item.status === "pending" ? <div className="mg-flex" key="review">
          <button className="cs-link" onClick={() => { setSelection({ item, decision: "approve" }); setNote(""); setError(""); }}>승인</button>
          <button className="cs-link" onClick={() => { setSelection({ item, decision: "reject" }); setNote(""); setError(""); }}>거절</button></div> : item.reviewerName || "-",
      ] }))} total={requests.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage}
      onPageSize={size => { setPageSize(size); setPage(1); }} loading={requests.loading} error={requests.error?.message} />
  </Panel>
    {selection && <Modal title={selection.decision === "approve" ? "서비스 접근 승인" : "서비스 접근 거절"} onClose={() => { if (!busy) setSelection(undefined); }}>
      <form className="member-fields" onSubmit={decide}>
        <p><strong>{selection.item.requesterName}</strong> · {selection.item.serviceName}</p>
        {selection.item.reason && <p>요청 사유: {selection.item.reason}</p>}
        <label>답변 (선택)<textarea className="cs-input" value={note} maxLength={500} onChange={event => setNote(event.target.value)} /></label>
        {error && <p role="alert" className="auth-error">{error}</p>}
        <ActionButton disabled={busy}>{busy ? "처리 중…" : selection.decision === "approve" ? "권한 부여" : "거절 확인"}</ActionButton>
      </form>
    </Modal>}
  </>;
}

function MemberFields({ member, done, onBusy }: { member?: MemberRecord; done: () => void; onBusy: (busy: boolean) => void }) {
  const app = useApplication(), [role, setRole] = useState<MemberRole>(member?.role ?? "viewer");
  const [serviceIds, setServiceIds] = useState(member?.grants.map(grant => grant.serviceId) ?? (app.data?.serviceId ? [app.data.serviceId] : []));
  const [status, setStatus] = useState(member?.status ?? "active"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  const lock = useRef(false);
  const services = [
    ...(app.data?.services ?? []).map(service => ({ id: service.id, name: service.name, archived: false })),
    ...(member?.grants.filter(grant => !app.data?.services.some(service => service.id === grant.serviceId)) ?? [])
      .map(grant => ({ id: grant.serviceId, name: grant.serviceName, archived: grant.serviceStatus === "archived" })),
  ];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return; lock.current = true; setError(""); setBusy(true); onBusy(true);
    const fields = new FormData(event.currentTarget);
    try {
      if (!member && !serviceIds.length) throw new Error("서비스를 한 개 이상 선택해주세요.");
      if (!key.current) key.current = crypto.randomUUID();
      await api(member ? "/members/" + member.id : "/invitations", { method: member ? "PATCH" : "POST",
        headers: { "Idempotency-Key": key.current }, body: JSON.stringify({ role, serviceIds, ...(member ? { version: member.version, status } : { email: String(fields.get("email")).trim() }) }) });
      done();
    } catch (error) { setError(errorText(error)); } finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  return <form className="member-fields" onSubmit={submit}>
    {member ? <p><strong>{member.user.name}</strong><br />{member.user.email}</p> :
      <label>초대할 이메일<input name="email" disabled={busy} onChange={() => { key.current = null; }} type="email" className="cs-input" required autoComplete="off" maxLength={254} /></label>}
    <label>역할<select className="cs-input" disabled={busy} value={role} onChange={event => { setRole(event.target.value as MemberRole); key.current = null; }}>
      {(Object.keys(roleLabels) as MemberRole[]).filter(value => value !== "owner" && (app.data?.company?.role === "owner" || value !== "billing"))
        .map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}</select></label>
    {member && <label>상태<select className="cs-input" disabled={busy} value={status} onChange={event => setStatus(event.target.value)}><option value="active">활성</option><option value="suspended">정지</option></select></label>}
    <fieldset><legend>사용할 서비스</legend>{services.map(service => <label className="member-check" key={service.id}>
      <input type="checkbox" disabled={busy || (service.archived && !serviceIds.includes(service.id))} checked={serviceIds.includes(service.id)} onChange={event => { setServiceIds(event.target.checked ? [...serviceIds, service.id] : serviceIds.filter(id => id !== service.id)); key.current = null; }} />{service.name}{service.archived ? " (보관됨)" : ""}</label>)}
      {!services.length && <p>{member ? "현재 선택할 수 있는 활성 서비스가 없습니다." : "서비스 관리에서 서비스를 먼저 생성해주세요."}</p>}</fieldset>
    {services.some(service => service.archived) && <p className="cs-muted">보관된 서비스의 기존 권한은 유지하거나 회수할 수 있습니다. 다시 부여하려면 서비스를 먼저 복원해주세요.</p>}
    {role === "admin" && <p className="cs-muted">관리자는 새로 생성되는 서비스를 포함해 모든 서비스를 관리합니다. 선택한 서비스는 기본 접근 정보로 저장됩니다.</p>}
    {member && role !== "admin" && !serviceIds.length && <p className="cs-muted">회사 구성원 상태는 유지하고 모든 서비스 접근 권한을 회수합니다.</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    <ActionButton disabled={busy || (!member && !app.data?.services.length)}>{busy ? "처리 중…" : member ? "변경 저장" : "초대 보내기"}</ActionButton>
  </form>;
}
export function LiveMembers({ authority = false }: { authority?: boolean }) {
  const app = useApplication(), router = useRouter(), canManage = !!app.data?.capabilities.includes("member.manage");
  const [tab, setTab] = useState<"members" | "invitations">("members"), [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const [status, setStatus] = useState("all"), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const [editor, setEditor] = useState<MemberRecord | "invite">(), [action, setAction] = useState<{ kind: "remove" | "transfer"; member: MemberRecord }>();
  const [invitationAction, setInvitationAction] = useState<{ kind: "resend" | "revoke"; invitation: InvitationRecord }>();
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false), lock = useRef(false);
  const suffix = "?page=" + page + "&pageSize=" + pageSize + "&status=" + status + "&search=" + encodeURIComponent(query);
  const members = useResource<Paged<MemberRecord>>(canManage && tab === "members" ? "/members" + suffix : null);
  const invitations = useResource<Paged<InvitationRecord>>(canManage && tab === "invitations" ? "/invitations" + suffix : null);
  function resetTab(value: "members" | "invitations") { setTab(value); setPage(1); setStatus("all"); setSearch(""); setQuery(""); setError(""); }
  function refresh() { members.reload(); invitations.reload(); app.reload(); }
  async function execute(operation: () => Promise<void>, message: string) {
    if (lock.current) return; lock.current = true; setError(""); setNotice(""); setBusy(true);
    try { await operation(); setAction(undefined); setInvitationAction(undefined); refresh(); setNotice(message); }
    catch (error) { setError(errorText(error)); } finally { lock.current = false; setBusy(false); }
  }
  if (!app.data) return <p role="status">구성원 권한을 확인하는 중입니다.</p>;
  if (!canManage) return <Panel><p role="alert">구성원 관리 권한이 없습니다.</p></Panel>;
  return <><PageHeading title={authority ? "권한 관리" : "구성원 관리"}><ActionButton onClick={() => setEditor("invite")}>구성원 초대</ActionButton></PageHeading>
    <Panel><div className="member-tabs"><button aria-pressed={tab === "members"} onClick={() => resetTab("members")}>구성원</button>
      <button aria-pressed={tab === "invitations"} onClick={() => resetTab("invitations")}>초대 이력</button></div>
      <p className="cs-muted">역할과 서비스 범위로 접근 권한을 설정합니다. 자신의 권한 변경과 마지막 소유자 제외는 제한됩니다.</p>
      <form className="mg-flex mg-search" onSubmit={event => { event.preventDefault(); setQuery(search); setPage(1); }}>
        <input className="cs-input" aria-label="구성원 검색" placeholder={tab === "members" ? "이름 또는 이메일" : "이메일"} value={search} onChange={event => setSearch(event.target.value)} />
        <select className="cs-input" aria-label="구성원 상태" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          <option value="all">전체</option>{Object.entries(tab === "members" ? memberStatuses : invitationStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ActionButton secondary>검색</ActionButton>
      </form>{notice && <p role="status">{notice}</p>}{!action && !invitationAction && error && <p role="alert" className="auth-error">{error}</p>}
      {tab === "members" ? <RemoteTable columns={["이름 / 이메일", "역할", "서비스", "상태", "관리"]} rows={(members.data?.items ?? []).map(member => {
        const self = member.user.id === app.data?.user.id, manageable = !self && member.accessKind !== "expert" && member.role !== "owner" && (app.data?.company?.role === "owner" || member.role !== "billing");
        return { id: member.id, cells: [<div key="name">{member.user.name}{self && " (나)"}{member.accessKind === "expert" && " (전문가 배정)"}<small className="member-email">{member.user.email}</small></div>, roleLabels[member.role],
          ["owner", "admin"].includes(member.role) ? "전체 서비스" : member.grants.map(grant => grant.serviceName).join(", ") || "-", memberStatuses[member.status],
          <div className="mg-flex" key="actions">{manageable && member.status !== "revoked" && <><button className="cs-link" onClick={() => setEditor(member)}>권한 수정</button>
            <button className="cs-link" onClick={() => { setError(""); setAction({ kind: "remove", member }); }}>제외</button></>}
            {!self && member.accessKind !== "expert" && member.role !== "owner" && member.status === "active" && app.data?.company?.role === "owner" && <button className="cs-link" onClick={() => { setError(""); setAction({ kind: "transfer", member }); }}>소유권 이전</button>}</div>] };
      })} total={members.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} loading={members.loading} error={members.error?.message} /> :
        <RemoteTable columns={["이메일", "역할", "상태", "만료일", "관리"]} rows={(invitations.data?.items ?? []).map(invitation => ({ id: invitation.id, cells: [
          invitation.email, roleLabels[invitation.role], invitationStatuses[invitation.status], new Date(invitation.expiresAt).toLocaleString("ko-KR"),
          <div className="mg-flex" key="actions">{["pending", "expired"].includes(invitation.status) && (app.data?.company?.role === "owner" || invitation.role !== "billing") && <>
            <button className="cs-link" onClick={() => { setError(""); setInvitationAction({ kind: "resend", invitation }); }}>재발송</button>
            <button className="cs-link" onClick={() => { setError(""); setInvitationAction({ kind: "revoke", invitation }); }}>초대 취소</button></>}</div>] }))}
          total={invitations.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} loading={invitations.loading} error={invitations.error?.message} />}
    </Panel><RequestsReview/>{editor && <Modal title={editor === "invite" ? "구성원 초대" : "구성원 권한 수정"} onClose={() => { if (!editorBusy) setEditor(undefined); }}>
      <MemberFields member={editor === "invite" ? undefined : editor} onBusy={setEditorBusy} done={() => { setNotice(editor === "invite" ? "초대 메일 전송을 요청했습니다." : "구성원 정보를 저장했습니다."); setEditor(undefined); refresh(); }} /></Modal>}
    {action && <Modal title={action.kind === "remove" ? "구성원 제외" : "소유권 이전"} onClose={() => { if (!busy) setAction(undefined); }}>
      <form className="member-fields" onSubmit={event => { event.preventDefault(); const password = String(new FormData(event.currentTarget).get("password") ?? "");
        void execute(async () => { await api("/members/" + action.member.id + (action.kind === "transfer" ? "/transfer" : ""), {
          method: action.kind === "transfer" ? "POST" : "DELETE",
          ...(action.kind === "transfer" ? { body: JSON.stringify({ version: action.member.version, password }) } : { headers: { "If-Match": String(action.member.version) } }),
        }); if (action.kind === "transfer") router.refresh(); }, action.kind === "transfer" ? "소유권을 이전했습니다." : "구성원을 제외했습니다.");
      }}><p>{action.member.user.name} ({action.member.user.email})</p><p>{action.kind === "remove" ? "이 회사의 서비스 접근 권한을 해제하고 로그인 세션을 종료합니다. 다시 참여하려면 새 초대가 필요합니다." : "선택한 구성원에게 회사 소유권을 이전합니다. 내 역할은 관리자로 변경됩니다."}</p>
        {action.kind === "transfer" && <label>현재 비밀번호<input className="cs-input" name="password" type="password" required autoComplete="current-password" maxLength={128} /></label>}
        {error && <p role="alert" className="auth-error">{error}</p>}<ActionButton disabled={busy}>{busy ? "처리 중…" : action.kind === "transfer" ? "소유권 이전 확인" : "구성원 제외 확인"}</ActionButton></form></Modal>}
    {invitationAction && <Modal title={invitationAction.kind === "resend" ? "초대 재발송" : "초대 취소"} onClose={() => { if (!busy) setInvitationAction(undefined); }}>
      <p>{invitationAction.invitation.email}</p><p>{invitationAction.kind === "resend" ? "새 링크를 발급하면 기존 초대 링크는 사용할 수 없습니다." : "이 초대 링크를 더 이상 사용할 수 없게 합니다."}</p>
      {error && <p role="alert" className="auth-error">{error}</p>}<ActionButton disabled={busy} onClick={() => execute(async () => {
        const { invitation, kind } = invitationAction;
        await api("/invitations/" + invitation.id + (kind === "resend" ? "/resend" : ""), { method: kind === "resend" ? "POST" : "DELETE",
          ...(kind === "resend" ? { body: JSON.stringify({ version: invitation.version }) } : { headers: { "If-Match": String(invitation.version) } }) });
      }, invitationAction.kind === "resend" ? "새 초대 메일 전송을 요청했습니다." : "초대를 취소했습니다.")}>{invitationAction.kind === "resend" ? "재발송 확인" : "초대 취소 확인"}</ActionButton></Modal>}
  </>;
}
