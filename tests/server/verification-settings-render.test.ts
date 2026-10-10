import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { VerificationState } from "@/contracts/verification";

const resource = vi.hoisted(() => ({ data: null as VerificationState | null, error: null as { message: string } | null }));
vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  ApiError: class extends Error { status = 409; },
  errorText: String,
  useResource: () => ({ data: resource.data, error: resource.error, loading: false, reload: vi.fn() }),
}));
vi.mock("@/components/ux/confirm", () => ({ useConfirm: () => vi.fn() }));

import { VerificationSettings } from "@/components/forms/VerificationSettings";

const serviceId = "10000000-0000-4000-8000-000000000001";
const timestamp = "2026-10-10T00:00:00.000Z";
function state(overrides: Partial<VerificationState["readiness"]> = {}, canManage = true): VerificationState {
  return {
    integration: {
      id: "10000000-0000-4000-8000-000000000002",
      identityProvider: "local",
      signatureProvider: "local",
      environment: "sandbox",
      status: "enabled",
      version: 4,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    readiness: {
      ready: true,
      reason: "READY",
      message: "local sandbox 공급자가 사용 중입니다. 본인인증 폼을 게시할 수 있습니다.",
      sandboxVerified: false,
      ...overrides,
    },
    permissions: { canManage },
    history: [{
      version: 4,
      identityProvider: "local",
      signatureProvider: "local",
      environment: "sandbox",
      status: "enabled",
      createdAt: timestamp,
    }],
  };
}
function render() {
  return renderToStaticMarkup(createElement(VerificationSettings, { serviceId }));
}
beforeEach(() => { resource.data = state(); resource.error = null; });

test("enabled history and an unverified local sandbox remain visibly distinct from official provider verification", () => {
  const html = render();
  expect(html).toContain("성공한 테스트 인증 흐름은 아직 없습니다");
  expect(html).toContain("v4 · 사용");
  expect(html).not.toContain("v4 · 연결 대기");
  expect(html).toContain("외부 공급자와 운영 환경은 아직 전환할 수 없습니다");
});

test("a completed sandbox flow is reported while external and production verification remain pending", () => {
  resource.data = state({ sandboxVerified: true });
  const html = render();
  expect(html).toContain("local sandbox 테스트 인증 흐름을 확인했습니다");
  expect(html).toContain("외부 공급자 공식 검증과 운영 환경 연동은 별도로 필요합니다");
  expect(html).not.toContain("성공한 테스트 인증 흐름은 아직 없습니다");
});

test("read-only users see provider readiness without configuration controls", () => {
  resource.data = state({ sandboxVerified: true }, false);
  const html = render();
  expect(html).toContain("회사 관리자에게 연동 설정을 요청해주세요");
  expect(html).not.toContain("연동 설정 저장");
  expect(html).not.toContain("연동 설정 삭제");
});

test("provider readiness errors hide stale configuration content and offer a retry", () => {
  resource.error = { message: "현재 권한으로 연동 설정을 조회할 수 없습니다." };
  const html = render();
  expect(html).toContain("현재 권한으로 연동 설정을 조회할 수 없습니다");
  expect(html).toContain("설정 다시 불러오기");
  expect(html).not.toContain("local sandbox 공급자가 사용 중입니다");
});
