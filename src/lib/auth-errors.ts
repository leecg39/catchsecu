const messages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "이메일 또는 비밀번호가 올바르지 않습니다.",
  EMAIL_NOT_VERIFIED: "이메일 인증을 먼저 완료해주세요.",
  EMAIL_MISMATCH: "현재 로그인한 계정과 이메일이 다릅니다. 로그아웃 후 다시 요청해주세요.",
  INVALID_PASSWORD: "현재 비밀번호를 확인해주세요.",
  INVALID_TOKEN: "링크가 만료되었거나 이미 사용되었습니다. 다시 요청해주세요.",
  TOKEN_EXPIRED: "인증 링크가 만료되었습니다. 인증 메일을 다시 요청해주세요.",
  INVALID_CODE: "인증코드가 올바르지 않거나 만료되었습니다.",
  INVALID_OTP: "인증코드가 올바르지 않거나 만료되었습니다.",
  INVALID_TWO_FACTOR_COOKIE: "인증 시간이 만료되었습니다. 다시 로그인해주세요.",
  SESSION_EXPIRED: "세션이 만료되었습니다. 다시 로그인해주세요.",
  USER_ALREADY_EXISTS: "이미 가입된 이메일입니다. 로그인하거나 비밀번호를 재설정해주세요.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "이미 가입된 이메일입니다. 로그인하거나 비밀번호를 재설정해주세요.",
  TOO_MANY_REQUESTS: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  TOO_MANY_ATTEMPTS: "인증 시도 횟수를 초과했습니다. 잠시 후 다시 로그인해주세요.",
  OTP_HAS_EXPIRED: "인증코드가 만료되었습니다. 코드를 다시 요청해주세요.",
  TWO_FACTOR_NOT_ENABLED: "2단계 인증을 먼저 설정해주세요.",
  INVALID_CALLBACK_URL: "로그인 후 이동할 주소가 올바르지 않습니다. 로그인 화면에서 다시 시작해주세요.",
  INVALID_REDIRECT_URL: "인증 후 이동할 주소가 올바르지 않습니다. 다시 요청해주세요.",
  INVALID_ORIGIN: "요청을 확인할 수 없습니다. 현재 사이트에서 다시 시도해주세요.",
};
export function authErrorMessage(code: string | null | undefined) {
  return code && Object.hasOwn(messages, code) ? messages[code] : undefined;
}
