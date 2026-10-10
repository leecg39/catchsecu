import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import apiOwnership from "../../docs/planning/09-rea-fullstack/api-ownership.json";
import openapi from "../../docs/planning/contracts/openapi.json";

const routeFiles: Record<string, string> = {
  "/members": "src/app/api/v1/members/route.ts",
  "/members/{id}": "src/app/api/v1/members/[...segments]/route.ts",
  "/members/{id}/transfer": "src/app/api/v1/members/[...segments]/route.ts",
  "/invitations": "src/app/api/v1/invitations/route.ts",
  "/invitations/{id}": "src/app/api/v1/invitations/[...segments]/route.ts",
  "/invitations/{id}/resend": "src/app/api/v1/invitations/[...segments]/route.ts",
  "/invitations/preview": "src/app/api/v1/invitations/[...segments]/route.ts",
  "/invitations/accept": "src/app/api/v1/invitations/[...segments]/route.ts",
  "/invitations/sso/options": "src/app/api/v1/invitations/sso/options/route.ts",
  "/invitations/sso/start": "src/app/api/v1/invitations/sso/start/route.ts",
  "/access-requests": "src/app/api/v1/access-requests/route.ts",
  "/access-requests/{id}": "src/app/api/v1/access-requests/[id]/route.ts",
  "/expert-assignments": "src/app/api/v1/expert-assignments/route.ts",
  "/expert-assignments/{id}": "src/app/api/v1/expert-assignments/[id]/route.ts",
  "/expert-assignments/options": "src/app/api/v1/expert-assignments/options/route.ts",
};

type Operation = {
  "x-implementation"?: string;
  "x-permission"?: string;
  "x-contract-policy"?: string;
};

const owned = apiOwnership.filter(row => row.owner_tasks.includes("R04-T02"));

test("R04-T02가 소유한 OpenAPI 23개 작업은 구현·권한·정책을 선언한다", () => {
  expect(owned).toHaveLength(23);
  for (const row of owned) {
    const operation = (openapi.paths[row.path as keyof typeof openapi.paths] as Record<string, Operation>)[row.method.toLowerCase()];
    expect(operation, `${row.method} ${row.path}`).toBeDefined();
    expect(operation["x-implementation"], `${row.method} ${row.path}`).toBe("implemented");
    expect(operation["x-permission"], `${row.method} ${row.path}`).toBeTruthy();
    expect(operation["x-contract-policy"], `${row.method} ${row.path}`).toBeTruthy();
  }
});

test("R04-T02 OpenAPI 작업은 실제 Route Handler의 HTTP export에 연결된다", async () => {
  const sources = new Map<string, string>();
  for (const path of new Set(owned.map(row => routeFiles[row.path]))) {
    expect(path).toBeTruthy();
    sources.set(path, await readFile(path, "utf8"));
  }
  for (const row of owned) {
    const file = routeFiles[row.path];
    expect(sources.get(file), `${row.method} ${row.path} -> ${file}`).toContain(`export const ${row.method}`);
  }
});

test("초대 SSO 작업은 R07 공급자 검증과 공유하고 R04의 내부 초대 경계에 남는다", () => {
  for (const path of ["/invitations/sso/options", "/invitations/sso/start"]) {
    const row = owned.find(item => item.path === path);
    expect(row?.owner_tasks).toEqual(expect.arrayContaining(["R04-T02", "R07-T02"]));
  }
});
