import { expect, test } from "vitest";
import { isRegisteredPage } from "@/lib/registered-page";

test("new retention and institution callback entry points are registered", () => {
  for (const path of ["/log/retention", "/login/gpki/callback", "/login/saeol/callback"])
    expect(isRegisteredPage(path)).toBe(true);
});
test("fallback inventory entries do not expose arbitrary pages", () => {
  for (const path of ["/not-a-page", "/security/not-a-page", "/security/anything/nested", "/log/retention/extra", "/*", "/security/*"])
    expect(isRegisteredPage(path)).toBe(false);
});
test("dynamic page parameters match a single segment", () => {
  expect(isRegisteredPage("/form/manage/applicant/valid-id")).toBe(true);
  expect(isRegisteredPage("/form/manage/applicant/service-id/form-id")).toBe(true);
  expect(isRegisteredPage("/form/manage/applicant/service-id/form-id/extra")).toBe(false);
});
