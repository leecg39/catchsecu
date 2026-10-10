import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";
const spec = JSON.parse(readFileSync("docs/planning/contracts/openapi.json", "utf8"));
const groups = ["security/sso", "auth/sso", "auth/org", "me/sso-accounts", "invitations/sso"];
function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? routes(join(dir, item.name)) : item.name === "route.ts" ? [join(dir, item.name)] : []);
}
test("SSO 계약: 실제 Route Handler 19개 작업과 선언된 경로/메서드가 일치", () => {
  const actual: string[] = [];
  for (const group of groups) for (const file of routes("src/app/api/v1/" + group)) {
    const path = "/" + relative("src/app/api/v1", file).replace(/\/route\.ts$/, "").replace(/\[([^\]]+)\]/g, "{$1}");
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!ts.isVariableStatement(node) || !node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const declaration of node.declarationList.declarations) {
        const method = declaration.name.getText(source);
        if (["GET", "POST", "PATCH", "DELETE", "PUT"].includes(method)) actual.push(method + " " + path);
      }
    }
  }
  const declared: string[] = [];
  for (const [path, item] of Object.entries(spec.paths)) if (groups.some(group => path === "/" + group || path.startsWith("/" + group + "/"))) {
    for (const method of ["get", "post", "patch", "delete", "put"]) if ((item as Record<string, unknown>)[method]) declared.push(method.toUpperCase() + " " + path);
  }
  expect(actual).toHaveLength(19); expect(declared.sort()).toEqual(actual.sort());
  expect(spec.paths["/identity-providers"]).toBeUndefined();
  expect(spec.paths["/identity-providers/{id}"]).toBeUndefined();
});
test("SSO 계약: 리디렉션 성공과 문서 실패, 공개 시작과 연결 재인증 조건 명시", () => {
  for (const [path, method] of [["/auth/sso/{providerId}", "get"], ["/auth/sso/callback", "get"], ["/auth/sso/saml", "post"]]) {
    const operation = spec.paths[path][method];
    expect(operation.responses["302"].headers.Location.required).toBe(true);
    expect(operation.responses["200"]).toBeUndefined();
    expect(operation.responses["303"]).toBeDefined();
    expect(new RegExp(operation.responses["303"].headers.Location.schema.pattern).test("/login?error=SSO_FAILED")).toBe(true);
    expect(operation.security).toEqual([]);
  }
  const start = spec.paths["/auth/sso/{providerId}"].get;
  expect(start.parameters.find((p: { name: string }) => p.name === "mode").schema.enum).toEqual(["login", "link"]);
  expect(start["x-permission"]).toContain("5 minutes");
});
test("SSO 계약: SAML 폼/서명 조건과 초대 POST의 Origin 조건을 구분", () => {
  const saml = spec.paths["/auth/sso/saml"].post;
  expect(saml.requestBody.content["application/x-www-form-urlencoded"].schema.required).toEqual(["SAMLResponse", "RelayState"]);
  expect(saml["x-origin-check"]).toContain("signed SAML");
  for (const path of ["/invitations/sso/options", "/invitations/sso/start"]) {
    const operation = spec.paths[path].post;
    expect(operation.security).toEqual([]);
    expect(operation["x-origin-check"]).toBe("exact configured application Origin");
    expect(operation.requestBody.content["application/json"].schema.properties.token.pattern).toBe("^[A-Za-z0-9_-]{43}$");
  }
  expect(spec.paths["/security/sso/{id}/preflight"].post.requestBody).toBeUndefined();
});
test("SSO 계약: 관리 응답과 계정 목록은 비밀 필드 미포함", () => {
  const provider = spec.paths["/security/sso"].post.responses["201"].content["application/json"].schema;
  expect(provider.additionalProperties).toBe(false);
  expect(provider.required).toContain("preflight");
  expect(provider.properties.preflight.required).toEqual(["ok", "detail"]);
  for (const secret of ["clientSecret", "clientSecretCipher", "idpCert", "tokenHash", "verifierCipher"]) expect(provider.properties[secret]).toBeUndefined();
  const account = spec.paths["/me/sso-accounts"].get.responses["200"].content["application/json"].schema.properties.items.items;
  expect(Object.keys(account.properties).sort()).toEqual(["canUnlink", "createdAt", "id", "providerId", "updatedAt"]);
});

 test("SSO 계약: 이메일 소유 확인 번호는 필수이며 발급 응답에 비밀이 없다", () => {
  const request = spec.paths["/auth/org/email-register"].post.requestBody.content["application/json"].schema;
  expect(request.required.sort()).toEqual(["challengeId", "code", "email", "ticket"]);
  expect(request.additionalProperties).toBe(false);
  const issue = spec.paths["/auth/org/email-register/challenge"].post;
  expect(issue["x-origin-check"]).toBe("exact configured application Origin");
  const response = issue.responses["200"].content["application/json"].schema;
  expect(response.required.sort()).toEqual(["challengeId", "expiresAt", "retryAt"]);
  expect(response.properties.code).toBeUndefined();
});
