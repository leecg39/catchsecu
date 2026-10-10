import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { fail, json, rateLimit, route } from "@/server/http";
import { GET as listServices, POST as createService } from "@/app/api/v1/services/route";
import {
  DELETE as deleteService,
  GET as readService,
  PATCH as updateService,
} from "@/app/api/v1/services/[id]/route";
import { POST as createForm } from "@/app/api/v1/forms/route";
import {
  DELETE as deleteForm,
  GET as readForm,
  PATCH as updateForm,
} from "@/app/api/v1/forms/[...segments]/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) {
  throw new Error("R01 API boundary tests require the isolated catchsecu_test database.");
}

const origin = new URL(env.BETTER_AUTH_URL).origin;
const password = "R01-api-boundaries!123";

function request(path: string, method = "GET", cookie = "", value?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(value !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
  });
}

function cookieOf(response: Response) {
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}

async function person(tenantId: string, role: "owner" | "viewer") {
  const email = `r01-${role}-${randomUUID()}@catchsecu.test`;
  expect((await auth.handler(request("/auth/sign-up/email", "POST", "", { name: role, email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } });
  const signed = await auth.handler(request("/auth/sign-in/email", "POST", "", { email, password }));
  expect(signed.status).toBe(200);
  return { user, member, cookie: cookieOf(signed) };
}

function formPayload(serviceId: string, title = "R01 API 경계 폼") {
  return {
    serviceId,
    title,
    content: {
      body: "",
      questions: [{ id: randomUUID(), type: "단문형 답변", label: "이름", required: true }],
      consentRequired: false,
      consentPurpose: "",
      retentionDays: 30,
      maxResponses: 10,
    },
  };
}

async function fixture() {
  const companyA = await db.company.create({ data: { name: "R01 회사 A", publicName: "R01 A", policy: { create: {} } } });
  const companyB = await db.company.create({ data: { name: "R01 회사 B", publicName: "R01 B", policy: { create: {} } } });
  const ownerA = await person(companyA.id, "owner");
  const viewerA = await person(companyA.id, "viewer");
  const ownerB = await person(companyB.id, "owner");
  const serviceResponse = await createService(request("/services", "POST", ownerA.cookie, {
    name: "R01 서비스 A",
    externalName: "R01 서비스 A",
  }));
  expect(serviceResponse.status).toBe(201);
  const service = await serviceResponse.json();
  await db.serviceGrant.create({
    data: {
      tenantId: companyA.id,
      memberId: viewerA.member.id,
      serviceId: service.id,
      capabilities: ["service.read", "form.read"],
    },
  });
  return { companyA, companyB, ownerA, viewerA, ownerB, service };
}

async function addForm(f: Awaited<ReturnType<typeof fixture>>, title = "R01 API 경계 폼") {
  const payload = formPayload(f.service.id, title);
  const response = await createForm(request("/forms", "POST", f.ownerA.cookie, payload, {
    "idempotency-key": randomUUID(),
  }));
  expect(response.status).toBe(201);
  return response.json();
}

beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE',
  );
});

afterAll(async () => {
  await db.$disconnect();
});

test("세션 회사가 tenantId를 결정하고 본문 주입·회사 교차 참조·DB FK 우회를 거부한다", async () => {
  const f = await fixture();
  const injected = await createService(request("/services", "POST", f.ownerB.cookie, {
    tenantId: f.companyA.id,
    name: "주입 서비스",
    externalName: "주입 서비스",
  }));
  expect(injected.status).toBe(422);
  expect(await db.service.count({ where: { name: "주입 서비스" } })).toBe(0);

  const foreignReference = await createForm(request("/forms", "POST", f.ownerB.cookie, formPayload(f.service.id), {
    "idempotency-key": randomUUID(),
  }));
  expect(foreignReference.status).toBe(404);
  expect(await db.form.count({ where: { tenantId: f.companyB.id } })).toBe(0);

  await expect(db.form.create({
    data: {
      tenantId: f.companyB.id,
      serviceId: f.service.id,
      ownerId: f.ownerB.user.id,
      title: "DB 우회 시도",
    },
  })).rejects.toThrow();
  expect(await db.form.count({ where: { title: "DB 우회 시도" } })).toBe(0);
});

test("동일 멱등 키의 동시 생성과 재시도는 같은 결과 한 건만 남기고 다른 payload는 409다", async () => {
  const f = await fixture();
  const payload = formPayload(f.service.id, "멱등 생성 폼");
  const key = randomUUID();
  const [first, second] = await Promise.all([
    createForm(request("/forms", "POST", f.ownerA.cookie, payload, { "idempotency-key": key })),
    createForm(request("/forms", "POST", f.ownerA.cookie, payload, { "idempotency-key": key })),
  ]);
  expect([first.status, second.status]).toEqual([201, 201]);
  const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);
  expect(secondBody.id).toBe(firstBody.id);
  expect(await db.form.count({ where: { tenantId: f.companyA.id, title: "멱등 생성 폼" } })).toBe(1);
  expect(await db.idempotencyRecord.count({ where: { scope: `form:create:${f.ownerA.member.id}`, key } })).toBe(1);

  const replay = await createForm(request("/forms", "POST", f.ownerA.cookie, payload, { "idempotency-key": key }));
  expect(replay.status).toBe(201);
  expect((await replay.json()).id).toBe(firstBody.id);

  const mismatch = await createForm(request("/forms", "POST", f.ownerA.cookie, { ...payload, title: "다른 본문" }, {
    "idempotency-key": key,
  }));
  expect(mismatch.status).toBe(409);
  expect((await mismatch.json()).error.code).toBe("IDEMPOTENCY_MISMATCH");
  expect(await db.form.count({ where: { tenantId: f.companyA.id } })).toBe(1);
});

test("같은 version의 경쟁 PATCH는 한 건만 반영하고 다른 요청은 409를 반환한다", async () => {
  const f = await fixture();
  const form = await addForm(f, "경쟁 전");
  const [left, right] = await Promise.all([
    updateForm(request(`/forms/${form.id}`, "PATCH", f.ownerA.cookie, { version: 1, title: "왼쪽 승자" })),
    updateForm(request(`/forms/${form.id}`, "PATCH", f.ownerA.cookie, { version: 1, title: "오른쪽 승자" })),
  ]);
  expect([left.status, right.status].sort()).toEqual([200, 409]);
  const stored = await db.form.findUniqueOrThrow({ where: { id: form.id } });
  expect(stored.version).toBe(2);
  expect(["왼쪽 승자", "오른쪽 승자"]).toContain(stored.title);
  const loser = left.status === 409 ? left : right;
  expect((await loser.json()).error.code).toBe("VERSION_CONFLICT");
  expect(await db.auditEvent.count({ where: { tenantId: f.companyA.id, action: "form.draft_updated", resourceId: form.id } })).toBe(1);
});

test("읽기 grant는 create·update·delete 권한을 주지 않고 다른 회사 자원은 404로 숨긴다", async () => {
  const f = await fixture();
  const form = await addForm(f);
  expect((await readService(request(`/services/${f.service.id}`, "GET", f.viewerA.cookie))).status).toBe(200);
  expect((await readForm(request(`/forms/${form.id}`, "GET", f.viewerA.cookie))).status).toBe(200);

  expect((await createService(request("/services", "POST", f.viewerA.cookie, {
    name: "금지된 생성",
    externalName: "금지된 생성",
  }))).status).toBe(403);
  expect((await updateService(request(`/services/${f.service.id}`, "PATCH", f.viewerA.cookie, {
    version: 1,
    name: "금지된 수정",
  }))).status).toBe(403);
  expect((await deleteService(request(`/services/${f.service.id}`, "DELETE", f.viewerA.cookie, undefined, {
    "if-match": "1",
  }))).status).toBe(403);
  expect((await createForm(request("/forms", "POST", f.viewerA.cookie, formPayload(f.service.id), {
    "idempotency-key": randomUUID(),
  }))).status).toBe(403);
  expect((await updateForm(request(`/forms/${form.id}`, "PATCH", f.viewerA.cookie, {
    version: 1,
    title: "금지된 폼 수정",
  }))).status).toBe(403);
  expect((await deleteForm(request(`/forms/${form.id}`, "DELETE", f.viewerA.cookie, undefined, {
    "if-match": "1",
  }))).status).toBe(403);

  expect((await readService(request(`/services/${f.service.id}`, "GET", f.ownerB.cookie))).status).toBe(404);
  expect((await readForm(request(`/forms/${form.id}`, "GET", f.ownerB.cookie))).status).toBe(404);
  expect((await db.form.findUniqueOrThrow({ where: { id: form.id } })).version).toBe(1);
  expect((await db.service.findUniqueOrThrow({ where: { id: f.service.id } })).version).toBe(1);
  expect((await deleteForm(request(`/forms/${form.id}`, "DELETE", f.ownerA.cookie, undefined, {
    "if-match": "1",
  }))).status).toBe(204);
  expect((await db.form.findUniqueOrThrow({ where: { id: form.id } })).status).toBe("archived");
});

test("공통 HTTP 경계는 안전한 상태 코드·requestId·본문 크기·안정 목록 계약을 유지한다", async () => {
  const f = await fixture();
  const unauthenticated = await listServices(request("/services"));
  expect(unauthenticated.status).toBe(401);

  const wrongOrigin = await createService(new Request(origin + "/api/v1/services", {
    method: "POST",
    headers: { origin: "https://invalid.example", cookie: f.ownerA.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "출처 오류", externalName: "출처 오류" }),
  }));
  expect(wrongOrigin.status).toBe(403);

  const malformed = await createService(new Request(origin + "/api/v1/services", {
    method: "POST",
    headers: { origin, cookie: f.ownerA.cookie, "content-type": "application/json" },
    body: "{",
  }));
  expect(malformed.status).toBe(400);

  const tooLarge = await createService(request("/services", "POST", f.ownerA.cookie, {
    name: "큰 요청",
    externalName: "큰 요청",
  }, { "content-length": "1000001" }));
  expect(tooLarge.status).toBe(413);

  const unsupported = await createService(new Request(origin + "/api/v1/services", {
    method: "POST",
    headers: { origin, cookie: f.ownerA.cookie, "content-type": "text/plain" },
    body: "plain",
  }));
  expect(unsupported.status).toBe(415);

  const strict = await createService(request("/services", "POST", f.ownerA.cookie, {
    name: "엄격 DTO",
    externalName: "엄격 DTO",
    unknown: true,
  }));
  expect(strict.status).toBe(422);

  const expired = await route(async () => fail(410, "EXPIRED", "만료됨"))(new Request(origin + "/api/v1/test-expired"));
  expect(expired.status).toBe(410);
  const limitedHandler = route(async () => {
    await rateLimit("r01-contract-" + f.companyA.id, 1);
    return json({ ok: true });
  });
  expect((await limitedHandler(new Request(origin + "/api/v1/test-rate"))).status).toBe(200);
  const limited = await limitedHandler(new Request(origin + "/api/v1/test-rate"));
  expect(limited.status).toBe(429);
  expect(limited.headers.get("Retry-After")).toBe("60");

  for (const response of [unauthenticated, wrongOrigin, malformed, tooLarge, unsupported, strict, expired, limited]) {
    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  }

  for (const name of ["가 서비스", "나 서비스", "다 서비스"]) {
    expect((await createService(request("/services", "POST", f.ownerA.cookie, { name, externalName: name }))).status).toBe(201);
  }
  const first = await (await listServices(request("/services?sort=name&direction=asc&page=1&pageSize=2", "GET", f.ownerA.cookie))).json();
  const second = await (await listServices(request("/services?sort=name&direction=asc&page=1&pageSize=2", "GET", f.ownerA.cookie))).json();
  expect(second.items.map((item: { id: string }) => item.id)).toEqual(first.items.map((item: { id: string }) => item.id));
  expect(first).toMatchObject({ total: 4, page: 1, pageSize: 2 });
});
