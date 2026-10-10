import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { z } from "zod";
import { shareCreateInput, shareUpdateInput } from "@/contracts/sharing";

const spec = JSON.parse(readFileSync("docs/planning/contracts/openapi.json", "utf8")) as {
  paths: Record<string, Record<string, { requestBody?: { content: { "application/json": { schema: unknown } } } }>>;
};

function contentAt(path: string, method: string) {
  const schema = spec.paths[path][method].requestBody!.content["application/json"].schema as {
    properties: { content: { properties: Record<string, unknown> } };
  };
  return schema.properties.content.properties;
}

test("OpenAPI publishes page placement, explicit destinations and terminal notice modes on every authoring route", () => {
  for (const [path, method] of [["/forms", "post"], ["/forms/{id}", "patch"],
    ["/forms/{id}/draft", "patch"], ["/templates", "post"], ["/templates/{id}", "patch"]]) {
    const content = contentAt(path, method) as {
      sections: { anyOf: Array<{ type?: string; maxItems?: number; items?: { properties?: Record<string, unknown> } }> };
      completionPage: { anyOf: Array<{ anyOf?: unknown[]; type?: string }> };
      closedPage: { anyOf: Array<{ anyOf?: unknown[]; type?: string }> };
      questions: { items: { properties: Record<string, unknown> } };
    };
    const sections = content.sections.anyOf.find(item => item.type === "array")!;
    expect(sections.maxItems).toBe(50);
    expect(sections.items?.properties).toHaveProperty("defaultDestination");
    expect(content.completionPage.anyOf).toHaveLength(2);
    expect(content.completionPage.anyOf[0].anyOf).toHaveLength(2);
    expect(content.closedPage.anyOf).toHaveLength(2);
    expect(content.closedPage.anyOf[0].anyOf).toHaveLength(2);
    expect(content.questions.items.properties).toHaveProperty("pageId");
    const options = content.questions.items.properties.optionDefinitions as { items: { properties: Record<string, unknown> } };
    expect(options.items.properties).toHaveProperty("branchDestination");
  }
});

test("OpenAPI publishes explicit root-body sharing and the safe ShareRecord flag", () => {
  expect(spec.paths["/share-grants"].post.requestBody!.content["application/json"].schema).toEqual(z.toJSONSchema(shareCreateInput));
  expect(spec.paths["/share-grants/{id}"].patch.requestBody!.content["application/json"].schema).toEqual(z.toJSONSchema(shareUpdateInput));
  const schemas = (JSON.parse(readFileSync("docs/planning/contracts/openapi.json", "utf8")) as { components: { schemas: Record<string, { required: string[]; properties: Record<string, unknown> }> } }).components.schemas;
  expect(schemas.ShareRecord.required).toContain("shareFormBody");
  expect(schemas.ShareRecord.properties.shareFormBody).toMatchObject({ type: "boolean" });
});
