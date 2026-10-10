"use client";
import { useRef, useState } from "react";
import { ApiError, api, errorText, useResource } from "@/lib/api";
import { verificationCreate, type VerificationState } from "@/contracts/verification";
import { useConfirm } from "../ux/confirm";

export function VerificationSettings({ serviceId }: { serviceId: string }) {
  const resource = useResource<VerificationState>(serviceId ? `/services/${serviceId}/verification` : null);
  const [message, setMessage] = useState("");
  if (!serviceId) return <p>서비스를 먼저 선택해주세요.</p>;
  if (resource.error) return <div><p role="alert">{resource.error.message}</p><button type="button" className="cs-button" onClick={resource.reload}>설정 다시 불러오기</button></div>;
  if (resource.loading || !resource.data) return <p role="status">본인인증·전자서명 연동 설정을 불러오는 중입니다.</p>;
  return <section aria-label="서비스 본인인증·전자서명 연동">
    <p role="status">{resource.data.readiness.message}</p>
    {resource.data.readiness.ready && <p className="forms-muted">{resource.data.readiness.sandboxVerified
      ? "local sandbox 테스트 인증 흐름을 확인했습니다. 외부 공급자 공식 검증과 운영 환경 연동은 별도로 필요합니다."
      : "local sandbox 설정은 사용 중이지만 성공한 테스트 인증 흐름은 아직 없습니다."}</p>}
    <p className="forms-muted">이 설정은 선택한 서비스의 모든 캐치폼에 적용됩니다. 공급자 이름을 저장해도 인증이 활성화되지는 않습니다.</p>
    {message && <p role="status">{message}</p>}
    <Configuration key={`${serviceId}:${resource.data.integration?.version ?? 0}`} serviceId={serviceId} state={resource.data}
      done={text => { setMessage(text); resource.reload(); }} />
    {!!resource.data.history.length && <details><summary>설정 변경 이력 (최근 20개)</summary><ul>
      {resource.data.history.map(item => <li key={item.version}>v{item.version} · {item.status === "deleted" ? "삭제" : item.status === "disabled" ? "사용 중지" : item.status === "enabled" ? "사용" : "연결 대기"}
        {` · ${item.environment === "sandbox" ? "테스트" : "운영"} · ${item.identityProvider ?? "본인인증 미설정"} / ${item.signatureProvider ?? "전자서명 미설정"} · ${new Date(item.createdAt).toLocaleString("ko-KR")}`}</li>)}
    </ul></details>}
  </section>;
}
function Configuration({ serviceId, state, done }: { serviceId: string; state: VerificationState; done: (text: string) => void }) {
  const row = state.integration, exists = !!row && row.status !== "deleted";
  const ask = useConfirm();
  const [identityProvider, setIdentity] = useState(exists ? row.identityProvider ?? "" : "");
  const [signatureProvider, setSignature] = useState(exists ? row.signatureProvider ?? "" : "");
  const [environment, setEnvironment] = useState<"sandbox" | "production">(exists ? row.environment : "sandbox");
  const [status, setStatus] = useState<"pending" | "enabled" | "disabled">(row?.status === "disabled" ? "disabled" : row?.status === "enabled" ? "enabled" : "pending");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<{ body: string; key: string } | null>(null);
  const path = `/services/${serviceId}/verification`;
  async function save() {
    if (busy) return; setBusy(true); setError("");
    try {
      const result = verificationCreate.safeParse({ identityProvider: identityProvider.trim() || null, signatureProvider: signatureProvider.trim() || null, environment, status });
      if (!result.success) { setError(result.error.issues.map(issue => issue.message).join(" ")); return; }
      const body = JSON.stringify(exists ? { ...result.data, version: row!.version } : result.data);
      if (!exists && pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() };
      const saved = await api<VerificationState>(path, { method: exists ? "PATCH" : "POST", body,
        ...(!exists ? { headers: { "Idempotency-Key": pending.current!.key } } : {}) });
      pending.current = null; done(saved.readiness.ready
        ? "local sandbox 설정을 사용으로 전환했습니다. 공개 테스트 인증 흐름으로 동작을 확인해주세요."
        : "연동 설정을 저장했습니다. 외부 공급자 연결과 공식 검증은 대기 중입니다.");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 410) pending.current = null;
      setError(errorText(cause));
    } finally { setBusy(false); }
  }
  async function remove() {
    if (busy || !exists) return;
    if (!await ask({ title: "본인인증 연동 설정 삭제", message: "이 서비스의 본인인증·전자서명 연동 설정을 삭제합니다. 변경 이력은 보관됩니다.", confirmLabel: "삭제" })) return;
    setBusy(true); setError("");
    try { await api(path, { method: "DELETE", headers: { "If-Match": String(row!.version) } }); done("연동 설정을 삭제했습니다. 변경 이력은 보관됩니다."); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  if (!state.permissions.canManage) return <p className="forms-muted">본인인증: {row?.identityProvider ?? "미설정"} · 전자서명: {row?.signatureProvider ?? "미설정"} · 회사 관리자에게 연동 설정을 요청해주세요.</p>;
  return <div className="verification-settings-fields">
    <label>본인인증 공급자 식별자<input className="cs-input" value={identityProvider} maxLength={64} disabled={busy} onChange={event => setIdentity(event.target.value)} placeholder="공급자가 정해지면 입력" /></label>
    <label>전자서명 공급자 식별자<input className="cs-input" value={signatureProvider} maxLength={64} disabled={busy} onChange={event => setSignature(event.target.value)} placeholder="공급자가 정해지면 입력" /></label>
    <p className="forms-muted">식별자는 영문 소문자·숫자·밑줄·하이픈으로 입력해주세요. 비밀 키와 URL은 입력하지 마세요.</p>
    <label>연동 환경<select className="cs-input" value={environment} disabled={busy} onChange={event => setEnvironment(event.target.value as "sandbox" | "production")}>
      <option value="sandbox">테스트 (sandbox)</option><option value="production">운영 (production)</option></select></label>
    <label>연동 설정 상태<select className="cs-input" value={status} disabled={busy} onChange={event => setStatus(event.target.value as "pending" | "enabled" | "disabled")}>
      <option value="pending">공급자 연결 대기</option><option value="enabled">사용 (sandbox의 local 공급자만)</option><option value="disabled">사용 중지</option></select></label>
    <p className="forms-muted">본인인증 사용 폼을 게시하려면 연동이 사용 상태여야 합니다. 외부 공급자와 운영 환경은 아직 전환할 수 없습니다.</p>
    {error && <p role="alert">{error}</p>}
    <div className="forms-actions"><button type="button" className="cs-button cs-button-primary" disabled={busy} onClick={save}>{busy ? "처리 중…" : exists ? "연동 설정 저장" : "연동 설정 등록"}</button>
      {exists && <button type="button" className="cs-button" disabled={busy} onClick={remove}>연동 설정 삭제</button>}
      <button type="button" className="cs-button" disabled={busy} onClick={() => done("최신 연동 설정을 불러왔습니다.")}>최신 설정 불러오기</button></div>
  </div>;
}
