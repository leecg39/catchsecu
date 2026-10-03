"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError, errorText } from "@/lib/api";
import { authPath } from "@/lib/return-to";
import { roleLabels, type MemberRole } from "@/contracts/members";

type Preview = { id: string; companyName: string; email: string; role: MemberRole; expiresAt: string };
export function InvitationAccept() {
  const token = useSearchParams().get("token") ?? "", router = useRouter();
  const [state, setState] = useState<{ data?: Preview; error?: string; login?: boolean }>({}), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const key = useRef<string | null>(null), returnTo = "/oauth2/invite/signup?token=" + encodeURIComponent(token);
  useEffect(() => {
    const controller = new AbortController();
    api<Preview>("/invitations/preview", { method: "POST", body: JSON.stringify({ token }), signal: controller.signal })
      .then(data => setState({ data }))
      .catch(error => { if (error.name !== "AbortError") setState({ error: errorText(error), login: error instanceof ApiError && error.status === 401 }); });
    return () => controller.abort();
  }, [token]);
  return <><h1>회사 초대 수락</h1>{state.login ? <><p className="auth-description">초대받은 이메일 주소로 가입하거나 로그인해주세요.</p>
    <Link className="auth-primary auth-block" href={authPath("/login", returnTo)}>로그인 후 수락</Link><Link className="auth-back" href={authPath("/signup", returnTo)}>회원가입</Link></> :
    state.error ? <><p className="auth-error" role="alert">{state.error}</p><Link href={authPath("/login", returnTo)}>초대받은 계정으로 로그인</Link></> :
    !state.data ? <p role="status">초대를 확인하는 중입니다.</p> : <>
      <p className="auth-description"><strong>{state.data.companyName}</strong>에서 초대했습니다.</p>
      <dl className="member-invite-summary"><dt>이메일</dt><dd>{state.data.email}</dd><dt>역할</dt><dd>{roleLabels[state.data.role]}</dd><dt>만료일</dt><dd>{new Date(state.data.expiresAt).toLocaleString("ko-KR")}</dd></dl>
      {error && <p role="alert" className="auth-error">{error}</p>}<button className="auth-primary auth-block" disabled={busy} onClick={async () => {
        setBusy(true); setError(""); if (!key.current) key.current = crypto.randomUUID();
        try { await api("/invitations/accept", { method: "POST", headers: { "Idempotency-Key": key.current }, body: JSON.stringify({ token }) }); router.replace("/dashboard"); router.refresh(); }
        catch (error) { setError(errorText(error)); } finally { setBusy(false); }
      }}>{busy ? "수락 중…" : "초대 수락"}</button></>}</>;
}
