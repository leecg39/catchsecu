"use client";
import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, public requestId?: string) { super(message); }
}
const authMessages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "이메일 또는 비밀번호가 올바르지 않습니다.",
  EMAIL_NOT_VERIFIED: "이메일 인증을 먼저 완료해주세요.",
  INVALID_PASSWORD: "현재 비밀번호를 확인해주세요.",
  INVALID_TOKEN: "링크가 만료되었거나 이미 사용되었습니다. 다시 요청해주세요.",
  INVALID_CODE: "인증코드가 올바르지 않거나 만료되었습니다.",
  INVALID_OTP: "인증코드가 올바르지 않거나 만료되었습니다.",
  INVALID_TWO_FACTOR_COOKIE: "인증 시간이 만료되었습니다. 다시 로그인해주세요.",
  USER_ALREADY_EXISTS: "이미 가입된 이메일입니다. 로그인하거나 비밀번호를 재설정해주세요.",
  TOO_MANY_REQUESTS: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
};
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    ...init, credentials: "same-origin", cache: "no-store",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  if (response.status === 204) return undefined as T;
  const value = await response.json().catch(() => ({ error: { code: "INVALID_RESPONSE", message: "서버가 올바르게 응답하지 않았습니다. 잠시 후 다시 시도해주세요." } }));
  if (!response.ok) throw new ApiError(authMessages[value.code] ?? value.error?.message ?? value.message ?? "요청을 처리하지 못했습니다.",
    response.status, value.error?.code ?? value.code ?? "REQUEST_FAILED", value.error?.requestId);
  return value as T;
}
export function useResource<T>(path: string | null) {
  const [state, setState] = useState<{ path?: string; data?: T; error?: ApiError }>({});
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => { setState({}); setRevision(value => value + 1); }, []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal })
      .then(data => setState({ path, data }))
      .catch(error => { if (error.name !== "AbortError") setState({ path, error }); });
    return () => controller.abort();
  }, [path, revision]);
  const current = state.path === path ? state : {};
  return { ...current, loading: !!path && !current.data && !current.error, reload };
}
export function errorText(error: unknown) { return error instanceof Error ? error.message : "요청을 처리하지 못했습니다."; }
