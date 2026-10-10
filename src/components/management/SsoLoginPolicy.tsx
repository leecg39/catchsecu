"use client";
import { useEffect, useRef, useState } from "react";
import { ssoLoginModeLabels, type SsoLoginMode, type SsoPolicyView } from "@/contracts/sso-login-policy";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import { useApplication } from "../ApplicationContext";
import { ActionButton, PageHeading, Panel } from "../shared";
import { GuardedLink as Link, useUnsavedChanges } from "../ux/navigation-guard";
import { useConfirm } from "../ux/confirm";
import { SecurityEntitlementNotice } from "./SecurityEntitlementNotice";
import styles from "./sso-login-policy.module.css";

type Challenge = { challengeId: string; expiresAt: string; retryAt: string };
export function SsoLoginPolicy({ settings = false }: { settings?: boolean }) {
  const app = useApplication();
  return <PolicyPage key={(app.data?.company?.id ?? "none") + ":" + app.data?.company?.role} companyId={app.data?.company?.id} settings={settings} />;
}
function PolicyPage({ settings, companyId }: { settings: boolean; companyId?: string }) {
  const result = useResource<SsoPolicyView>(companyId ? "/security/sso-policy" : null), [notice, setNotice] = useState("");
  return <div className={styles.page}><PageHeading title={settings ? "SSO 로그인 정책 설정" : "SSO 로그인 정책"}>
    <div className="mg-flex"><Link className="cs-button secondary" href={settings ? "/security/sso" : "/security/sso/setting"}>{settings ? "현황 보기" : "정책 설정"}</Link>
      <Link className="cs-button secondary" href="/security/sso/providers">SSO 공급자 관리</Link></div>
  </PageHeading>
    <p>회사에서 허용할 로그인 방식을 선택합니다. 저장 후 모든 구성원의 다음 회사 요청부터 적용됩니다.</p>
    {notice && <p role="status">{notice}</p>}
    {result.error ? <Panel><p role="alert">{result.error.message}</p><ActionButton secondary onClick={result.reload}>다시 불러오기</ActionButton></Panel>
      : !result.data ? <Panel><p role="status">로그인 정책을 불러오는 중입니다.</p></Panel>
        : result.data.tenantId !== companyId ? <Panel><p role="alert">다른 탭에서 선택한 회사가 변경되었습니다. 회사와 정책을 함께 다시 불러온 뒤 진행해주세요.</p><ActionButton secondary onClick={() => window.location.reload()}>회사와 정책 다시 불러오기</ActionButton></Panel>
        : <PolicyForm key={result.data.version} value={result.data} settings={settings} reload={result.reload}
          saved={() => { setNotice("로그인 정책을 저장했습니다."); result.reload(); }} />}
  </div>;
}
function PolicyForm({ value, settings, reload, saved }: { value: SsoPolicyView; settings: boolean; reload: () => void; saved: () => void }) {
  const [mode, setMode] = useState<SsoLoginMode>(value.mode), [challenge, setChallenge] = useState<Challenge>(), [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [now, setNow] = useState(() => Date.now());
  const lock = useRef(false), ask = useConfirm();
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useUnsavedChanges(busy || mode !== value.mode || !!code);
  const selected = value.options.find(option => option.mode === mode)!;
  const required = mode === "NONE" ? value.mode : mode;
  const fresh = value.authentication.identityProvider === required && !!value.authentication.freshUntil && Date.parse(value.authentication.freshUntil) > now;
  const switching = value.mode !== "NONE" && mode !== "NONE" && mode !== value.mode;
  const allowed = value.canManage && value.entitlement.available && mode !== value.mode && selected.configured && selected.linked && fresh && !switching && !conflict;
  const expired = !!challenge && Date.parse(challenge.expiresAt) <= now;
  async function issue() {
    if (lock.current || !allowed) return;
    lock.current = true; setBusy(true); setError("");
    try {
      if (!await ask({ title: "로그인 정책 변경", message: `${ssoLoginModeLabels[mode]}으로 변경합니다. ${mode === "NONE" ? "이메일 로그인도 회사에서 사용할 수 있습니다." : `현재 미연결 구성원 ${selected.unlinkedMembers}명은 SSO 계정을 연결해야 회사 업무를 계속할 수 있습니다.`} 이메일 인증번호를 요청할까요?`, confirmLabel: "인증번호 요청", cancelLabel: "취소" })) return;
      setChallenge(await api<Challenge>("/security/sso-policy/challenge", { method: "POST", body: JSON.stringify({ tenantId: value.tenantId, mode, version: value.version }) })); setCode("");
    } catch (cause) { failure(cause); } finally { lock.current = false; setBusy(false); }
  }
  function failure(cause: unknown) {
    setError(errorText(cause));
    if (cause instanceof ApiError && ["VERSION_CONFLICT", "COMPANY_CHANGED"].includes(cause.code)) setConflict(true);
    if (cause instanceof ApiError && ["SSO_POLICY_CHALLENGE_INVALID", "SSO_POLICY_CHALLENGE_NOT_FOUND"].includes(cause.code)) { setChallenge(undefined); setCode(""); }
  }
  async function save() {
    if (!challenge || lock.current || !allowed || expired) return;
    lock.current = true; setBusy(true); setError("");
    try { await api("/security/sso-policy", { method: "PUT", body: JSON.stringify({ tenantId: value.tenantId, mode, version: value.version, challengeId: challenge.challengeId, code }) }); saved(); }
    catch (cause) { failure(cause); } finally { lock.current = false; setBusy(false); }
  }
  async function latest() {
    if (lock.current) return;
    if ((mode !== value.mode || code) && !await ask({ title: "최신 정책 불러오기", message: "현재 입력을 버리고 최신 정책을 불러올까요?", confirmLabel: "불러오기", cancelLabel: "계속 편집" })) return;
    reload();
  }
  return <><SecurityEntitlementNotice access={value.entitlement} />
    <Panel title="현재 정책"><strong>{ssoLoginModeLabels[value.mode]}</strong><p>현재 인증: {value.authentication.identityProvider === "GOOGLE" ? "Google" : value.authentication.identityProvider === "AZURE" ? "Microsoft" : value.authentication.identityProvider === "OTHER" ? "다른 SSO" : "이메일 로그인"}</p>
      <p>정책 변경에는 해당 SSO의 최근 5분 이내 인증과 이메일 인증번호가 필요합니다.</p>
      <div className="mg-flex"><Link href="/link/oauth2">내 SSO 계정 연결</Link><Link href="/login/oauth2">SSO로 다시 로그인</Link></div>
    </Panel>
    <Panel title={settings ? "허용할 로그인 방식" : "연결 현황"}>
      {!value.canManage && <p>회사 소유자 또는 보안 담당자가 정책을 변경할 수 있습니다.</p>}
      <form className="policy-fields" onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={!settings || !value.canManage || !value.entitlement.available || busy || conflict}>
          <legend>회사 로그인 정책</legend>
          {value.options.map(option => <label key={option.mode} className="mg-description" style={{ display: "block", marginBlock: 12 }}>
            <input type="radio" name="sso-login-mode" value={option.mode} checked={mode === option.mode} onChange={() => { setMode(option.mode); setChallenge(undefined); setCode(""); setError(""); }} /> {ssoLoginModeLabels[option.mode]}
            {option.mode !== "NONE" && <p>공급자 {option.configured ? "설정 완료" : "미설정"} · 내 계정 {option.linked ? "연결됨" : "미연결"} · 활성 직접 소속 구성원 {option.activeMembers}명 중 연결 {option.linkedMembers}명 / 미연결 {option.unlinkedMembers}명</p>}
          </label>)}
        </fieldset>
        {settings && <>
          {switching && <p role="status">다른 SSO로 바꾸려면 먼저 아이디 및 SSO 로그인을 허용한 뒤 새 SSO로 인증해주세요.</p>}
          {mode !== value.mode && !fresh && <p role="status">정책을 변경하기 전에 {required === "GOOGLE" ? "Google" : "Microsoft"} 계정으로 다시 로그인해주세요.</p>}
          {error && <p role="alert">{error}</p>}
          {conflict && <p>선택 회사 또는 정책이 변경됐습니다. 입력은 유지했습니다. 최신 정책을 불러와 다시 확인해주세요.</p>}
          {challenge && <><p role="status">현재 계정 이메일로 인증번호를 요청했습니다. 유효 기한: {new Date(challenge.expiresAt).toLocaleTimeString("ko-KR")}</p>
            {expired && <p role="alert">인증번호가 만료되었습니다. 다시 요청해주세요.</p>}
            <label>이메일 인증번호<input className="cs-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy || conflict || expired} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} /></label>
          </>}
          <div className="mg-flex"><ActionButton type="button" secondary disabled={busy || !allowed || (!!challenge && Date.parse(challenge.retryAt) > now)} onClick={() => void issue()}>{challenge ? "인증번호 다시 요청" : "이메일 인증번호 요청"}</ActionButton>
            {challenge && <ActionButton type="submit" disabled={busy || !allowed || expired || code.length !== 6}>정책 적용</ActionButton>}
            <ActionButton type="button" secondary disabled={busy} onClick={() => void latest()}>최신 정책 불러오기</ActionButton></div>
        </>}
      </form>
    </Panel></>;
}
