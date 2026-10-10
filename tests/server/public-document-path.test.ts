import { expect, test } from "vitest";
import { publicDocumentToken } from "@/lib/public-document-path";
import { isRegisteredPage } from "@/lib/registered-page";
const token = "aB_12-".repeat(7) + "x";
test("all three source document routes preserve the same opaque token without inferring document type", () => {
  for (const prefix of ["P", "C", "OC", "view"]) {
    const path = "/document/" + prefix + "/" + token;
    expect(publicDocumentToken(path)).toBe(token);
    if (prefix !== "view") expect(isRegisteredPage(path)).toBe(true);
  }
});
test("malformed or extra document segments cannot reach the public token API", () => {
  for (const path of ["/document/other/" + token, "/document/C/" + token + "/extra",
    "/document/P/" + token.slice(1), "/document/OC/" + token + "x",
    "/document/view/" + token + "?state=ok", "/document/P/%2F" + token.slice(3)]) {
    expect(publicDocumentToken(path)).toBeUndefined();
  }
});
