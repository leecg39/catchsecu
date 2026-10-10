import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { authorAssetUploadInput, authorAssetReadScopeSchema, authorAssetMimeSchema } from "@/contracts/author-assets";
import { questionMaterialsSchema } from "@/contracts/question-materials";
import { optionDefinitionSchema } from "@/contracts/questions";
import { auditResources } from "@/server/audit-resources";
import type { Transaction } from "@/server/db";

// Read the generated artifact, never import its side-effecting generator or connect to a database.
// Root runs generate-openapi.ts before this suite.
type Schema = Record<string, unknown>;
type Parameter = { in: string; name: string; required?: boolean; schema?: Schema };
type Operation = { security?: Record<string, string[]>[]; parameters?: Parameter[]; requestBody?: { required?: boolean; content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }>; headers?: Record<string, { schema: Schema }> }>; [key: string]: unknown };
type Path = { parameters?: Parameter[]; [key: string]: unknown };
const spec = JSON.parse(readFileSync("docs/planning/contracts/openapi.json", "utf8")) as {
  security: Record<string, string[]>[]; paths: Record<string, Path>; components: { schemas: Record<string, Schema> };
};
const operation = (path: string, method = "get") => {
  expect(spec.paths[path], "Generate OpenAPI before running author asset contract tests").toBeDefined();
  const value = spec.paths[path]?.[method] as Operation | undefined;
  expect(value).toBeDefined(); return value!;
};
const assetPaths: Record<string, string[]> = {
  "/author-assets": ["get"], "/author-assets/{id}/download": ["get"],
  "/author-assets/uploads": ["post"], "/author-assets/uploads/{id}": ["get", "delete"],
  "/author-assets/uploads/{id}/content": ["put"], "/author-assets/uploads/{id}/complete": ["post"],
  "/author-assets/uploads/{id}/download": ["get"], "/author-assets/usage": ["get"],
  "/public/forms/{token}/author-assets": ["get"], "/public/forms/{token}/author-assets/{id}/download": ["get"],
  "/viewer/author-assets": ["get"], "/viewer/author-assets/{id}/download": ["get"],
};

test("all implemented author asset methods are documented, including the optional-catchall manifest root", () => {
  expect(Object.keys(spec.paths).filter(path => path.includes("/author-assets")).sort()).toEqual(Object.keys(assetPaths).sort());
  for (const [path, methods] of Object.entries(assetPaths)) {
    expect(Object.keys(spec.paths[path]).filter(key => ["get", "post", "put", "patch", "delete"].includes(key)).sort()).toEqual([...methods].sort());
    for (const method of methods) expect(operation(path, method)["x-implementation"]).toBe("implemented");
    expect(spec.paths[path]["x-handler"]).toBe(path.startsWith("/author-assets") ? "src/app/api/v1/author-assets/[[...segments]]/route.ts"
      : path.startsWith("/viewer") ? "src/app/api/v1/viewer/[...segments]/route.ts" : "src/app/api/v1/public/forms/[...segments]/route.ts");
  }
  expect(Object.keys(spec.paths).some(path => /author-assets.*(?:system|ingest|storage|blob)/.test(path))).toBe(false);
});
test("member, public publication and viewer routes retain distinct authentication boundaries", () => {
  for (const [path, methods] of Object.entries(assetPaths)) for (const method of methods) {
    const op = operation(path, method);
    expect(op.security ?? spec.security).toEqual(path.startsWith("/public/") ? [] : path.startsWith("/viewer/") ? [{ viewerSession: [] }] : [{ cookieSession: [] }]);
    if (path.startsWith("/author-assets")) expect(op["x-contract-policy"]).toBe("author-assets");
  }
});
test("init publishes the actual strict input contract, 201 replay and required idempotency header", () => {
  const op = operation("/author-assets/uploads", "post");
  expect(spec.components.schemas.AuthorAssetUploadInput).toMatchObject(z.toJSONSchema(authorAssetUploadInput));
  expect(op.requestBody?.content["application/json"].schema).toEqual({ $ref: "#/components/schemas/AuthorAssetUploadInput" });
  expect(op.parameters).toContainEqual({ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } });
  expect(op.responses["201"].content?.["application/json"].schema).toEqual({ $ref: "#/components/schemas/AuthorAssetUploadInfo" });
  expect(op.responses["200"]).toBeUndefined();
});
test("raw upload MIME and purpose-specific byte limits cannot silently become respondent upload limits", () => {
  const body = operation("/author-assets/uploads/{id}/content", "put").requestBody!;
  expect(Object.keys(body.content).sort()).toEqual([...authorAssetMimeSchema.options].sort());
  for (const value of Object.values(body.content)) expect(value.schema).toEqual({ type: "string", format: "binary" });
  expect(body).toMatchObject({ required: true, "x-max-bytes": 14680064, "x-material-max-bytes": 5242880,
    "x-option-image-max-bytes": 1048576, "x-question-image-max-bytes": 1048576, "x-body-image-max-bytes": 14680064 });
  expect(spec.components.schemas.AuthorAssetUploadInput["x-purpose-byte-limits"]).toEqual({
    QUESTION_MATERIAL: 5242880, OPTION_IMAGE: 1048576, QUESTION_IMAGE: 1048576,
    FORM_CONTENT_IMAGE: 14680064, PAGE_CONTENT_IMAGE: 14680064,
    END_PAGE_CONTENT_IMAGE: 14680064, PRIVATE_PAGE_CONTENT_IMAGE: 14680064,
  });
});
test("member parent scope preserves conditional version requirements and separate query/path IDs", () => {
  expect(spec.components.schemas.AuthorAssetReadScope).toEqual(z.toJSONSchema(authorAssetReadScopeSchema));
  for (const path of ["/author-assets", "/author-assets/{id}/download"]) {
    const op = operation(path);
    expect(op["x-strict-query"]).toBe(true);
    expect(op["x-query-schema"]).toEqual({ $ref: "#/components/schemas/AuthorAssetReadScope" });
    expect(op.parameters?.find(parameter => parameter.name === "id")).toMatchObject({ in: "query", required: true, schema: { format: "uuid" } });
    expect(op["x-permission"]).toContain("submission.read"); expect(op["x-permission"]).toContain("form.read");
  }
  expect(spec.paths["/author-assets/{id}/download"].parameters).toContainEqual({ in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } });
});
test("public and viewer metadata reads cannot be confused with member parent selectors", () => {
  for (const path of Object.keys(assetPaths).filter(path => path.startsWith("/public/"))) {
    const op = operation(path); expect(op["x-strict-query"]).toBe(true);
    expect(op.parameters?.map(parameter => parameter.name)).toEqual(["surface", "proof"]);
    expect(op.parameters?.find(parameter => parameter.name === "surface")?.schema).toMatchObject({ enum: ["active", "closed", "completion"], default: "active" });
    expect(op.parameters?.find(parameter => parameter.name === "proof")?.schema).toMatchObject({ minLength: 1, maxLength: 2048 });
    expect(spec.paths[path].parameters?.find(parameter => parameter.name === "token")?.schema).toEqual({ type: "string", pattern: "^[A-Za-z0-9_-]{43}$" });
  }
  for (const path of Object.keys(assetPaths).filter(path => path.startsWith("/viewer/"))) {
    const op = operation(path); expect(op["x-strict-query"]).toBe(true);
    expect(op.parameters).toEqual([{ in: "query", name: "submissionId", required: true, schema: { type: "string", format: "uuid" } }]);
  }
});
test("discard requires a version and returns no body, while usage requires service context", () => {
  const discard = operation("/author-assets/uploads/{id}", "delete");
  expect(discard.parameters).toContainEqual({ in: "query", name: "version", required: true, schema: { type: "integer", minimum: 1 } });
  expect(discard.responses["204"]).toBeDefined(); expect(discard.responses["204"].content).toBeUndefined();
  expect(operation("/author-assets/usage").parameters).toEqual([{ in: "query", name: "serviceId", required: true, schema: { type: "string", format: "uuid" } }]);
});
test("safe manifest DTO has only public display fields, never ownership or storage metadata", () => {
  const info = spec.components.schemas.AuthorAssetInfo;
  expect(Object.keys(info.properties as Schema).sort()).toEqual(["id", "purpose", "name", "mime", "size", "sha256", "status", "version", "expiresAt"].sort());
  expect(info.additionalProperties).toBe(false);
  expect(spec.components.schemas.AuthorAssetManifest).toMatchObject({ additionalProperties: false, required: ["items"], properties: { items: { items: { $ref: "#/components/schemas/AuthorAssetInfo" } } } });
});
test("mixed materials and option-image UUID/null are documented from the same runtime wire schema", () => {
  expect(spec.components.schemas.QuestionMaterials).toEqual(z.toJSONSchema(questionMaterialsSchema));
  expect(spec.components.schemas.QuestionOption).toMatchObject(z.toJSONSchema(optionDefinitionSchema));
  for (const path of Object.keys(assetPaths)) expect(spec.paths[path]["x-author-asset-limits"]).toEqual({
    mixedMaterialsPerQuestion: 3, optionImagesPerQuestion: 20, questionImagesPerQuestion: 1,
    materialBytes: 5242880, imageBytes: 1048576, bodyImageBytes: 14680064,
    imagePixels: 8388608, imageDimension: 8192, bodyImagePixels: 25165824, bodyImageDimension: 16384,
    imageFrames: 1, concurrentImageDecodes: 2,
  });
});
test("every download is binary with private non-sniffable sandboxed response headers", () => {
  for (const path of Object.keys(assetPaths).filter(path => path.endsWith("/download"))) {
    const response = operation(path).responses["200"];
    expect(Object.keys(response.content!).sort()).toEqual([...authorAssetMimeSchema.options].sort());
    expect(response.headers).toMatchObject({ "Cache-Control": { schema: { const: "private, no-store" } },
      "X-Content-Type-Options": { schema: { const: "nosniff" } }, "Referrer-Policy": { schema: { const: "no-referrer" } },
      "Cross-Origin-Resource-Policy": { schema: { const: "same-origin" } }, "Content-Security-Policy": { schema: { const: "sandbox; default-src 'none'" } } });
  }
});

function transaction(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue(rows), empty = () => ({ findMany: vi.fn().mockResolvedValue([]) });
  const tx = { form: empty(), submission: empty(), fileObject: empty(), exportJob: empty(), formVersion: empty(), $queryRaw: query };
  return { tx: tx as unknown as Transaction, query, raw: tx };
}
test("limited audit scope never resolves or exposes author-asset parent titles", async () => {
  const mock = transaction();
  expect(await auditResources(mock.tx, "tenant-a", [{ id: "event-a", resource: "author-asset", resourceId: "asset-a", serviceId: "service-a" }], false)).toEqual(new Map());
  expect(mock.query).not.toHaveBeenCalled(); expect(mock.raw.form.findMany).not.toHaveBeenCalled();
});
test("audit projection is restricted to authorized event IDs and matching current services", async () => {
  const mock = transaction([
    { id: "event-a", serviceId: "service-a", formName: "허용 폼", submissionId: "submission-a", detail: "never expose" },
    { id: "event-b", serviceId: "service-b", formName: "다른 서비스", submissionId: null },
    { id: "unselected", serviceId: "service-a", formName: "목록 외", submissionId: null },
  ]);
  const result = await auditResources(mock.tx, "tenant-a", [
    { id: "event-a", resource: "author-asset", resourceId: "asset-a", serviceId: "service-a" },
    { id: "event-b", resource: "author-asset", resourceId: "asset-b", serviceId: "service-a" },
    { id: "unscoped", resource: "author-asset", resourceId: "asset-c", serviceId: null },
  ], true);
  expect([...result]).toEqual([["event-a", { formName: "허용 폼", submissionId: "submission-a" }]]);
  const sql = mock.query.mock.calls[0][0] as { values: unknown[] };
  expect(sql.values).toEqual(["tenant-a", ["event-a", "event-b"]]);
});
