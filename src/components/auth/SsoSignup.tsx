"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SsoSignupView } from "@/contracts/sso-signup";
import { api, errorText, useResource } from "@/lib/api";

export function SsoSignup() {
  const result = useResource<SsoSignupView>("/auth/sso/signup");
  if (result.error) return <><p role="alert">{result.error.message}</p><button className="auth-primary" onClick={result.reload}>다시 확인</button><Link className="auth-back" href="/login/oauth2">회사 SSO 로그인 다시 시작</Link></>;
  if (!result.data) return <p role="status">인증한 가입 정보를 불러오는 중입니다.</p>;
  return <SignupConsent key={result.data.id} value={result.data} />;
}
function SignupConsent({ value }: { value: SsoSignupView }) {
  const router = useRouter();
  const [age, setAge] = useState(false), [terms, setTerms] = useState(false), [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [expired, setExpired] = useState(() => Date.now() >= Date.parse(value.expiresAt));
  const lock = useRef(false);
  useEffect(() => { const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(value.expiresAt) - Date.now())); return () => clearTimeout(timer); }, [value.expiresAt]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || expired) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await api<{ redirect: string }>("/auth/sso/signup", { method: "POST", body: JSON.stringify({ intentId: value.id,
        overFourteen: age, termsAccepted: terms, privacyAccepted: privacy, termsVersion: value.termsVersion, privacyVersion: value.privacyVersion }) });
      window.location.assign(result.redirect);
    } catch (cause) { setError(errorText(cause)); lock.current = false; setBusy(false); }
  }
  async function cancel() {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { await api("/auth/sso/signup", { method: "DELETE", body: JSON.stringify({ intentId: value.id }) }); router.replace("/login/oauth2"); }
    catch (cause) { setError(errorText(cause)); lock.current = false; setBusy(false); }
  }
  return <>
    <p className="auth-description">회사 계정으로 확인한 정보입니다. 가입 정보를 확인하고 필수 항목에 동의해주세요.</p>
    <dl className="auth-signup-profile"><dt>이메일</dt><dd>{value.email}</dd><dt>이름</dt><dd>{value.name}</dd>{value.companyName && <><dt>초대 회사</dt><dd>{value.companyName}</dd></>}</dl>
    {expired ? <><p role="alert">가입 인증 기한이 끝났습니다. 회사 SSO 로그인에서 다시 시작해주세요.</p><Link className="auth-back" href="/login/oauth2">회사 SSO 로그인 다시 시작</Link></> : <form className="auth-recover-form" onSubmit={submit}>
      <fieldset disabled={busy} className="auth-signup-consent">
        <label><input type="checkbox" checked={age && terms && privacy} onChange={event => { setAge(event.target.checked); setTerms(event.target.checked); setPrivacy(event.target.checked); }} />전체 동의</label>
        <label><input type="checkbox" required checked={age} onChange={event => setAge(event.target.checked)} />[필수] 만14세 이상입니다.</label>
        <label><input type="checkbox" required checked={terms} onChange={event => setTerms(event.target.checked)} /><span>[필수] <Link href="/legal/terms" target="_blank" rel="noreferrer">서비스 이용약관</Link>에 동의합니다.</span></label>
        <label><input type="checkbox" required checked={privacy} onChange={event => setPrivacy(event.target.checked)} /><span>[필수] <Link href="/legal/privacy" target="_blank" rel="noreferrer">개인정보 처리방침</Link>을 확인하고 동의합니다.</span></label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <button className="auth-primary auth-block" disabled={busy || !age || !terms || !privacy}>{busy ? "처리 중…" : "가입 완료"}</button>
      <button className="auth-back" type="button" disabled={busy} onClick={() => void cancel()}>가입 취소</button>
    </form>}
  </>;
}
