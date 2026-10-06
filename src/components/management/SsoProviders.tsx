"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import type { SsoProviderRecord } from "@/contracts/sso";
import { useApplication } from "../ApplicationContext";
import { ActionButton, EmptyState, Modal, PageHeading, Panel } from "../shared";
import { useConfirm } from "../ux/confirm";

type ListResponse = { items: SsoProviderRecord[] };
const VIRTUAL_PROTOCOLS = new Set(["gpki", "saeol", "groupware"]);
const isVirtual = (protocol: string) => VIRTUAL_PROTOCOLS.has(protocol);
const PROTOCOL_LABELS: Record<string, string> = { oidc: "OIDC", saml: "SAML 2.0", gpki: "가상 GPKI", saeol: "가상 새올", groupware: "가상 그룹웨어" };
const ORG_LOGIN_PATHS: Record<string, string> = { gpki: "/login/gpki", saeol: "/login/saeol", groupware: "/gwloginUser/login" };
type OrgMember = { id: string; orgCode: string; employeeNo: string; name: string; email: string | null; version: number };

export function SsoProviders({ settings = false }: { settings?: boolean }) {
  const app = useApplication();
  return <SsoContent key={(app.data?.company?.id ?? "none") + ":" + (app.data?.capabilities ?? []).join(",")} settings={settings} />;
}

function SsoContent({ settings }: { settings: boolean }) {
  const app = useApplication();
  const canManage = !!app.data?.capabilities.includes("security.write");
  const [edit, setEdit] = useState<SsoProviderRecord | null | undefined>(settings ? null : undefined);
  const [directory, setDirectory] = useState<SsoProviderRecord | undefined>();
  const [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const ask = useConfirm();
  const result = useResource<ListResponse>("/security/sso");
  const items = result.data?.items;

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(done); result.reload(); }
    catch (cause) { setError(errorText(cause)); if (cause instanceof ApiError && cause.code === "SSO_REAUTH_REQUIRED") setReauth(true); }
    finally { setBusy(false); }
  }
  const toggle = async (row: SsoProviderRecord) => {
    if (row.enabled && !await ask({ title: "SSO 사용 중지", message: `“${row.name}”의 새 로그인과 진행 중 인증이 중지됩니다. 이미 로그인한 기기는 유지됩니다. 다른 로그인 수단이 없는 활성 구성원이 있으면 중지할 수 없습니다.`, confirmLabel: "사용 중지" })) return;
    await run(() => api("/security/sso/" + row.id, { method: "PATCH", body: JSON.stringify({ version: row.version, enabled: !row.enabled }) }),
      row.enabled ? "새 SSO 로그인을 중지했습니다. 기존 로그인은 유지됩니다." : "SSO 연결을 활성화했습니다.");
  };
  const preflight = (row: SsoProviderRecord) => run(
    () => api("/security/sso/" + row.id + "/preflight", { method: "POST" }),
    "사전검사를 다시 실행했습니다.");
  const remove = async (row: SsoProviderRecord) => {
    if (!await ask({ title: "SSO 연결 삭제", message: `“${row.name}” SSO 설정과 연결 계정을 삭제하고, 연결된 구성원의 모든 기기 로그인을 종료합니다. 다른 로그인 수단이 없는 활성 구성원이 있으면 삭제할 수 없습니다.`, confirmLabel: "삭제" })) return;
    void run(async () => {
      const removed = await api<{ signedOut: boolean }>("/security/sso/" + row.id, { method: "DELETE", body: JSON.stringify({ version: row.version }) });
      if (removed.signedOut) window.location.assign("/login");
    }, "SSO 설정과 연결 계정을 삭제하고 관련 로그인을 종료했습니다.");
  };

  return <>
    {reauth && <p className="mg-description"><Link href="/login?returnTo=%2Fsecurity%2Fsso">다시 로그인한 뒤 SSO 설정으로 돌아가기</Link></p>}
    <PageHeading title={settings ? "SSO 연결 설정" : "SSO 연결 관리"}>
      {settings
        ? <Link className="cs-button" href="/security/sso">목록 보기</Link>
        : canManage && <ActionButton disabled={busy} onClick={() => setEdit(null)}>SSO 연결 등록</ActionButton>}
    </PageHeading>
    <p className="mg-description">OIDC 또는 SAML 공급자로 회사 구성원의 로그인을 연결합니다. 등록 후 사전검사를 통과해야 활성화할 수 있습니다. 사용 중지·인증 정보 교체는 새 로그인과 진행 중 인증에 적용되며 기존 로그인은 유지됩니다.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {result.error
      ? <Panel><p role="alert">{result.error.message}</p><ActionButton secondary onClick={result.reload}>다시 불러오기</ActionButton></Panel>
      : !items ? <Panel><p role="status">SSO 설정을 불러오는 중입니다.</p></Panel>
      : <Panel>{items.length
          ? <div className="mg-table-wrap"><table className="cs-table"><thead><tr>
              <th>이름</th><th>프로토콜</th><th>Issuer</th><th>로그인 주소</th><th>사전검사</th><th>사용 상태</th><th>등록일</th>{canManage && <th>관리</th>}
            </tr></thead><tbody>
              {items.map(row => <tr key={row.id}>
                <td>{row.name}</td>
                <td>{PROTOCOL_LABELS[row.protocol] ?? row.protocol.toUpperCase()}</td>
                <td className="sso-issuer">{row.issuer}</td>
                <td><code className="sso-login-url">{isVirtual(row.protocol) ? ORG_LOGIN_PATHS[row.protocol] : `/api/v1/auth/sso/${row.id}?mode=login`}</code></td>
                <td>{row.preflightOk ? <span className="sso-ok">통과</span> : <span className="sso-fail" title={row.preflightDetail}>미통과 — {row.preflightDetail}</span>}</td>
                <td>{row.enabled ? "사용" : "사용 안 함"}</td>
                <td>{new Date(row.createdAt).toLocaleDateString("ko-KR")}</td>
                {canManage && <td><div className="mg-flex">
                  {isVirtual(row.protocol) && <ActionButton secondary disabled={busy} onClick={() => setDirectory(row)}>디렉터리</ActionButton>}
                  <ActionButton secondary disabled={busy} onClick={() => void preflight(row)}>사전검사</ActionButton>
                  <ActionButton secondary disabled={busy || (!row.enabled && !row.preflightOk)}
                    title={!row.enabled && !row.preflightOk ? "사전검사를 먼저 통과해야 합니다" : undefined}
                    onClick={() => void toggle(row)}>{row.enabled ? "사용 안 함" : "사용"}</ActionButton>
                  <ActionButton secondary disabled={busy} onClick={() => setEdit(row)}>수정</ActionButton>
                  <ActionButton secondary disabled={busy} onClick={() => void remove(row)}>삭제</ActionButton>
                </div></td>}
              </tr>)}
            </tbody></table></div>
          : <EmptyState text="등록한 SSO 연결이 없습니다." />}</Panel>}
    {edit !== undefined && <ProviderEditor key={edit?.id ?? "new"} row={edit}
      onClose={() => { setEdit(undefined); result.reload(); }} onSaved={m => { setEdit(undefined); setNotice(m); result.reload(); }} />}
    {directory && <OrgDirectory key={directory.id} provider={directory} onClose={() => setDirectory(undefined)} />}
  </>;
}

// 가상 조직 인증 디렉터리 — mock DB. 등록된 구성원만 조직 인증을 통과한다.
function OrgDirectory({ provider, onClose }: { provider: SsoProviderRecord; onClose: () => void }) {
  const result = useResource<{ items: OrgMember[] }>(`/security/sso/${provider.id}/directory`);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const ask = useConfirm();

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await api(`/security/sso/${provider.id}/directory`, { method: "POST", headers: { "Idempotency-Key": key.current },
        body: JSON.stringify({ orgCode: String(form.get("orgCode") ?? "").trim(), employeeNo: String(form.get("employeeNo") ?? "").trim(),
          name: String(form.get("name") ?? "").trim(), ...(String(form.get("email") ?? "").trim() ? { email: String(form.get("email")).trim() } : {}),
          pin: String(form.get("pin") ?? "") }) });
      (event.target as HTMLFormElement).reset(); key.current = crypto.randomUUID(); result.reload();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  const remove = async (row: OrgMember) => {
    if (!await ask({ title: "디렉터리 구성원 삭제", message: `${row.name}(${row.orgCode}/${row.employeeNo})의 조직 인증을 해제합니다.`, confirmLabel: "삭제" })) return;
    setBusy(true); setError("");
    try { await api(`/security/sso/${provider.id}/directory/${row.id}`, { method: "DELETE", body: JSON.stringify({ version: row.version }) }); result.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "삭제하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <Modal title={`가상 디렉터리 — ${provider.name}`} onClose={() => { if (!busy) onClose(); }}>
    <p className="mg-description">mock 디렉터리 — 여기 등록된 조직 식별자+사번+인증번호만 로그인을 통과합니다. 이메일을 비우면 첫 로그인 시 등록 화면이 나옵니다.</p>
    {error && <p role="alert">{error}</p>}
    {result.data?.items.length ? <div className="mg-table-wrap"><table className="cs-table"><thead><tr>
        <th>조직 식별자</th><th>사번</th><th>이름</th><th>이메일</th><th>관리</th></tr></thead><tbody>
        {result.data.items.map(row => <tr key={row.id}>
          <td>{row.orgCode}</td><td>{row.employeeNo}</td><td>{row.name}</td>
          <td>{row.email ?? "미등록 — 첫 로그인 시 등록"}</td>
          <td><ActionButton secondary disabled={busy} onClick={() => void remove(row)}>삭제</ActionButton></td></tr>)}
      </tbody></table></div> : <EmptyState text="등록된 디렉터리 구성원이 없습니다." />}
    <form onSubmit={e => void save(e)}>
      <fieldset disabled={busy} className="policy-fields">
        <label>조직 식별자<input className="cs-input" name="orgCode" required minLength={2} maxLength={60} placeholder="예: CATCH-SEOUL" /></label>
        <label>사번<input className="cs-input" name="employeeNo" required minLength={2} maxLength={60} placeholder="예: EMP-001" /></label>
        <label>이름<input className="cs-input" name="name" required maxLength={100} /></label>
        <label>이메일 (비우면 첫 로그인 시 등록)<input className="cs-input" name="email" type="email" maxLength={320} /></label>
        <label>인증번호 (4자 이상)<input className="cs-input" name="pin" type="password" required minLength={4} maxLength={64} autoComplete="new-password" /></label>
      </fieldset>
      <div className="mg-flex"><ActionButton type="submit" disabled={busy}>디렉터리에 등록</ActionButton></div>
    </form>
  </Modal>;
}

function ProviderEditor({ row, onClose, onSaved }: { row: SsoProviderRecord | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [protocol, setProtocol] = useState<SsoProviderRecord["protocol"]>(row?.protocol ?? "oidc");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const saml = protocol === "saml", virtual = isVirtual(protocol);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true); setError("");
    try {
      if (row) {
        const body: Record<string, unknown> = { version: row.version, name: text("name") };
        if (text("scopes")) body.scopes = text("scopes");
        if (text("clientSecret")) body.clientSecret = text("clientSecret");
        if (text("idpCert")) body.idpCert = text("idpCert");
        const saved = await api<SsoProviderRecord>("/security/sso/" + row.id, { method: "PATCH", body: JSON.stringify(body) });
        onSaved(saved.preflightOk ? "SSO 연결을 수정했습니다."
          : "SSO 연결을 수정했습니다. 사전검사를 통과한 뒤 사용을 활성화해주세요.");
      } else {
        const body: Record<string, unknown> = virtual
          ? { protocol, name: text("name") }
          : { protocol, name: text("name"), issuer: text("issuer"), clientId: text("clientId"),
            authorizationUrl: text("authorizationUrl") };
        if (text("clientSecret")) body.clientSecret = text("clientSecret");
        if (saml) body.idpCert = text("idpCert");
        else if (!virtual) Object.assign(body, { tokenUrl: text("tokenUrl"), jwksUrl: text("jwksUrl"), scopes: text("scopes") || "openid profile email" });
        const created = await api<SsoProviderRecord & { preflight?: { ok: boolean; detail: string } }>("/security/sso",
          { method: "POST", headers: { "Idempotency-Key": key.current }, body: JSON.stringify(body) });
        onSaved(created.preflight && !created.preflight.ok
          ? "SSO 연결은 등록되었으나 사전검사에 실패했습니다: " + created.preflight.detail + ". 목록에서 설정을 확인하고 다시 검사해주세요."
          : "SSO 연결을 등록했습니다.");
      }
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  return <Modal title={row ? "SSO 연결 수정" : "SSO 연결 등록"} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={e => void save(e)}>
      {error && <p role="alert">{error}</p>}
      {row && <p className="mg-description">인증서·시크릿·스코프를 변경하면 새 로그인과 진행 중 인증이 중지됩니다. 기존 로그인은 유지됩니다. 활성 구성원의 다른 로그인 수단을 먼저 준비하고, 저장 후 사전검사를 통과해 사용을 다시 활성화해주세요.</p>}
      <fieldset disabled={busy} className="policy-fields">
        {!row && <label>프로토콜<select className="cs-input" name="protocol" value={protocol}
          onChange={e => setProtocol(e.target.value as SsoProviderRecord["protocol"])}>
          <option value="oidc">OIDC (OpenID Connect)</option><option value="saml">SAML 2.0</option>
          <option value="gpki">가상 GPKI (mock 디렉터리)</option>
          <option value="saeol">가상 새올 (mock 디렉터리)</option>
          <option value="groupware">가상 그룹웨어 (mock 디렉터리)</option>
        </select></label>}
        {virtual && <p className="mg-description">가상 어댑터 — 외부 기관 미연동. 등록 후 목록의 “디렉터리”에서 mock 구성원을 추가해야 로그인이 동작합니다.</p>}
        <label>표시 이름<input className="cs-input" name="name" required maxLength={60} defaultValue={row?.name} placeholder="예: 본사 Entra ID" /></label>
        {!row && !virtual && <>
          <label>Issuer<input className="cs-input" name="issuer" required maxLength={500}
            placeholder={saml ? "IdP 엔터티 ID (예: https://idp.example.com/metadata)" : "https://idp.example.com"} /></label>
          <label>클라이언트 ID<input className="cs-input" name="clientId" required maxLength={300}
            placeholder={saml ? "SP 엔터티 ID" : "애플리케이션 클라이언트 ID"} /></label>
          <label>{saml ? "IdP SSO 주소 (HTTP-POST)" : "인가 엔드포인트 (authorization URL)"}
            <input className="cs-input" name="authorizationUrl" required maxLength={500}
              placeholder={saml ? "https://idp.example.com/sso" : "https://idp.example.com/authorize"} /></label>
          <label>클라이언트 시크릿{saml && " (없으면 비움)"}<input className="cs-input" name="clientSecret" type="password" maxLength={500} autoComplete="new-password" /></label>
          {saml
            ? <label>IdP 서명 인증서 (PEM)<textarea className="cs-input sso-cert" name="idpCert" required
                placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"} /></label>
            : <>
                <label>토큰 엔드포인트<input className="cs-input" name="tokenUrl" required maxLength={500} placeholder="https://idp.example.com/token" /></label>
                <label>JWKS 주소<input className="cs-input" name="jwksUrl" required maxLength={500} placeholder="https://idp.example.com/jwks.json" /></label>
              </>}
        </>}
        {row && <>
          {!saml && !virtual && <label>스코프<input className="cs-input" name="scopes" maxLength={300} defaultValue={row.scopes} /></label>}
          {!virtual && <label>클라이언트 시크릿 교체 (비우면 유지)<input className="cs-input" name="clientSecret" type="password" maxLength={500} autoComplete="new-password" /></label>}
          {saml && <label>IdP 서명 인증서 교체 (비우면 유지 — 교체 시 사전검사 재실행 필요)<textarea className="cs-input sso-cert" name="idpCert"
            placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"} /></label>}
        </>}
      </fieldset>
      <div className="mg-flex"><ActionButton type="submit" disabled={busy}>{row ? "저장" : "등록"}</ActionButton></div>
    </form>
  </Modal>;
}
