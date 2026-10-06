"use client";
import Link from "next/link";
import { SsoAccounts } from "./SsoAccounts";
import { SsoStartForm } from "./SsoRecovery";
import { IpDeniedCompanies } from "./LiveAuth";
import { useSearchParams } from "next/navigation";
import { authPath } from "@/lib/return-to";
import { InvitationAccept } from "./InvitationAccept";
import { useEffect, useState, type ReactNode } from "react";
import {LoginForm, SignupOrResetForm, PasswordForm, VerificationForm, MfaForm, LogoutForm, AuthCallbackError} from "./LiveAuth";
import { api, errorText } from "@/lib/api";
import "./auth.css";

const A = "/assets/img/catchsecu/";
const routes = ["/login", "/signup", "/password-change-email", "/passwordChange", "/password-change-rule", "/two-step", "/auth-code", "/expire", "/identification", "/gpki", "/saeol", "/link/oauth2", "/oauth2", "/logout", "/not-allow-ip", "/gwloginUser/login"];
export function matchAuth(path: string) { return routes.some(r => path === r || path.startsWith(r + "/") || (r === "/login" && path.startsWith("/login-")) || (r === "/two-step" && path === "/two-step-setting")); }
function Frame({ children, login = false }: { children: ReactNode; login?: boolean }) { return <main className={`auth-page ${login ? "auth-login" : ""}`}><div className="auth-container"><Link href="/login" className="auth-logo" aria-label="캐치시큐 로그인"><img src={A + "logo/login_logo.png"} width={206} height={26} alt="catchsecu" /></Link>{children}</div></main>; }
function Card({ children }: { children: ReactNode }) { return <section className="auth-card">{children}</section>; }
const reviews = [
 { text: '"개인정보 전담부서가 생긴 느낌이에요!\n회사 서비스에 딱 맞는 서류를 자동으로 만들어주니까\n정말 편리해요."', logo: "sparkplus.png", width: 102, company: "스파크플러스" },
 { text: '"전문가가 아닌데도 쉽게 관리가 가능해요!\n인터넷 검색, 법률 서비스로도 개인정보에 대해 이해가 잘 안됐는데 캐치시큐 한번에 알게 됐어요."', logo: "eventus.png", width: 57, company: "이벤터스" },
 { text: '"어려웠던 개인정보보호 이젠 쉽게 처리해요!\n개인정보보호 관련 업무에 들이는 시간이 줄어들어 업무 효율성이 높아졌어요!"', logo: "monymony.png", width: 87, company: "모니모니(썸원)" }
];

function Testimonials() { const [index, setIndex] = useState(0); useEffect(() => { const timer = setInterval(() => setIndex(i => (i + 1) % 3), 6000); return () => clearInterval(timer); }, []); const review = reviews[index]; return <section className="auth-testimonials"><p>{review.text}</p><div className="auth-review-brand"><img src={A + "logo/" + review.logo} width={review.width} alt={review.company} /><b>{review.company}</b></div><div className="auth-dots">{reviews.map((r, i) => <button key={r.company} aria-label={`${r.company} 후기`} aria-pressed={i === index} onClick={() => setIndex(i)} />)}</div></section>; }
function Login() {
 const returnTo = useSearchParams().get("returnTo");
 return <Frame login><Card><LoginForm/><div className="auth-signup">아직 계정이 없으신가요? <Link href={authPath("/signup", returnTo)}>회원가입</Link></div><div className="auth-divider"><span/>or<span/></div><Link className="auth-social" href="/login/oauth2"><img src={A+"google-logo.svg"} width={32} height={32} alt=""/>구글 계정 로그인</Link><Link className="auth-social" href="/login/saml"><img src={A+"ms-logo.svg"} width={32} height={32} alt=""/>MS 계정 로그인</Link></Card><section className="auth-lookup"><Link href="/infoOwner/find">캐치폼 동의 이력을 조회하고 싶어요<span>›</span></Link><hr/><Link href="/shared-privacy/verify">공유받은 외부 개인정보를 조회하고 싶어요<span>›</span></Link></section><Testimonials/></Frame>;
}
function Message({ title, description, action = "로그인으로 돌아가기", href = "/login" }: { title: string; description?: string; action?: string; href?: string }) { const returnTo = useSearchParams().get("returnTo"); return <Frame><Card><h1>{title}</h1>{description && <p className="auth-description">{description}</p>}<AuthCallbackError /><Link className="auth-primary auth-block" href={authPath(href, returnTo)}>{action}</Link></Card></Frame>; }
function Verification({email=false}:{email?:boolean}){return <Frame><Card><h1>{email?'이메일 인증':'OTP 인증'}</h1><VerificationForm email={email}/></Card></Frame>}
function TwoStep(){return <Frame><Card><h1>2단계 인증 설정</h1><MfaForm/></Card></Frame>}
function ChangePassword(){return <Frame><Card><h1>비밀번호 변경</h1><PasswordForm/></Card></Frame>}
function RecoverOrSignup({signup=false}:{signup?:boolean}){const returnTo=useSearchParams().get("returnTo");return <Frame><Card><h1>{signup?'회원가입':'비밀번호 찾기'}</h1><SignupOrResetForm signup={signup}/><Link className="auth-back" href={authPath("/login", returnTo)}>로그인으로 돌아가기</Link></Card></Frame>}
// 가상 조직 인증 — 외부 GPKI·새올·그룹웨어 기관 미연동 상태에서
// mock 디렉터리(VirtualOrgMember)로 login/verified/fail/email-register 경로를 검증한다.
const ORG_PROTOCOLS: Record<string, { protocol: "gpki" | "saeol" | "groupware"; label: string }> = {
  "/login/gpki": { protocol: "gpki", label: "GPKI" }, "/gpki": { protocol: "gpki", label: "GPKI" },
  "/login/saeol": { protocol: "saeol", label: "새올" }, "/saeol": { protocol: "saeol", label: "새올" },
  "/gwloginUser/login": { protocol: "groupware", label: "그룹웨어" },
};
type OrgLoginResult = { status: "verified" | "email-register"; redirect?: string; ticket?: string };
function OrgLoginForm({ protocol, label }: { protocol: string; label: string }) {
  const state = useSearchParams().get("state") ?? undefined;
  const [orgCode, setOrgCode] = useState(""), [employeeNo, setEmployeeNo] = useState(""), [pin, setPin] = useState("");
  const [ticket, setTicket] = useState(""), [email, setEmail] = useState(""), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const post = async (path: string, value: unknown) => api<OrgLoginResult>(path, { method: "POST", body: JSON.stringify(value) });
  async function run(path: string, value: unknown) {
    setPending(true); setError("");
    try {
      const result = await post(path, value);
      if (result.status === "verified") window.location.assign(result.redirect ?? "/dashboard");
      else setTicket(result.ticket ?? "");
    } catch (cause) { setError(errorText(cause)); }
    finally { setPending(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void run(
      ticket ? "/auth/org/email-register" : "/auth/org/login",
      ticket ? { ticket, email } : { protocol, orgCode, employeeNo, pin, ...(state ? { state } : {}) }); }}>
    <p className="auth-note">가상 인증 — 외부 {label} 기관 미연동. mock 디렉터리에 등록된 계정만 로그인됩니다.</p>
    {ticket
      ? <><input className="auth-email" type="email" name="email" aria-label="이메일" placeholder="등록할 이메일을 입력해주세요" required value={email} onChange={event => setEmail(event.target.value)} />
        <p className="auth-note">디렉터리에 이메일이 없습니다. 등록하면 계정에 연결됩니다.</p></>
      : <><input className="auth-email" name="orgCode" aria-label="조직 식별자" placeholder="조직 식별자" required value={orgCode} onChange={event => setOrgCode(event.target.value)} />
        <input className="auth-email" name="employeeNo" aria-label="사번" placeholder="사번" required value={employeeNo} onChange={event => setEmployeeNo(event.target.value)} />
        <input className="auth-email" name="pin" type="password" aria-label="인증번호" placeholder="인증번호" required minLength={4} maxLength={64} value={pin} onChange={event => setPin(event.target.value)} /></>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    <button disabled={pending} className="auth-primary auth-block">{pending ? "인증 중…" : ticket ? "이메일 등록" : `${label} 인증 로그인`}</button>
  </form>;
}
export function AuthPages({ path }: { path: string }) {
 if(path === "/oauth2/invite/signup")return <Frame><Card><InvitationAccept/></Card></Frame>;
 if (["/login/oauth2", "/login/saml", "/login/saml/start"].includes(path)) return <Frame><Card><h1>회사 SSO 로그인</h1><AuthCallbackError/><SsoStartForm/></Card></Frame>;
 if (path === "/link/oauth2" || path === "/link/oauth2/verified") return <Frame><Card><h1>내 SSO 연결 계정</h1><SsoAccounts/></Card></Frame>;
 if(path === "/logout")return <Frame><Card><LogoutForm/></Card></Frame>;
 if (path === "/login") return <Login />;
 if (path === "/login-email") return <Verification email />;
 if (path === "/login-otp" || path === "/auth-code") return <Verification />;
 if (path === "/two-step" || path === "/two-step-setting") return <TwoStep />;
 if (path === "/password-change-rule" || path === "/passwordChange") return <ChangePassword />;
 if (path === "/password-change-email/complete") return <Message title="이메일을 확인해주세요." description="가입된 이메일이면 비밀번호 재설정 메일 전송을 요청했습니다." />;
 if (path === "/password-change-email") return <RecoverOrSignup />;
 if (path === "/signup" || path.startsWith("/oauth2/") && path.includes("signup")) return <RecoverOrSignup signup />;
 if (path === "/not-allow-ip") return <Frame><Card><h1>허용되지 않은 IP 접근 제한</h1><p className="auth-description">회사에서 허용한 IP 주소에서 접속해주세요. 다른 소속 회사의 접근 권한이 있다면 회사를 변경할 수 있습니다.</p><IpDeniedCompanies/></Card></Frame>;
 const org = ORG_PROTOCOLS[path];
 if (org) return <Frame><Card><h1>{org.label} 조직 인증</h1><OrgLoginForm protocol={org.protocol} label={org.label}/></Card></Frame>;
 if (path.includes("fail")) return <Message title="로그인에 실패했습니다. 다시 시도해 주세요." />;
 if (path.startsWith("/expire")) return <Message title="인증 시간이 만료되었습니다." description="로그인 화면에서 다시 시작해주세요." />;
 return <Message title="외부 인증이 필요합니다." description="이 인증 공급자는 아직 연결되지 않았습니다. 이메일 계정으로 로그인할 수 있습니다." />;
}
