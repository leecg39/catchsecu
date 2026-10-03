import { db } from "@/server/db";
import { requireActor } from "@/server/context";
import { body, json, rateLimit, route } from "@/server/http";
import { companyInput } from "@/server/schemas";
export const POST = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  await rateLimit("company:create:" + actor.user.id, 5, 3600);
  const input = await body(request, companyInput);
  const company = await db.$transaction(async tx => {
    const created = await tx.company.create({ data: {
      ...input, policy: { create: {} },
      memberships: { create: { userId: actor.user.id, role: "owner" } },
      services: { create: { name: input.name, externalName: input.publicName } },
    } });
    const start = new Date();
    await tx.billingSubscription.create({ data: { tenantId: created.id, planId: "trial", planVersionId: "trial-v1",
      status: "trialing", priceKrw: 0, currency: "KRW", activationSource: "trial",
      periodStart: start, periodEnd: new Date(start.getTime() + 7 * 86400000),
      events: { create: { version: 1, kind: "trial_started", detail: { source: "company_registration" } } },
    } });
    await tx.session.update({ where: { id: actor.session.id }, data: { activeCompanyId: created.id, activeServiceId: null } });
    await tx.auditEvent.create({ data: { tenantId: created.id, actorId: actor.user.id, action: "company.created",
      resource: "company", resourceId: created.id, requestId, detail: {} } });
    return created;
  });
  return json(company, 201);
});
