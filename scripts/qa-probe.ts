import { db } from "../src/server/db";
const b = "10000000-0000-4000-8000-000000000002";
const [svc, form, sender, campaign, doc] = await Promise.all([
  db.service.findMany({ where: { tenantId: b }, select: { id: true, name: true }, take: 5 }),
  db.form.findFirst({ where: { tenantId: b, status: { not: "deleted" } }, select: { id: true } }),
  db.sender.findFirst({ where: { tenantId: b, status: { not: "deleted" } }, select: { id: true } }),
  db.campaign.findFirst({ where: { tenantId: b }, select: { id: true } }),
  db.document.findFirst({ where: { tenantId: b }, select: { id: true } }),
]);
console.log(JSON.stringify({ services: svc, form: form?.id, sender: sender?.id, campaign: campaign?.id, doc: doc?.id }));
