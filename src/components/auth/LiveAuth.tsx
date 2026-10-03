"use client";
import type { PasswordPolicyStatus } from "@/contracts/security";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, errorText, useResource } from "@/lib/api";
import { authPath, safeReturnTo } from "@/lib/return-to";

function Password({ name = "password", label = "비밀번호", current = false, minimum = 12 }: { name?: string; label?: string; current?: boolean; minimum?: number }) {
  const [visible, setVisible] = useState(false);
  return <div className="auth-password"><input name={name} aria-label={label} placeholder={label} required
    minLength={current ? 1 : minimum} maxLength={128} type={visible ? "text" : "password"} autoComplete={current ? "current-password" : "new-password"} />
    <button type="button" aria-label="비밀번호 표시 전환" onClick={() => setVisible(!visible)}>◉</button></div>;
}
function useAction() {
  const [error, setError] = useState(""), [pending, setPending] = useState(false), [notice, setNotice] = useState("");
  async function run(action: () => Promise<void>) {
    setPending(true); setError(""); setNotice("");
    try { await action(); } catch (error) { setError(errorText(error)); } finally { setPending(false); }
  }
  return { error, pending, notice, setNotice, run };
}
function Status({ action }: { action: ReturnType<typeof useAction> }) {
  return <>{action.error && <p role="alert" className="auth-error">{action.error}</p>}
    {action.notice && <p role="status" className="auth-note">{action.notice}</p>}</>;
}
const post = <T,>(path: string, value: unknown) => api<T>("/auth" + path, { method: "POST", body: JSON.stringify(value) });
export function LoginForm() {
  const action = useAction(), router = useRouter(), returnTo = safeReturnTo(useSearchParams().get("returnTo"));
  const [email, setEmail] = useState(""), [remember, setRemember] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem("catchsecu-demo-email");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore an optional non-business preference after hydration.
    if (stored) { setEmail(stored); setRemember(true); }
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await action.run(async () => {
      const email = String(data.get("email"));
      const result = await post<{ twoFactorRedirect?: boolean }>("/sign-in/email", { email, password: String(data.get("password")) });
      if (data.get("remember")) localStorage.setItem("catchsecu-demo-email", email); else localStorage.removeItem("catchsecu-demo-email");
      router.replace(result.twoFactorRedirect ? authPath("/login-otp", returnTo) : returnTo); router.refresh();
    });
  }
  return <form onSubmit={submit}><input className="auth-email" type="email" name="email" autoComplete="username" aria-label="이메일" placeholder="이메일을 입력해주세요" required value={email} onChange={event => setEmail(event.target.value)} />
    <Password current /><Link className="auth-forgot" href="/password-change-email">비밀번호를 잊으셨나요?</Link>
    <Status action={action} /><button disabled={action.pending} className="auth-primary auth-login-submit">{action.pending ? "로그인 중…" : "로그인"}</button>
    <label className="auth-remember"><input type="checkbox" name="remember" checked={remember} onChange={event => setRemember(event.target.checked)} />이메일 기억하기</label></form>;
}
export function SignupOrResetForm({ signup }: { signup: boolean }) {
  const action = useAction(), router = useRouter(), returnTo = safeReturnTo(useSearchParams().get("returnTo"));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await action.run(async () => {
      if (signup) {
        await post("/sign-up/email", { name: String(data.get("name")), email: String(data.get("email")), password: String(data.get("password")), callbackURL: authPath("/login", returnTo) });
        action.setNotice("가입 주소로 인증 메일 전송을 요청했습니다. 인증 후 로그인해주세요.");
      } else {
        await post("/request-password-reset", { email: String(data.get("email")), redirectTo: "/passwordChange" });
        router.push("/password-change-email/complete");
      }
    });
  }
  return <form className="auth-recover-form" onSubmit={submit}>
    {signup && <input name="name" aria-label="이름" placeholder="이름" required maxLength={100} />}
    <input type="email" name="email" aria-label="이메일" placeholder="이메일을 입력해주세요" required />
    {signup && <><Password /><p className="auth-note">비밀번호는 12~128자로 입력해주세요.</p><label className="auth-remember"><input type="checkbox" required />서비스 이용약관 및 개인정보 처리방침에 동의합니다.</label></>}
    <Status action={action} /><button disabled={action.pending} className="auth-primary auth-block">{action.pending ? "처리 중…" : signup ? "회원가입" : "비밀번호 재설정 메일 받기"}</button>
  </form>;
}
export function PasswordForm() {
  const action = useAction(), params = useSearchParams(), router = useRouter(), token = params.get("token");
  const returnTo = safeReturnTo(params.get("returnTo"));
  const policy = useResource<PasswordPolicyStatus>(token ? null : "/me/password-policy");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await action.run(async () => {
      const newPassword = String(data.get("password"));
      if (newPassword !== data.get("confirm")) throw new Error("비밀번호가 일치하지 않습니다.");
      if (token) await post("/reset-password", { newPassword, token });
      else {
        await post("/change-password", { newPassword, currentPassword: String(data.get("current")), revokeOtherSessions: true });
        await post("/sign-out", {});
      }
      action.setNotice("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.");
    });
  }
  if (action.notice) return <><Status action={action} /><Link className="auth-primary auth-block" href={authPath("/login", returnTo)}>새 비밀번호로 로그인</Link></>;
  return <>{policy.data?.required && <section className="auth-policy-note"><strong>{policy.data.companyName} 비밀번호 변경 안내</strong>
      <p>비밀번호 변경 기한이 지났습니다. 회사 기능을 사용하려면 새 비밀번호를 설정해주세요.</p>
      {policy.data.deadline && <p>변경 기한: {new Date(policy.data.deadline).toLocaleString("ko-KR")}</p>}</section>}
    {policy.data?.passwordReuse !== undefined && policy.data.passwordReuse > 0 && <p className="auth-note">
      {policy.data.passwordReuse === 1 ? "현재 비밀번호와 다른 비밀번호를 입력해주세요." : "최근 10개 비밀번호와 다른 비밀번호를 입력해주세요."}</p>}
    <form className="auth-recover-form" onSubmit={submit}>
    {!token && <Password current name="current" label="현재 비밀번호" />}
    <Password label="새 비밀번호" minimum={policy.data?.minPassword ?? 12} /><p className="auth-note">{policy.data?.minPassword ?? 12}~128자로 입력해주세요.</p><Password name="confirm" label="새 비밀번호 확인" minimum={policy.data?.minPassword ?? 12} />
    <Status action={action} /><button disabled={action.pending} className="auth-primary auth-block">비밀번호 변경</button><Link href="/login">로그인으로 돌아가기</Link>
    </form>
    {policy.data?.canDefer && <button className="auth-text-button" disabled={action.pending} onClick={() => action.run(async () => {
      await api("/me/password-policy", { method: "POST", body: JSON.stringify({ tenantId: policy.data!.tenantId, passwordRevision: policy.data!.passwordRevision }) });
      router.replace(returnTo); router.refresh();
    })}>{policy.data.deferralMode === "session" ? "다음 로그인 시 변경하기" : "지금부터 " + policy.data.passwordMonths + "개월 후 변경하기"}</button>}
    {policy.error && <p className="auth-note">{policy.error.status === 401 ? "로그인하거나 이메일 재설정 링크를 이용해주세요." : policy.error.message}</p>}</>;
}
export function VerificationForm({ email }: { email: boolean }) {
  const action = useAction(), router = useRouter(), returnTo = safeReturnTo(useSearchParams().get("returnTo")), [backup, setBackup] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await action.run(async () => {
      await post("/two-factor/" + (backup ? "verify-backup-code" : email ? "verify-otp" : "verify-totp"), { code: String(data.get("code")) });
      router.replace(returnTo); router.refresh();
    });
  }
  return <><p className="auth-description">{backup ? "일회용 복구코드를 입력해주세요." : email ? "코드를 요청한 뒤 메일을 확인해주세요." : "인증 앱의 6자리 인증코드를 입력해주세요."}</p>
    <form className="auth-code-row" onSubmit={submit}><input className="cs-input" name="code" aria-label="인증코드" autoComplete="one-time-code" required minLength={6} maxLength={30} /><button disabled={action.pending} className="auth-primary">확인</button></form>
    <Status action={action} />{email && <button disabled={action.pending} className="auth-text-button" onClick={() => action.run(async () => {
      await post("/two-factor/send-otp", {}); action.setNotice("이메일 인증코드 전송을 요청했습니다.");
    })}>인증코드 요청</button>}
    <div className="auth-back"><Link href={authPath(email ? "/login-otp" : "/login-email", returnTo)}>{email ? "OTP 인증" : "이메일 인증"}</Link> · <button type="button" onClick={() => setBackup(!backup)}>복구코드 사용</button></div></>;
}
export function MfaForm() {
  const action = useAction();
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] }>();
  return <><p className="auth-description">현재 비밀번호를 확인한 후 인증 앱을 등록합니다.</p>
    <form className="auth-recover-form" onSubmit={event => {
      event.preventDefault(); const password = String(new FormData(event.currentTarget).get("password"));
      void action.run(async () => setSetup(await post("/two-factor/enable", { password })));
    }}><Password current /><button disabled={action.pending} className="auth-primary">인증 앱 등록</button></form>
    {setup && <section className="auth-recover-form"><p>인증 앱에 아래 키를 등록해주세요.</p><code style={{ overflowWrap: "anywhere" }}>{new URL(setup.totpURI).searchParams.get("secret")}</code>
      <a href={setup.totpURI}>인증 앱에서 열기</a><form onSubmit={event => {
        event.preventDefault(); const code = String(new FormData(event.currentTarget).get("code"));
        void action.run(async () => { await post("/two-factor/verify-totp", { code }); action.setNotice("2단계 인증이 활성화되었습니다. 복구코드를 안전한 곳에 보관해주세요."); });
      }}><input className="cs-input" name="code" aria-label="등록 인증코드" placeholder="6자리 인증코드" required pattern="[0-9]{6}" /><button disabled={action.pending} className="auth-primary">등록 확인</button></form>
      <h2>일회용 복구코드</h2><p className="auth-note">각 코드는 한 번만 사용할 수 있습니다. 안전한 곳에 보관해주세요.</p><pre style={{ whiteSpace: "pre-wrap" }}>{setup.backupCodes.join("\n")}</pre></section>}
    <Status action={action} />
    <details><summary>2단계 인증 해제</summary><form className="auth-recover-form" onSubmit={event => {
      event.preventDefault(); const password = String(new FormData(event.currentTarget).get("password"));
      void action.run(async () => { await post("/two-factor/disable", { password }); setSetup(undefined); action.setNotice("2단계 인증을 해제했습니다."); });
    }}><Password current /><button disabled={action.pending} className="auth-primary">해제하기</button></form></details>
    <Link className="auth-back" href="/my-page/info">프로필로 돌아가기</Link></>;
}
export function LogoutForm() {
  const action = useAction(), router = useRouter();
  return <><h1>로그아웃</h1><p className="auth-description">이 기기의 로그인 세션을 종료합니다.</p><Status action={action} />
    <button disabled={action.pending} className="auth-primary auth-block" onClick={() => action.run(async () => {
      await post("/sign-out", {}); router.replace("/login"); router.refresh();
    })}>로그아웃</button></>;
}
