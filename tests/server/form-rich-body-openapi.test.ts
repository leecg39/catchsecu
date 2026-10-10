import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const spec = JSON.parse(readFileSync("docs/planning/contracts/openapi.json", "utf8")) as {
  paths: Record<string, Record<string, { requestBody?: { content: { "application/json": { schema: unknown } } } }>>;
  components: { schemas: Record<string, Record<string, unknown>> };
};

function bodyRichAt(path: string, method: string) {
  const schema = spec.paths[path][method].requestBody!.content["application/json"].schema as {
    properties: { content: { properties: { bodyRich: Record<string, unknown> } } };
  };
  return schema.properties.content.properties.bodyRich;
}

test("OpenAPI exposes one reusable recursive rich document and the nullable omission contract", () => {
  const document = spec.components.schemas.RichDocumentV1 as {
    properties: { blocks: { items: { $ref: string } } };
  };
  expect(document.properties.blocks.items.$ref).toBe("#/components/schemas/RichBlock");
  expect(spec.components.schemas.RichBlock).toBeDefined();
  expect(JSON.stringify(spec)).not.toContain("#/$defs/");

  for (const [path, method] of [["/forms", "post"], ["/forms/{id}", "patch"],
    ["/forms/{id}/draft", "patch"], ["/templates", "post"], ["/templates/{id}", "patch"]]) {
    const property = bodyRichAt(path, method) as { anyOf: { $ref?: string; type?: string }[]; description: string };
    expect(property.anyOf).toEqual([{ $ref: "#/components/schemas/RichDocumentV1" }, { type: "null" }]);
    expect(property.description).toContain("Omission preserves");
    expect(property.description).toContain("null explicitly removes");
  }
});
