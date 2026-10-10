import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const spec = JSON.parse(readFileSync("docs/planning/contracts/openapi.json", "utf8")) as {
  paths: Record<string, Record<string, { summary: string; "x-implementation": string;
    requestBody?: { content: { "application/json": { schema: { required?: string[]; properties?: Record<string, unknown> } } } } }>>;
  components: { schemas: Record<string, { required: string[]; properties: Record<string, unknown> }> };
};

test("OpenAPI는 서비스 템플릿 보관·복원 전이와 버전 계약을 공개한다", () => {
  for (const action of ["archive", "restore"]) {
    const operation = spec.paths[`/templates/{id}/${action}`].post;
    expect(operation["x-implementation"]).toBe("implemented");
    expect(operation.requestBody?.content["application/json"].schema.required).toContain("version");
    expect(operation.summary).toContain(action === "archive" ? "보관" : "복원");
  }
});

test("템플릿 응답은 상태와 모든 상태별 동작을 명시한다", () => {
  const record = spec.components.schemas.TemplateRead, actions = spec.components.schemas.TemplateReadActions;
  expect(record.required).toContain("status");
  expect(record.properties.status).toEqual({ enum: ["active", "archived"] });
  expect(actions.required).toEqual(["preview", "use", "edit", "archive", "restore", "remove"]);
  for (const action of actions.required) expect(actions.properties[action]).toEqual({ type: "boolean" });
});
