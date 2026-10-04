import { db } from "../src/server/db";
const v = await db.formVersion.findFirst({ where: { formId: "263077e4-3923-4cc2-884a-ba081d83d4da", status: "published" }, select: { id: true, number: true } });
console.log(JSON.stringify(v));
