import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import nodemailer from "nodemailer";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { enqueueMail, runOneJob } from "@/server/jobs";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) {
  throw new Error("R01 outbox boundary tests require the isolated catchsecu_test database.");
}

const original = {
  transport: env.MAIL_TRANSPORT,
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  user: env.SMTP_USER,
  password: env.SMTP_PASSWORD,
};

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE',
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  env.MAIL_TRANSPORT = original.transport;
  env.SMTP_HOST = original.host;
  env.SMTP_PORT = original.port;
  env.SMTP_SECURE = original.secure;
  env.SMTP_USER = original.user;
  env.SMTP_PASSWORD = original.password;
});

afterAll(async () => {
  await db.$disconnect();
});

test("회사·서비스·마케팅 동의 데이터가 없는 인증메일도 SMTP에서 한 번만 전달된다", async () => {
  env.MAIL_TRANSPORT = "smtp";
  env.SMTP_HOST = "synthetic.smtp.test";
  env.SMTP_PORT = 587;
  env.SMTP_SECURE = "false";
  env.SMTP_USER = undefined;
  env.SMTP_PASSWORD = undefined;
  const sendMail = vi.fn().mockResolvedValue({ messageId: "r01-auth-smtp", accepted: ["auth-only@example.test"], rejected: [] });
  const createTransport = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail } as never);

  expect(await db.company.count()).toBe(0);
  expect(await db.marketingPreference.count()).toBe(0);
  const job = await enqueueMail({
    to: "auth-only@example.test",
    subject: "인증메일 SMTP 경계",
    text: "합성 인증 링크",
  }, "r01-auth-smtp-" + randomUUID());
  expect(job.tenantId).toBeNull();
  expect(await runOneJob("r01-auth-smtp-worker", { tenantId: null, jobId: job.id })).toBe(true);

  expect(createTransport).toHaveBeenCalledOnce();
  expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
    host: "synthetic.smtp.test",
    port: 587,
    secure: false,
    requireTLS: true,
  }));
  expect(sendMail).toHaveBeenCalledOnce();
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
    to: "auth-only@example.test",
    subject: "인증메일 SMTP 경계",
    text: "합성 인증 링크",
  }));
  expect(await db.job.findUnique({ where: { id: job.id } })).toMatchObject({
    status: "done",
    attempts: 1,
    lastError: null,
  });
  expect(await db.jobAttempt.findMany({ where: { jobId: job.id } })).toEqual([
    expect.objectContaining({ attempt: 1, outcome: "delivered", errorCode: null }),
  ]);
  expect(await db.auditEvent.findMany({ where: { resource: "job", resourceId: job.id } })).toEqual([
    expect.objectContaining({ action: "email.accepted", tenantId: null, actorId: null }),
  ]);
  expect(await db.marketingPreference.count()).toBe(0);

  expect(await runOneJob("r01-auth-smtp-worker", { tenantId: null, jobId: job.id })).toBe(false);
  expect(sendMail).toHaveBeenCalledOnce();
  expect(await db.jobAttempt.count({ where: { jobId: job.id } })).toBe(1);
});
