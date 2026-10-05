"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { api, errorText, useResource } from "@/lib/api";
import type { SsoProviderRecord } from "@/contracts/sso";
import { useApplication } from "../ApplicationContext";
import { ActionButton, EmptyState, Modal, PageHeading, Panel } from "../shared";
import { useConfirm } from "../ux/confirm";

type ListResponse = { items: SsoProviderRecord[] };

export function SsoProviders({ settings = false }: { settings?: boolean }) {
  const app = useApplication();
  return <SsoContent key={(app.data?.company?.id ?? "none") + ":" + (app.data?.capabilities ?? []).join(",")} settings={settings} />;
}

function SsoContent({ settings }: { settings: boolean }) {
  const app = useApplication();
  const canManage = !!app.data?.capabilities.includes("security.write");
  const [edit, setEdit] = useState<SsoProviderRecord | null | undefined>(settings ? null : undefined);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const ask = useConfirm();
  const result = useResource<ListResponse>("/security/sso");
  const items = result.data?.items;

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(done); result.reload(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  const toggle = (row: SsoProviderRecord) => run(
    () => api("/security/sso/" + row.id, { method: "PATCH", body: JSON.stringify({ version: row.version, enabled: !row.enabled }) }),
    row.enabled ? "SSO 연결을 비활성화했습니다." : "SSO 연결을 활성화했습니다.");
  const preflight = (row: SsoProviderRecord) => run(
    () => api("/security/sso/" + row.id + "/preflight", { method: "POST" }),
    "사전검사를 다시 실행했습니다.");
  const remove = async (row: SsoProviderRecord) => {
    if (!await ask({ title: "SSO 연결 삭제", message: `“${row.name}” SSO 연결을 삭제합니다. 이 설정으로는 더 이상 로그인할 수 없습니다.`, confirmLabel: "삭제" })) return;
    void run(() => api("/security/sso/" + row.id, { method: "DELETE", body: JSON.stringify({ version: row.version }) }), "SSO 연결을 삭제했습니다.");
  };

  return <>
    <PageHeading title={settings ? "SSO 연결 설정" : "SSO 연결 관리"}>
      {settings
        ? <Link className="cs-button" href="/security/sso">목록 보기</Link>
        : canManage && <ActionButton disabled={busy} onClick={() => setEdit(null)}>SSO 연결 등록</ActionButton>}
    </PageHeading>
    <p className="mg-description">OIDC 또는 SAML 공급자로 회사 구성원의 로그인을 연결합니다. 등록 후 사전검사를 통과해야 활성화할 수 있습니다.</p>
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
                <td>{row.protocol.toUpperCase()}</td>
                <td className="sso-issuer">{row.issuer}</td>
                <td><code className="sso-login-url">/api/v1/auth/sso/{row.id}?mode=login</code></td>
                <td>{row.preflightOk ? <span className="sso-ok">통과</span> : <span className="sso-fail" title={row.preflightDetail}>미통과 — {row.preflightDetail}</span>}</td>
                <td>{row.enabled ? "사용" : "사용 안 함"}</td>
                <td>{new Date(row.createdAt).toLocaleDateString("ko-KR")}</td>
                {canManage && <td><div className="mg-flex">
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
  </>;
}

function ProviderEditor({ row, onClose, onSaved }: { row: SsoProviderRecord | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [protocol, setProtocol] = useState<"oidc" | "saml">(row?.protocol ?? "oidc");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preflight, setPreflight] = useState<{ ok: boolean; detail: string } | null>(null);
  const key = useRef(crypto.randomUUID());
  const saml = protocol === "saml";

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
        await api("/security/sso/" + row.id, { method: "PATCH", body: JSON.stringify(body) });
        onSaved("SSO 연결을 수정했습니다.");
      } else {
        const body: Record<string, unknown> = {
          protocol, name: text("name"), issuer: text("issuer"), clientId: text("clientId"),
          authorizationUrl: text("authorizationUrl"),
        };
        if (text("clientSecret")) body.clientSecret = text("clientSecret");
        if (saml) body.idpCert = text("idpCert");
        else Object.assign(body, { tokenUrl: text("tokenUrl"), jwksUrl: text("jwksUrl"), scopes: text("scopes") || "openid profile email" });
        const created = await api<SsoProviderRecord & { preflight?: { ok: boolean; detail: string } }>("/security/sso",
          { method: "POST", headers: { "Idempotency-Key": key.current }, body: JSON.stringify(body) });
        if (created.preflight && !created.preflight.ok) setPreflight(created.preflight);
        else { onSaved("SSO 연결을 등록했습니다."); return; }
      }
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  return <Modal title={row ? "SSO 연결 수정" : "SSO 연결 등록"} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={e => void save(e)}>
      {error && <p role="alert">{error}</p>}
      {preflight && <p role="alert">등록은 되었으나 사전검사에 실패했습니다: {preflight.detail}. 설정을 수정한 뒤 사전검사를 다시 실행해주세요.</p>}
      <fieldset disabled={busy} className="policy-fields">
        {!row && <label>프로토콜<select className="cs-input" name="protocol" value={protocol}
          onChange={e => setProtocol(e.target.value as "oidc" | "saml")}>
          <option value="oidc">OIDC (OpenID Connect)</option><option value="saml">SAML 2.0</option>
        </select></label>}
        <label>표시 이름<input className="cs-input" name="name" required maxLength={60} defaultValue={row?.name} placeholder="예: 본사 Entra ID" /></label>
        {!row && <>
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
          {!saml && <label>스코프<input className="cs-input" name="scopes" maxLength={300} defaultValue={row.scopes} /></label>}
          <label>클라이언트 시크릿 교체 (비우면 유지)<input className="cs-input" name="clientSecret" type="password" maxLength={500} autoComplete="new-password" /></label>
          {saml && <label>IdP 서명 인증서 교체 (비우면 유지 — 교체 시 사전검사 재실행 필요)<textarea className="cs-input sso-cert" name="idpCert"
            placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"} /></label>}
        </>}
      </fieldset>
      <div className="mg-flex"><ActionButton type="submit" disabled={busy}>{row ? "저장" : "등록"}</ActionButton></div>
    </form>
  </Modal>;
}
