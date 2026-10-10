"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GuardedLink as Link, useUnsavedChanges } from "../ux/navigation-guard";
import { OrgDirectory } from "./OrgDirectory";
import { api, ApiError, errorText, useResource } from "@/lib/api";
import type { SsoProviderRecord } from "@/contracts/sso";
import { useApplication } from "../ApplicationContext";
import { ActionButton, EmptyState, Modal, PageHeading, Panel } from "../shared";
import { useConfirm } from "../ux/confirm";

type ListResponse = { tenantId: string; items: SsoProviderRecord[]; canManage: boolean };
const VIRTUAL_PROTOCOLS = new Set(["gpki", "saeol", "groupware"]);
const isVirtual = (protocol: string) => VIRTUAL_PROTOCOLS.has(protocol);
const PROTOCOL_LABELS: Record<string, string> = { oidc: "OIDC", saml: "SAML 2.0", gpki: "가상 GPKI", saeol: "가상 새올", groupware: "가상 그룹웨어" };
const ORG_LOGIN_PATHS: Record<string, string> = { gpki: "/login/gpki", saeol: "/login/saeol", groupware: "/gwloginUser/login" };

export function SsoProviders({ settings = false }: { settings?: boolean }) {
  const app = useApplication();
  return <SsoContent key={(app.data?.company?.id ?? "none") + ":" + (app.data?.capabilities ?? []).join(",")} settings={settings} companyId={app.data?.company?.id} />;
}

function SsoContent({ settings, companyId }: { settings: boolean; companyId?: string }) {
  const router = useRouter();
  const [edit, setEdit] = useState<SsoProviderRecord | null | undefined>();
  const [directory, setDirectory] = useState<SsoProviderRecord | undefined>();
  const [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const ask = useConfirm();
  const result = useResource<ListResponse>(companyId ? "/security/sso" : null);
  const companyMismatch = !!result.data && result.data.tenantId !== companyId;
  const items = result.data?.items, canManage = !companyMismatch && result.data?.canManage === true;
  useUnsavedChanges(busy, "SSO 변경 요청을 처리 중입니다. 아직 처리 결과가 확정되지 않았습니다. 이 화면을 나가면 목록에서 결과를 다시 확인해야 합니다.");
  const lock = useRef(false);
  const [search, setSearch] = useState(""), [sort, setSort] = useState("createdAt"), [page, setPage] = useState(1);
  const rows = (items ?? []).filter(row => `${row.name} ${row.issuer} ${PROTOCOL_LABELS[row.protocol]}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(rows.length / 10)), currentPage = Math.min(page, pages);

  async function run(action: () => Promise<unknown>, done: string) {
    if (lock.current) return; lock.current = true;
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(done); result.reload(); }
    catch (cause) { setError(errorText(cause)); if (cause instanceof ApiError && cause.code === "SSO_REAUTH_REQUIRED") setReauth(true); result.reload(); }
    finally { lock.current = false; setBusy(false); }
  }
  const toggle = async (row: SsoProviderRecord) => {
    if (row.enabled && !await ask({ title: "SSO 사용 중지", message: `“${row.name}”의 새 로그인과 진행 중 인증이 중지됩니다. 이미 로그인한 기기는 유지됩니다. 다른 로그인 수단이 없는 활성 구성원이 있으면 중지할 수 없습니다.`, confirmLabel: "사용 중지" })) return;
    await run(() => api("/security/sso/" + row.id, { method: "PATCH", body: JSON.stringify({ tenantId: companyId, version: row.version, enabled: !row.enabled }) }),
      row.enabled ? "새 SSO 로그인을 중지했습니다. 기존 로그인은 유지됩니다." : "SSO 연결을 활성화했습니다.");
  };
  const preflight = (row: SsoProviderRecord) => run(
    () => api("/security/sso/" + row.id + "/preflight", { method: "POST" }),
    "사전검사를 다시 실행했습니다.");
  const remove = async (row: SsoProviderRecord) => {
    if (!await ask({ title: "SSO 연결 삭제", message: `“${row.name}” SSO 설정과 연결 계정을 삭제하고, 연결된 구성원의 모든 기기 로그인을 종료합니다. 다른 로그인 수단이 없는 활성 구성원이 있으면 삭제할 수 없습니다.`, confirmLabel: "삭제" })) return;
    void run(async () => {
      const removed = await api<{ signedOut: boolean }>("/security/sso/" + row.id, { method: "DELETE", body: JSON.stringify({ version: row.version }) });
      if (removed.signedOut) { router.replace("/login"); router.refresh(); }
    }, "SSO 설정과 연결 계정을 삭제하고 관련 로그인을 종료했습니다.");
  };

  return <div className="sso-providers">
    {reauth && <p className="mg-description"><Link href="/login?returnTo=%2Fsecurity%2Fsso%2Fproviders">다시 로그인한 뒤 SSO 설정으로 돌아가기</Link></p>}
    <PageHeading title={settings ? "SSO 연결 설정" : "SSO 연결 관리"}>
      <div className="mg-flex"><Link className="cs-button secondary" href="/security/sso">로그인 정책</Link>
        {canManage && <ActionButton disabled={busy} onClick={() => setEdit(null)}>SSO 연결 등록</ActionButton>}</div>
    </PageHeading>
    <p className="mg-description">OIDC 또는 SAML 공급자로 회사 구성원의 로그인을 연결합니다. 등록 후 사전검사를 통과해야 활성화할 수 있습니다. 사용 중지·인증 정보 교체는 새 로그인과 진행 중 인증에 적용되며 기존 로그인은 유지됩니다.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {result.error
      ? <Panel><p role="alert">{result.error.message}</p><ActionButton secondary onClick={result.reload}>다시 불러오기</ActionButton></Panel>
      : companyMismatch ? <Panel><p role="alert">다른 탭에서 선택한 회사가 변경되었습니다. 회사와 SSO 목록을 함께 다시 불러온 뒤 진행해주세요.</p><ActionButton secondary onClick={() => window.location.reload()}>회사와 목록 다시 불러오기</ActionButton></Panel>
      : !items ? <Panel><p role="status">SSO 설정을 불러오는 중입니다.</p></Panel>
      : <Panel>
        <div className="mg-flex"><label>SSO 연결 검색<input className="cs-input" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="이름·프로토콜·Issuer" /></label>
          <label>SSO 연결 정렬<select className="cs-input" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="createdAt">등록일순</option><option value="name">이름순</option></select></label></div>
        {!canManage && <p role="status">회사에 직접 소속된 최상위 관리자만 연결을 변경할 수 있습니다.</p>}
        {rows.length
          ? <div className="cs-table-wrap" role="region" aria-label="SSO 연결 목록" tabIndex={0}><table className="cs-table sso-provider-table"><thead><tr>
              <th>이름</th><th>프로토콜</th><th>Issuer</th><th>로그인 주소</th><th>사전검사</th><th>사용 상태</th><th>등록일</th><th>관리</th>
            </tr></thead><tbody>
              {rows.slice((currentPage - 1) * 10, currentPage * 10).map(row => <tr key={row.id}>
                <td>{row.name}</td>
                <td>{PROTOCOL_LABELS[row.protocol] ?? row.protocol.toUpperCase()}</td>
                <td className="sso-issuer">{row.issuer}</td>
                <td><code className="sso-login-url">{isVirtual(row.protocol) ? ORG_LOGIN_PATHS[row.protocol] : `/api/v1/auth/sso/${row.id}?mode=login`}</code></td>
                <td>{row.preflightOk ? <span className="sso-ok">통과</span> : <span className="sso-fail" title={row.preflightDetail}>미통과 — {row.preflightDetail}</span>}</td>
                <td>{row.enabled ? "사용" : "사용 안 함"}</td>
                <td>{new Date(row.createdAt).toLocaleDateString("ko-KR")}</td>
                <td><div className="mg-flex">
                  {isVirtual(row.protocol) && <ActionButton secondary disabled={busy} onClick={() => setDirectory(row)}>디렉터리</ActionButton>}
                  {canManage && <><ActionButton secondary disabled={busy} onClick={() => void preflight(row)}>사전검사</ActionButton>
                  <ActionButton secondary disabled={busy || (!row.enabled && !row.preflightOk)}
                    title={!row.enabled && !row.preflightOk ? "사전검사를 먼저 통과해야 합니다" : undefined}
                    onClick={() => void toggle(row)}>{row.enabled ? "사용 안 함" : "사용"}</ActionButton>
                  <ActionButton secondary disabled={busy} onClick={() => setEdit(row)}>수정</ActionButton>
                  <ActionButton secondary disabled={busy} onClick={() => void remove(row)}>삭제</ActionButton></>}
                </div></td>
              </tr>)}
            </tbody></table></div>
          : <EmptyState text={search ? "검색 결과가 없습니다." : "등록한 SSO 연결이 없습니다."} />}
        <div className="cs-pagination"><span>총 {rows.length}개 · {currentPage}/{pages}쪽</span><div><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>이전</button><button disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>다음</button></div></div></Panel>}
    {edit !== undefined && canManage && companyId && <ProviderEditor key={edit?.id ?? "new"} row={edit} tenantId={companyId}
      onClose={() => { setEdit(undefined); result.reload(); }} onSaved={m => { setEdit(undefined); setNotice(m); result.reload(); }} />}
    {directory && !companyMismatch && <OrgDirectory key={directory.id} provider={directory} onClose={() => setDirectory(undefined)} />}
  </div>;
}

function ProviderEditor({ row: initialRow, tenantId, onClose, onSaved }: { row: SsoProviderRecord | null; tenantId: string; onClose: () => void; onSaved: (message: string) => void }) {
  const [row, setRow] = useState(initialRow);
  const [protocol, setProtocol] = useState<SsoProviderRecord["protocol"]>(initialRow?.protocol ?? "oidc");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const attempt = useRef<{ body: string; key: string } | null>(null), lock = useRef(false), ask = useConfirm();
  const [dirty, setDirty] = useState(false), [conflict, setConflict] = useState(false);
  const [companyChanged, setCompanyChanged] = useState(false), [revision, setRevision] = useState(0);
  useUnsavedChanges(dirty || busy);
  async function close() {
    if (lock.current) return;
    if (!dirty || await ask({ title: "저장하지 않은 변경", message: "입력한 내용을 버리고 닫을까요?", confirmLabel: "변경 버리기" })) onClose();
  }
  async function latest() {
    if (lock.current || !row) return; lock.current = true; setBusy(true); setError("");
    try {
      if (dirty && !await ask({ title: "최신 SSO 설정 불러오기", message: "현재 입력한 이름·시크릿·인증서를 버리고 최신 설정을 불러올까요?", confirmLabel: "입력 버리고 불러오기", cancelLabel: "계속 편집" })) return;
      const data = await api<ListResponse>("/security/sso");
      if (data.tenantId !== tenantId) { setCompanyChanged(true); throw new Error("선택한 회사가 변경되었습니다. 입력은 유지했습니다. 회사와 목록을 다시 불러와주세요."); }
      if (!data.canManage) throw new Error("수정 권한이 변경되었습니다. 입력을 복사한 뒤 목록으로 돌아가주세요.");
      const current = data.items.find(item => item.id === row.id);
      if (!current) throw new Error("이 SSO 연결은 이미 삭제되었습니다. 입력을 복사한 뒤 목록으로 돌아가주세요.");
      setRow(current); setRevision(value => value + 1); setConflict(false); setDirty(false); attempt.current = null;
    } catch (cause) { setError(errorText(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  const saml = protocol === "saml", virtual = isVirtual(protocol), readOnly = conflict || companyChanged;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || conflict || companyChanged) return; lock.current = true;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true); setError("");
    try {
      if (row) {
        const body: Record<string, unknown> = { tenantId, version: row.version, name: text("name") };
        if (text("scopes")) body.scopes = text("scopes");
        if (text("clientSecret")) body.clientSecret = text("clientSecret");
        if (text("idpCert")) body.idpCert = text("idpCert");
        const saved = await api<SsoProviderRecord>("/security/sso/" + row.id, { method: "PATCH", body: JSON.stringify(body) });
        onSaved(saved.preflightOk ? "SSO 연결을 수정했습니다."
          : "SSO 연결을 수정했습니다. 사전검사를 통과한 뒤 사용을 활성화해주세요.");
      } else {
        const body: Record<string, unknown> = virtual
          ? { tenantId, protocol, name: text("name") }
          : { tenantId, protocol, name: text("name"), issuer: text("issuer"), clientId: text("clientId"),
            authorizationUrl: text("authorizationUrl") };
        if (text("clientSecret")) body.clientSecret = text("clientSecret");
        if (saml) body.idpCert = text("idpCert");
        else if (!virtual) Object.assign(body, { tokenUrl: text("tokenUrl"), jwksUrl: text("jwksUrl"), scopes: text("scopes") || "openid profile email" });
        const serialized = JSON.stringify(body);
        if (!attempt.current || attempt.current.body !== serialized) attempt.current = { body: serialized, key: crypto.randomUUID() };
        const created = await api<SsoProviderRecord & { preflight?: { ok: boolean; detail: string } }>("/security/sso",
          { method: "POST", headers: { "Idempotency-Key": attempt.current.key }, body: serialized });
        onSaved(created.preflight && !created.preflight.ok
          ? "SSO 연결은 등록되었으나 사전검사에 실패했습니다: " + created.preflight.detail + ". 목록에서 설정을 확인하고 다시 검사해주세요."
          : "SSO 연결을 등록했습니다.");
      }
    } catch (cause) { setError(errorText(cause)); if (cause instanceof ApiError) {
      if (["VERSION_CONFLICT", "CONCURRENT_CHANGE"].includes(cause.code)) setConflict(true);
      if (cause.code === "COMPANY_CHANGED") setCompanyChanged(true);
    } }
    finally { lock.current = false; setBusy(false); }
  }

  return <Modal title={row ? "SSO 연결 수정" : "SSO 연결 등록"} onClose={() => void close()}>
    <form className="sso-provider-form" key={(row?.version ?? "new") + ":" + revision} onSubmit={e => void save(e)} onChange={() => setDirty(true)}>
      {error && <p role="alert">{error}</p>}
      {companyChanged && <p role="alert">입력은 유지했습니다. 필요한 내용을 복사한 뒤 회사와 목록을 다시 불러와주세요. <ActionButton secondary disabled={busy} onClick={() => window.location.reload()}>회사와 목록 다시 불러오기</ActionButton></p>}
      {row && <p className="mg-description">인증서·시크릿·스코프를 변경하면 새 로그인과 진행 중 인증이 중지됩니다. 기존 로그인은 유지됩니다. 활성 구성원의 다른 로그인 수단을 먼저 준비하고, 저장 후 사전검사를 통과해 사용을 다시 활성화해주세요.</p>}
      {conflict && <div role="alert"><p>다른 곳에서 수정됐습니다. 현재 입력을 복사한 뒤 최신 내용으로 다시 편집해주세요.</p><ActionButton secondary disabled={busy} onClick={() => void latest()}>최신 내용 불러오기</ActionButton></div>}
      <fieldset disabled={busy} className="policy-fields">
        {!row && <label>프로토콜<select disabled={readOnly} className="cs-input" name="protocol" value={protocol}
          onChange={e => setProtocol(e.target.value as SsoProviderRecord["protocol"])}>
          <option value="oidc">OIDC (OpenID Connect)</option><option value="saml">SAML 2.0</option>
          <option value="gpki">가상 GPKI (mock 디렉터리)</option>
          <option value="saeol">가상 새올 (mock 디렉터리)</option>
          <option value="groupware">가상 그룹웨어 (mock 디렉터리)</option>
        </select></label>}
        {virtual && <p className="mg-description">가상 어댑터 — 외부 기관 미연동. 등록 후 목록의 “디렉터리”에서 mock 구성원을 추가해야 로그인이 동작합니다.</p>}
        <label>표시 이름<input readOnly={readOnly} className="cs-input" name="name" required maxLength={60} defaultValue={row?.name} placeholder="예: 본사 Entra ID" /></label>
        {!row && !virtual && <>
          <label>Issuer<input readOnly={readOnly} className="cs-input" name="issuer" required maxLength={500}
            placeholder={saml ? "IdP 엔터티 ID (예: https://idp.example.com/metadata)" : "https://idp.example.com"} /></label>
          <label>클라이언트 ID<input readOnly={readOnly} className="cs-input" name="clientId" required maxLength={300}
            placeholder={saml ? "SP 엔터티 ID" : "애플리케이션 클라이언트 ID"} /></label>
          <label>{saml ? "IdP SSO 주소 (HTTP-POST)" : "인가 엔드포인트 (authorization URL)"}
            <input readOnly={readOnly} className="cs-input" name="authorizationUrl" required maxLength={500}
              placeholder={saml ? "https://idp.example.com/sso" : "https://idp.example.com/authorize"} /></label>
          <label>클라이언트 시크릿{saml && " (없으면 비움)"}<input readOnly={readOnly} className="cs-input" name="clientSecret" type="password" maxLength={500} autoComplete="new-password" /></label>
          {saml
            ? <label>IdP 서명 인증서 (PEM)<textarea readOnly={readOnly} className="cs-input sso-cert" name="idpCert" required
                placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"} /></label>
            : <>
                <label>토큰 엔드포인트<input readOnly={readOnly} className="cs-input" name="tokenUrl" required maxLength={500} placeholder="https://idp.example.com/token" /></label>
                <label>JWKS 주소<input readOnly={readOnly} className="cs-input" name="jwksUrl" required maxLength={500} placeholder="https://idp.example.com/jwks.json" /></label>
              </>}
        </>}
        {row && <>
          {!saml && !virtual && <label>스코프<input readOnly={readOnly} className="cs-input" name="scopes" maxLength={300} defaultValue={row.scopes} /></label>}
          {!virtual && <label>클라이언트 시크릿 교체 (비우면 유지)<input readOnly={readOnly} className="cs-input" name="clientSecret" type="password" maxLength={500} autoComplete="new-password" /></label>}
          {saml && <label>IdP 서명 인증서 교체 (비우면 유지 — 교체 시 사전검사 재실행 필요)<textarea readOnly={readOnly} className="cs-input sso-cert" name="idpCert"
            placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"} /></label>}
        </>}
      </fieldset>
      <div className="mg-flex"><ActionButton type="submit" disabled={busy || conflict || companyChanged || (row !== null && !dirty)}>{row ? "저장" : "등록"}</ActionButton></div>
    </form>
  </Modal>;
}
