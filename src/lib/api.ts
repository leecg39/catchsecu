"use client";
import { useCallback, useEffect, useState } from "react";
import { authErrorMessage } from "./auth-errors";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, public requestId?: string) { super(message); }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/v1" + path, {
      ...init, credentials: "same-origin", cache: "no-store",
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch (error) {
    if (init.signal?.aborted || error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError("서버에 연결하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.", 0, "NETWORK_ERROR");
  }
  if (response.status === 204) return undefined as T;
  const value = await response.json().catch(() => ({ error: { code: "INVALID_RESPONSE", message: "서버가 올바르게 응답하지 않았습니다. 잠시 후 다시 시도해주세요." } }));
  const code = response.status === 429 ? "TOO_MANY_REQUESTS" : value.error?.code ?? value.code ?? "REQUEST_FAILED";
  if (!response.ok) throw new ApiError(authErrorMessage(code) ?? value.error?.message ?? value.message ?? "요청을 처리하지 못했습니다.",
    response.status, code, value.error?.requestId);
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
