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
 if (path.includes("fail")) return <Message title="로그인에 실패했습니다. 다시 시도해 주세요." />;
 if (path.startsWith("/expire")) return <Message title="인증 시간이 만료되었습니다." description="로그인 화면에서 다시 시작해주세요." />;
 return <Message title="외부 인증이 필요합니다." description="이 인증 공급자는 아직 연결되지 않았습니다. 이메일 계정으로 로그인할 수 있습니다." />;
}
