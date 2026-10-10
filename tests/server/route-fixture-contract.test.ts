import { describe, expect, it } from "vitest";
import { buildRouteFixture, type FixtureRoute } from "../../src/server/fixtures/routes";
import { externalScenarios } from "../../src/server/fixtures/catalog";
const route = (path: string): FixtureRoute => ({ id: "RR-test", path, domain: "R00", page_acceptance: "save/read", actors: "owner", api_operations: [] });
const value = (value: string, model: string) => ({ value, model, verified: true });
describe("route fixture evidence boundaries", () => {
  it("never supplies a fake missing payment ID and binds invoice/order to the same actual model", () => {
    expect(buildRouteFixture(route("/bill/:id"), {}).path).toBeNull();
    const bindings = { paymentOrder: value("persisted-order", "PaymentOrder") };
    expect(buildRouteFixture(route("/bill/:id/refund"), bindings).path).toBe("/bill/persisted-order/refund");
    expect(buildRouteFixture(route("/pay/plus/success/:purchasedId/:type"), bindings).path).toBe("/pay/plus/success/persisted-order/license");
  });
  it("uses a fixed slug only for /url and requires verified token provenance", () => {
    const bindings = { fixedUrl: value("actual-slug", "FixedUrl"), publicForm: { ...value("unverified", "Publication"), verified: false } };
    expect(buildRouteFixture(route("/url/:outerToken"), bindings).path).toBe("/url/actual-slug");
    expect(buildRouteFixture(route("/projects/:outerToken/form"), bindings).path).toBeNull();
  });
  it("prepares query-bound editing and does not equate shell rendering with execution", () => {
    const row = buildRouteFixture(route("/form/ai/agreement"), { form: value("actual-form", "Form") });
    expect(row.path).toBe("/form/ai/agreement?formId=actual-form");
    expect(row.execution).toBe("not_run");
    expect(row.scenarios.map(item => item.execution)).toEqual(["not_run", "not_run", "not_run"]);
    expect(buildRouteFixture(route("/basic/result/consent/edit"), {}).preparation).toBe("required");
  });
  it("requires an issued callback and browser state instead of fabricating successful URLs", () => {
    const callback = buildRouteFixture(route("/login/gpki/callback"), {});
    expect(callback.preparation).toBe("required"); expect(callback.externalRequired).toBe(true);
    expect(callback.path).toBe("/login/gpki/callback");
    expect(buildRouteFixture(route("/identification/:result"), {}).path).toBe("/identification/pending");
  });
  it("uses negative fallback probes and fails unknown parameter mapping", () => {
    expect(buildRouteFixture(route("/security/*"), {}).path).toBe("/security/__rea_unknown_route__");
    expect(buildRouteFixture(route("/security/*"), {}).scenarios[0].expected).toContain("404");
    expect(() => buildRouteFixture(route("/unknown/:otherId"), {})).toThrow("unknown route parameter");
  });
  it("keeps every external staging run on an explicit dedicated test target", () => {
    const staging = externalScenarios.filter(item => item.grade === "staging");
    expect(staging.length).toBeGreaterThan(0);
    for (const scenario of staging) {
      expect(scenario.releasePass).toBe(false);
      expect(scenario.testTargetPolicy).toMatch(/시험|sandbox/);
    }
  });
});
