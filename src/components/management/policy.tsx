"use client";
import { useState } from "react";
import Link from "next/link";
import { PageHeading, Panel, ActionButton, Modal } from "../shared";
import { api, errorText, useResource } from "@/lib/api";
import { policySettings, type PolicyRecord } from "@/contracts/security";

const tabs = ["비밀번호 변경", "비밀번호 재사용", "세션 유지시간", "2단계 인증", "캐치폼 사용 승인", "파기일자 설정"];
export function Policy() {
  const result = useResource<PolicyRecord>("/security/policy");
  return <><PageHeading title="회사 보안 정책 설정" />
    <p className="mg-description">회사에 적용할 보안 정책을 설정합니다. 최상위 관리자만 변경할 수 있습니다.</p>
    {result.error ? <Panel><p role="alert">{result.error.message}</p></Panel> : !result.data ? <Panel><p role="status">정책을 불러오는 중입니다.</p></Panel>
      : <PolicyForm initial={result.data} />}</>;
}
function PolicyForm({ initial }: { initial: PolicyRecord }) {
  const [policy, setPolicy] = useState(initial), [tab, setTab] = useState(0), [confirm, setConfirm] = useState<"save" | "reset">();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const change = (value: Partial<PolicyRecord>) => { setPolicy(current => ({ ...current, ...value })); setNotice(""); };
  async function save(password: string) {
    if (busy) return; setBusy(true); setError("");
    try {
      const settings = policySettings.parse({ minPassword: policy.minPassword, passwordMonths: policy.passwordMonths, passwordReuse: policy.passwordReuse, passwordDeferral: policy.passwordDeferral, sessionMinutes: policy.sessionMinutes, requireMfa: policy.requireMfa, requireApproval: policy.requireApproval,
        approvalRoles: policy.approvalRoles, approvalReferenceRequired: policy.approvalReferenceRequired, approvalRequestTemplate: policy.approvalRequestTemplate,
        automaticDestruction: policy.automaticDestruction, allowRetentionAdjustment: policy.allowRetentionAdjustment, retentionDays: policy.retentionDays });
      const saved = await api<PolicyRecord>("/security/policy", { method: confirm === "reset" ? "DELETE" : "PATCH",
        body: JSON.stringify({ ...(confirm === "reset" ? {} : settings), tenantId: policy.tenantId, version: policy.version, password }) });
      setPolicy(saved); setConfirm(undefined); setNotice(confirm === "reset" ? "기본 정책을 적용했습니다." : "정책을 저장했습니다. 다음 요청부터 적용됩니다.");
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <><div className="mg-tabs" role="tablist" aria-label="보안 정책">{tabs.map((name, index) =>
    <button key={name} role="tab" aria-selected={tab === index} className={tab === index ? "active" : ""} onClick={() => setTab(index)}>{name}</button>)}</div>
    <Panel><PageHeading title={tabs[tab] + " 정책"}><div className="mg-flex">
      {policy.canManage && <><ActionButton secondary onClick={() => { setError(""); setConfirm("reset"); }}>기본값 복원</ActionButton>
        <ActionButton onClick={() => { setError(""); setConfirm("save"); }}>저장하기</ActionButton></>}</div></PageHeading>
      <fieldset disabled={!policy.canManage || busy} className="policy-fields">
        {tab === 0 && <><h3>비밀번호 변경 주기</h3><p>설정한 기간이 지나면 회사 기능을 사용하기 전에 비밀번호를 변경해야 합니다.</p>
          <label>변경 주기<select className="cs-input" aria-label="비밀번호 변경 주기" value={policy.passwordMonths} onChange={event => change({ passwordMonths: Number(event.target.value) })}>
            <option value={0}>변경 주기 없음</option>{Array.from({ length: 12 }, (_, index) => index + 1).map(month => <option key={month} value={month}>{month}개월{month === 3 ? " (기본값)" : ""}</option>)}</select></label>
          <label>비밀번호 다음에 변경하기<select className="cs-input" aria-label="비밀번호 변경 유예" value={policy.passwordDeferral} onChange={event => change({ passwordDeferral: event.target.value as PolicyRecord["passwordDeferral"] })}>
            <option value="never">즉시 변경해야 합니다.</option><option value="session">다음 로그인까지 미룰 수 있습니다.</option><option value="period">다음 변경 주기까지 미룰 수 있습니다.</option></select></label>
          <label>새 비밀번호 최소 길이<input className="cs-input mg-time" aria-label="비밀번호 최소 길이" type="number" min={12} max={128} value={policy.minPassword} onChange={event => change({ minPassword: Number(event.target.value) })} /></label>
          <p className="mg-muted">최소 길이는 다음 비밀번호 변경·재설정부터 적용됩니다. 변경 주기와 유예 정책 변경은 다음 요청부터 적용됩니다.</p></>}
        {tab === 1 && <><h3>이전 비밀번호 재사용 제한</h3><label>재사용 제한<select className="cs-input" aria-label="비밀번호 재사용 제한" value={policy.passwordReuse} onChange={event => change({ passwordReuse: Number(event.target.value) as 0 | 1 | 10 })}>
          <option value={1}>현재 비밀번호 재사용 금지 (기본값)</option><option value={10}>최근 10개 비밀번호 재사용 금지</option><option value={0}>재사용 제한 없음</option></select></label>
          <p>비밀번호 변경과 이메일 링크를 통한 재설정에 동일하게 적용합니다. 여러 회사에 소속되면 가장 엄격한 최소 길이와 재사용 제한을 따릅니다.</p></>}
        {tab === 2 && <><h3>세션 유지시간</h3><p>마지막 활동 이후 설정한 시간이 지나면 다시 로그인해야 합니다.</p>
          <label>세션 유지시간 (분)<input className="cs-input mg-time" type="number" aria-label="세션 유지시간" min={30} max={120}
            value={policy.sessionMinutes} onChange={event => change({ sessionMinutes: Number(event.target.value) })} /></label>
          <p className="mg-muted">30~120분 사이로 설정할 수 있습니다. 저장 즉시 기존 세션에도 적용됩니다.</p></>}
        {tab === 3 && <><h3>회사 구성원의 2단계 인증</h3>
          <label className="member-check"><input type="checkbox" checked={policy.requireMfa} onChange={event => change({ requireMfa: event.target.checked })} />2단계 인증을 필수로 사용합니다.</label>
          <p>설정하지 않은 구성원은 인증 앱을 등록한 후 회사 기능을 사용할 수 있습니다. 필수 정책이 적용되면 인증을 해제할 수 없습니다.</p>
          <p>필수 정책을 저장하려면 관리자 계정의 2단계 인증을 먼저 등록해주세요.</p><Link className="cs-link" href="/two-step-setting">내 2단계 인증 관리</Link></>}
        {tab === 4 && <><h3>캐치폼 공개 전 사용 승인</h3>
          <label className="member-check"><input type="checkbox" checked={policy.requireApproval} onChange={event => change({ requireApproval: event.target.checked })} />새 초안을 게시하기 전에 승인을 받습니다.</label>
          <p>승인 요청에는 당시의 전체 질문과 설정이 보관됩니다. 내용을 수정하면 다시 승인받아야 합니다. 기존에 공개한 버전은 새 초안을 게시할 때까지 유지됩니다.</p>
          <h3>승인 담당자</h3>{([["owner", "최상위 관리자"], ["admin", "관리자"], ["security", "보안 담당자"]] as const).map(([role, label]) =>
            <label className="member-check" key={role}><input type="checkbox" disabled={role === "owner"} checked={policy.approvalRoles.includes(role)}
              onChange={event => change({ approvalRoles: event.target.checked ? [...policy.approvalRoles, role] : policy.approvalRoles.filter(item => item !== role) })} />{label}</label>)}
          <p className="mg-muted">보안 담당자는 권한을 부여받은 서비스의 폼을 승인할 수 있습니다.</p>
          <label className="member-check"><input type="checkbox" checked={policy.approvalReferenceRequired} onChange={event => change({ approvalReferenceRequired: event.target.checked })} />승인 요청 시 증빙 번호를 필수로 받습니다.</label>
          <label>승인 요청 기본 양식<textarea className="cs-input" aria-label="승인 요청 기본 양식" maxLength={4000} rows={5}
            value={policy.approvalRequestTemplate} onChange={event => change({ approvalRequestTemplate: event.target.value })} /></label>
          <p className="mg-muted">승인 관련 정책이 바뀌면 진행 중인 요청과 게시 전 승인을 다시 받아야 합니다.</p>
          <Link className="cs-link" href="/log/form-approval">캐치폼 승인 내역</Link></>}
        {tab === 5 && <><h3>보유 기한이 지난 응답 처리</h3>
          <label className="member-check"><input type="checkbox" checked={policy.automaticDestruction} onChange={event => change({ automaticDestruction: event.target.checked })} />동의받은 보유 기한이 지나면 자동으로 파기합니다.</label>
          <p>기본값은 관리자 승인 대기입니다. 자동 파기를 켜면 이후 새로 접수되는 만료 응답을 처리기가 삭제합니다. 보존 조치 중인 응답은 제외합니다. 이미 승인 대기 중이거나 수동으로 요청한 파기는 별도로 승인해야 합니다.</p>
          <h3>회사 기본 보유 기간</h3>
          <label>보유 기간 (일)<input className="cs-input mg-time" aria-label="회사 기본 보유 기간" type="number" min={1} max={36500}
            value={policy.retentionDays} onChange={event => change({ retentionDays: Number(event.target.value) })} /></label>
          <p>보유 기간을 지정하지 않고 만든 캐치폼은 제출 시점의 이 기간을 적용합니다. 변경하면 이후 접수되는 응답부터 새 기간이 적용되고 이미 접수된 응답의 기한은 유지되며, 진행 중인 게시 승인은 다시 요청해야 합니다.</p>
          <h3>보유 기한 변경</h3><label className="member-check"><input type="checkbox" checked={policy.allowRetentionAdjustment} onChange={event => change({ allowRetentionAdjustment: event.target.checked })} />개인정보 담당자가 응답의 파기 일정을 변경할 수 있습니다.</label>
          <p>이미 동의받은 원래 보유 기한 이내에서만 조정할 수 있습니다. 보유 기간을 지정하지 않은 폼은 폼 상세에서 사후 지정할 수 있습니다.</p>
          <Link className="cs-link" href="/log/destruction-schedule">파기 일정과 승인 요청</Link>
          <p className="mg-muted">삭제가 시작된 뒤에는 예약 취소나 보존 조치를 적용할 수 없습니다.</p></>}
      </fieldset><p role="status">{notice}</p><p className="mg-muted">정책 버전 {policy.version} · {new Date(policy.updatedAt).toLocaleString("ko-KR")}</p>
    </Panel>{confirm && <Modal title={confirm === "reset" ? "보안 정책 기본값 복원" : "보안 정책 저장"} onClose={() => { if (!busy) setConfirm(undefined); }}>
      <form className="mg-fields" onSubmit={event => { event.preventDefault(); void save(String(new FormData(event.currentTarget).get("password"))); }}>
        {confirm === "reset" && <p>비밀번호 변경 주기 3개월, 현재 비밀번호 재사용 금지, 변경 유예 없음, 최소 12자, 세션 30분, 2단계 인증 선택, 게시 승인 선택, 자동 파기 끄기, 파기일자 변경 끄기, 회사 기본 보유 기간 365일로 되돌립니다. 진행 중인 승인 요청도 무효화될 수 있습니다.</p>}
        <label><span>현재 비밀번호</span><input className="cs-input" type="password" name="password" aria-label="현재 비밀번호" required maxLength={128} autoComplete="current-password" /></label>
        {error && <p role="alert">{error}</p>}<ActionButton disabled={busy}>{busy ? "적용 중…" : "정책 적용"}</ActionButton>
      </form></Modal>}</>;
}
