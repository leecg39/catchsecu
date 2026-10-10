"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { orgEmailChallengeResult } from "@/contracts/sso";
import { api, ApiError, errorText } from "@/lib/api";

const protocols = ["gpki", "saeol", "groupware"] as const;
type Protocol = typeof protocols[number];
const labels: Record<Protocol, string> = { gpki: "GPKI", saeol: "새올", groupware: "그룹웨어" };
const loginPaths: Record<Protocol, string> = { gpki: "/login/gpki", saeol: "/login/saeol", groupware: "/gwloginUser/login" };
const storageKey = "catchsecu.org-email-registration.v1";
const challengeSchema = orgEmailChallengeResult;
const ticketSchema = z.object({ protocol: z.enum(protocols), ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.iso.datetime() });
const draftSchema = ticketSchema.extend({ email: z.string().max(320), retryAt: z.iso.datetime().optional(),
  challenge: challengeSchema.extend({ email: z.string().email(), attempts: z.number().int().min(0).max(5) }).strict().optional() }).strict();
type Draft = z.infer<typeof draftSchema>;
const loginResultSchema = z.discriminatedUnion("status", [
  ticketSchema.extend({ status: z.literal("email-register") }).strict(),
  z.object({ status: z.literal("verified"), redirect: z.string() }).strict(),
]);
// Only tab-local recovery metadata lives here. PINs and email codes never enter storage.
let memoryDraft: Draft | null = null;
let memoryLoaded = false;
function remember(draft: Draft | null) {
  memoryDraft = draft; memoryLoaded = true;
  try {
    if (draft) sessionStorage.setItem(storageKey, JSON.stringify(draft));
    else sessionStorage.removeItem(storageKey);
    return true;
  } catch { return false; }
}
function restore() {
  if (memoryLoaded) return { draft: memoryDraft, persistent: (() => {
    try { return sessionStorage.getItem(storageKey) === (memoryDraft ? JSON.stringify(memoryDraft) : null); } catch { return false; }
  })() };
  try {
    const raw = sessionStorage.getItem(storageKey);
    const parsed = raw ? draftSchema.safeParse(JSON.parse(raw)) : null;
    memoryDraft = parsed?.success ? parsed.data : null; memoryLoaded = true;
    if (raw && !memoryDraft) sessionStorage.removeItem(storageKey);
    return { draft: memoryDraft, persistent: true };
  } catch { memoryLoaded = true; return { draft: memoryDraft, persistent: false }; }
}
function verifiedRedirect(value: unknown) {
  const result = loginResultSchema.parse(value);
  if (result.status !== "verified" || !result.redirect.startsWith("/") || result.redirect.startsWith("//")
    || /[\\\x00-\x20]/.test(result.redirect)) throw new Error("인증 결과를 확인할 수 없습니다. 조직 인증을 다시 시작해주세요.");
  return result.redirect;
}
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return now;
}
const ticketErrors = new Set(["STATE_INVALID", "STATE_REPLAYED", "SSO_BROWSER_MISMATCH", "SSO_HTTPS_REQUIRED", "DIRECTORY_CHANGED", "EMAIL_REGISTERED", "SSO_CONFIGURATION_CHANGED", "NOT_FOUND"]);
const challengeErrors = new Set(["ORG_EMAIL_CHALLENGE_INVALID", "ORG_EMAIL_CHALLENGE_NOT_FOUND", "ORG_EMAIL_ATTEMPTS_EXCEEDED"]);

export function OrgLoginForm({ protocol, label = labels[protocol] }: { protocol: Protocol; label?: string }) {
  const router = useRouter(), state = useSearchParams().get("state") ?? undefined;
  const [orgCode, setOrgCode] = useState(""), [employeeNo, setEmployeeNo] = useState(""), [pin, setPin] = useState("");
  const [error, setError] = useState(""), [pending, setPending] = useState(false), [restart, setRestart] = useState(false);
  const [inline, setInline] = useState<{ draft: Draft; persistent: boolean }>(), lock = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || restart) return;
    lock.current = true; setPending(true); setError("");
    let navigating = false;
    try {
      const result = loginResultSchema.parse(await api("/auth/org/login", { method: "POST",
        body: JSON.stringify({ protocol, orgCode, employeeNo, pin, ...(state ? { state } : {}) }) }));
      if (result.status === "verified") {
        const redirect = verifiedRedirect(result); remember(null); setPin(""); window.location.assign(redirect); navigating = true;
      } else {
        if (result.protocol !== protocol) throw new Error("조직 인증 종류가 일치하지 않습니다. 인증을 다시 시작해주세요.");
        const draft: Draft = { protocol: result.protocol, ticket: result.ticket, expiresAt: result.expiresAt, email: "" };
        const persistent = remember(draft); setPin(""); setInline({ draft, persistent });
        if (persistent) router.replace("/gpki/email-register");
      }
    } catch (cause) {
      setError(errorText(cause));
      if (state && cause instanceof ApiError && cause.status !== 0 && cause.status !== 429 && cause.code !== "ORG_AUTH_FAILED") setRestart(true);
    } finally { if (!navigating) { lock.current = false; setPending(false); } }
  }
  if (inline) return <EmailRegistration initial={inline.draft} persistent={inline.persistent} />;
  return <><form className="auth-recover-form" onSubmit={submit}>
    <p className="auth-note">가상 인증 — 외부 {label} 기관 미연동. 가상 디렉터리에 등록된 계정만 로그인됩니다.</p>
    <label>조직 식별자<input name="orgCode" autoComplete="off" required maxLength={60} disabled={pending || restart} value={orgCode} onChange={event => setOrgCode(event.target.value)} /></label>
    <label>사번<input name="employeeNo" autoComplete="off" required maxLength={60} disabled={pending || restart} value={employeeNo} onChange={event => setEmployeeNo(event.target.value)} /></label>
    <label>인증번호<input name="pin" type="password" autoComplete="off" required minLength={4} maxLength={64} disabled={pending || restart} value={pin} onChange={event => setPin(event.target.value)} /></label>
    {error && <p role="alert" className="auth-error">{error}</p>}
    <button disabled={pending || restart} className="auth-primary auth-block">{pending ? "인증 중…" : `${label} 인증 로그인`}</button>
  </form><button type="button" className="auth-text-button" disabled={pending} onClick={() => { remember(null); window.location.replace(loginPaths[protocol]); }}>조직 로그인 다시 시작</button>
    {restart && <p className="auth-note">초대나 계정 연결 중이었다면 받은 초대 또는 연결 관리 화면에서 다시 시작해주세요.</p>}</>;
}

export function OrgEmailRegister() {
  const [loaded, setLoaded] = useState<{ draft: Draft | null; persistent: boolean }>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore tab-local browser storage only after hydration.
    setLoaded(restore());
  }, []);
  if (!loaded) return <p role="status" className="auth-note">진행 중인 조직 인증을 확인하고 있습니다.</p>;
  if (loaded.draft) return <EmailRegistration key={loaded.draft.ticket} initial={loaded.draft} persistent={loaded.persistent} />;
  return <><p role="alert" className="auth-description">진행 중인 이메일 등록 요청이 없습니다. 조직 인증을 먼저 시작해주세요.</p>
    {!loaded.persistent && <p className="auth-note">브라우저가 임시 저장을 허용하지 않아 이전 요청을 복구할 수 없습니다.</p>}
    <div className="auth-recover-form">{protocols.map(protocol => <Link key={protocol} className="auth-primary" href={loginPaths[protocol]}>{labels[protocol]} 조직 로그인</Link>)}</div>
    <Link className="auth-back" href="/login">이메일 로그인으로 돌아가기</Link></>;
}

function EmailRegistration({ initial, persistent }: { initial: Draft; persistent: boolean }) {
  const [draft, setDraft] = useState(initial), [stored, setStored] = useState(persistent), [code, setCode] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [pending, setPending] = useState(false), [invalidTicket, setInvalidTicket] = useState(false);
  const lock = useRef(false), now = useNow();
  const ticketExpired = Date.parse(draft.expiresAt) <= now;
  const challenge = draft.challenge?.email === draft.email.trim().toLowerCase() ? draft.challenge : undefined;
  const challengeExpired = !!challenge && Date.parse(challenge.expiresAt) <= now;
  const retrySeconds = Math.max(0, Math.ceil(((draft.retryAt ? Date.parse(draft.retryAt) : 0) - now) / 1000));
  function update(next: Draft) { setDraft(next); setStored(remember(next)); }
  function failed(cause: unknown, verifying = false) {
    setError(errorText(cause));
    if (!(cause instanceof ApiError)) return;
    if (ticketErrors.has(cause.code) || cause.status === 403) { remember(null); setInvalidTicket(true); setCode(""); return; }
    if (cause.status === 429) { update({ ...draft, retryAt: new Date(Date.now() + 60000).toISOString() }); return; }
    if (challengeErrors.has(cause.code)) { update({ ...draft, challenge: undefined }); setCode(""); return; }
    if (verifying && cause.code === "ORG_EMAIL_CODE_INVALID" && challenge) {
      const attempts = challenge.attempts + 1;
      update({ ...draft, challenge: attempts >= 5 ? undefined : { ...challenge, attempts } }); setCode("");
      if (attempts >= 5) setNotice("인증번호 입력에 5회 실패했습니다. 새 인증번호를 요청해주세요.");
    }
  }
  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || ticketExpired || invalidTicket || retrySeconds > 0) return;
    lock.current = true; setPending(true); setError(""); setNotice("");
    const email = draft.email.trim().toLowerCase();
    try {
      const result = challengeSchema.parse(await api("/auth/org/email-register/challenge", { method: "POST", body: JSON.stringify({ ticket: draft.ticket, email }) }));
      update({ ...draft, email, retryAt: result.retryAt, challenge: { ...result, email, attempts: 0 } }); setCode("");
      setNotice("입력한 이메일로 인증번호를 요청했습니다. 메일의 6자리 번호를 입력해주세요.");
    } catch (cause) { failed(cause); } finally { lock.current = false; setPending(false); }
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || !challenge || ticketExpired || invalidTicket || challengeExpired || code.length !== 6) return;
    lock.current = true; setPending(true); setError(""); setNotice("");
    let navigating = false;
    try {
      const redirect = verifiedRedirect(await api("/auth/org/email-register", { method: "POST", body: JSON.stringify({ ticket: draft.ticket,
        email: challenge.email, challengeId: challenge.challengeId, code }) }));
      remember(null); setCode(""); window.location.assign(redirect); navigating = true;
    } catch (cause) { failed(cause, true); } finally { if (!navigating) { lock.current = false; setPending(false); } }
  }
  return <><p className="auth-description">{labels[draft.protocol]} 조직 인증을 마쳤습니다. 본인 이메일을 확인한 뒤 계정 등록을 완료합니다.</p>
    <p className="auth-note">가상 조직 인증이며 실제 외부 기관과 연결되지 않았습니다. 요청 유효 기한: {new Date(draft.expiresAt).toLocaleTimeString("ko-KR")}</p>
    {!stored && <p role="status" className="auth-note">이 브라우저에서는 임시 저장을 사용할 수 없습니다. 현재 화면에서 계속 진행할 수 있지만 새로고침하거나 창을 닫으면 조직 인증부터 다시 시작해야 합니다.</p>}
    {(ticketExpired || invalidTicket) && <p role="alert" className="auth-error">조직 인증 요청이 만료되었거나 사용할 수 없습니다. 조직 로그인을 다시 시작해주세요.</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}{notice && <p role="status" className="auth-note">{notice}</p>}
    <form className="auth-recover-form" onSubmit={issue}>
      <label>등록할 이메일<input name="email" type="email" autoComplete="email" required maxLength={320} disabled={pending || ticketExpired || invalidTicket}
        value={draft.email} onChange={event => { update({ ...draft, email: event.target.value, challenge: undefined }); setCode(""); setError(""); setNotice(""); }} /></label>
      <button className="auth-primary" disabled={pending || ticketExpired || invalidTicket || retrySeconds > 0}>{pending ? "처리 중…" : retrySeconds ? `${retrySeconds}초 후 다시 요청` : challenge ? "인증번호 다시 요청" : "이메일 인증번호 요청"}</button>
    </form>
    {challenge && <form className="auth-recover-form" onSubmit={verify}>
      <p className="auth-note">인증번호 유효 기한: {new Date(challenge.expiresAt).toLocaleTimeString("ko-KR")}. 새로고침 후에는 인증번호를 다시 입력해주세요.</p>
      {challengeExpired && <p role="alert" className="auth-error">인증번호가 만료되었습니다. 새 인증번호를 요청해주세요.</p>}
      <label>이메일 인증번호<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code}
        disabled={pending || ticketExpired || invalidTicket || challengeExpired} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} /></label>
      <button className="auth-primary" disabled={pending || ticketExpired || invalidTicket || challengeExpired || code.length !== 6}>{pending ? "확인 중…" : "이메일 확인 및 등록 완료"}</button>
    </form>}
    <button type="button" className="auth-text-button" disabled={pending} onClick={() => { remember(null); setCode(""); window.location.replace(loginPaths[draft.protocol]); }}>조직 로그인 다시 시작</button>
    <p className="auth-note">초대나 계정 연결 중이었다면 받은 초대 또는 연결 관리 화면에서 다시 시작해주세요.</p>
  </>;
}
