const failures = {
  SSO_CANCELLED: { message: "회사 계정 로그인이 취소되었거나 거절되었습니다.", help: "로그인하려면 회사 SSO 주소로 다시 시작해주세요.", action: "restart" },
  SSO_EXPIRED: { message: "회사 로그인 요청이 만료되었거나 이미 사용되었습니다.", help: "이전 인증 응답을 새로고침하지 말고 새 로그인을 시작해주세요.", action: "restart" },
  SSO_CHANGED: { message: "회사 로그인 설정이 변경되었습니다.", help: "새 설정으로 다시 시작해주세요. 문제가 계속되면 회사 관리자에게 문의해주세요.", action: "restart" },
  SSO_LINK_NEEDED: { message: "기존 계정의 확인이 필요합니다.", help: "기존 이메일 계정으로 로그인한 뒤 내 SSO 연결 관리에서 회사 계정을 연결해주세요. 초대받은 회사라면 받은 초대 링크를 다시 열어 먼저 수락해주세요.", action: "login" },
  SSO_LINK_CONFLICT: { message: "이 회사 계정은 이미 다른 사용자에게 연결되어 있습니다.", help: "연결할 계정을 확인하고 회사 관리자에게 문의해주세요.", action: "contact" },
  SSO_INVITATION: { message: "초대를 사용할 수 없습니다.", help: "회사 관리자에게 새 초대를 요청하고 새 초대 주소에서 가입을 시작해주세요.", action: "contact" },
  SSO_ACCESS: { message: "이 계정으로 회사에 접근할 수 없습니다.", help: "회사 소속과 계정 상태를 관리자에게 확인해주세요.", action: "contact" },
  SSO_UNAVAILABLE: { message: "회사 로그인 서비스를 사용할 수 없습니다.", help: "잠시 후 다시 시도해주세요. 문제가 계속되면 회사 관리자에게 문의해주세요.", action: "restart" },
  SSO_LIMITED: { message: "로그인 요청이 너무 많습니다.", help: "잠시 기다린 뒤 회사 SSO 주소로 다시 시작해주세요.", action: "restart" },
  SSO_FAILED: { message: "회사 인증을 완료하지 못했습니다.", help: "회사에서 받은 SSO 주소로 다시 시작해주세요. 문제가 계속되면 회사 관리자에게 문의해주세요.", action: "restart" },
} as const;
export type SsoFailureCode = keyof typeof failures;
export function ssoFailure(code: string | null | undefined) {
  return code && Object.hasOwn(failures, code) ? failures[code as SsoFailureCode] : undefined;
}

const codes: Record<string, SsoFailureCode> = {
  PROVIDER_DENIED: "SSO_CANCELLED", STATE_INVALID: "SSO_EXPIRED", STATE_REPLAYED: "SSO_EXPIRED",
  TOKEN_EXPIRED: "SSO_EXPIRED", SSO_CONFIGURATION_CHANGED: "SSO_CHANGED",
  SSO_REAUTH_REQUIRED: "SSO_LINK_NEEDED", SSO_LINK_REQUIRED: "SSO_LINK_NEEDED", LINK_SESSION_REQUIRED: "SSO_LINK_NEEDED", SESSION_EXPIRED: "SSO_LINK_NEEDED",
  SSO_ACCOUNT_ALREADY_LINKED: "SSO_LINK_CONFLICT", INVITATION_UNAVAILABLE: "SSO_INVITATION",
  INVITATION_REQUIRED: "SSO_INVITATION", INVITER_UNAVAILABLE: "SSO_INVITATION",
  SSO_MEMBERSHIP_REQUIRED: "SSO_ACCESS", NOT_A_MEMBER: "SSO_ACCESS", ACCOUNT_DISABLED: "SSO_ACCESS",
  COMPANY_UNAVAILABLE: "SSO_ACCESS", FORBIDDEN: "SSO_ACCESS", IP_NOT_ALLOWED: "SSO_ACCESS",
  NOT_FOUND: "SSO_UNAVAILABLE", JWKS_UNAVAILABLE: "SSO_UNAVAILABLE", TOKEN_EXCHANGE_FAILED: "SSO_UNAVAILABLE",
  RATE_LIMITED: "SSO_LIMITED",
};
export function ssoFailureCode(code: unknown): SsoFailureCode {
  return typeof code === "string" && Object.hasOwn(codes, code) ? codes[code] : "SSO_FAILED";
}

/** Accept only a company login URL on this installation; discard all untrusted query fields. */
export function ssoLoginPath(value: string, origin: string): string | null {
  const trimmed = value.trim();
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (new RegExp(`^${uuid}$`, "i").test(trimmed)) return `/api/v1/auth/sso/${trimmed}?mode=login`;
  try {
    if (/[\\\x00-\x20]/.test(trimmed) || trimmed.startsWith("//")) return null;
    const url = new URL(trimmed, origin);
    if (url.origin !== origin || url.username || url.password || url.hash) return null;
    if (!new RegExp(`^/api/v1/auth/sso/(${uuid})$`, "i").test(url.pathname)) return null;
    // Invitation and linking must keep their original, explicitly supplied flow.
    if (url.searchParams.has("invitation") || url.searchParams.getAll("mode").some(mode => mode !== "login")) return null;
    return `${url.pathname}?mode=login`;
  } catch { return null; }
}
