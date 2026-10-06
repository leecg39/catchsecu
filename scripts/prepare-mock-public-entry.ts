import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { createNotice } from "../src/server/notices";

const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_mock_admin");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const title = "Mock 공개 경로 수용 공지";
try {
  let notice = await db.notice.findFirst({ where: { title, status: "published" } });
  if (!notice) {
    const user = await db.user.findFirstOrThrow({ where: { platformAdmin: true } });
    const created = await createNotice({ user }, { category: "Mock QA", title,
      bodyHtml: "<p>합성 데이터로 공개 공지의 상세 화면을 확인합니다.</p>", sortOrder: 0, status: "published" }, randomUUID(), randomUUID());
    assert.equal(created.status, 201);
    notice = await db.notice.findUniqueOrThrow({ where: { id: created.body.id } });
  }
  assert.ok(await db.auditEvent.findFirst({ where: { resourceId: notice.id, action: "notice.created" } }));
  console.log(JSON.stringify({ noticeFixtureReady: true, published: true, creationAuditPresent: true }));
} finally { await db.$disconnect(); }
