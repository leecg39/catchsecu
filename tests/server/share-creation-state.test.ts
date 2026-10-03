import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { ShareCreationSession } from "@/lib/share-creation";
const formId = randomUUID(), formVersionId = randomUUID(), payload = JSON.stringify({ formId, formVersionId, email: "viewer@catchsecu.test" });
const receipt = { id: randomUUID(), formId, formVersionId, version: 1, status: "active" };
test("lost success keeps the original key and body; retry returns one grant", async () => {
  const calls: { body: string; key: string }[] = [];
  const session = new ShareCreationSession({ send: async (body, key) => { calls.push({ body, key }); if (calls.length === 1) throw new TypeError("response lost"); return receipt; }, makeKey: () => "same-request-key" });
  await expect(session.submit(payload)).rejects.toThrow("response lost"); expect(session.hasPending).toBe(true);
  await expect(session.submit(payload + " ")).rejects.toThrow("이전 초대 결과");
  expect(await session.retry()).toEqual(receipt); expect(calls).toEqual([{ body: payload, key: "same-request-key" }, { body: payload, key: "same-request-key" }]); expect(session.hasPending).toBe(false);
});
test("confirmed initial input rejection permits a new recipient with a new key", async () => {
  const keys: string[] = []; let n = 0;
  const session = new ShareCreationSession({ makeKey: () => "key" + ++n, send: async (_body, key) => { keys.push(key); if (keys.length === 1) throw { status: 422, code: "VALIDATION_ERROR" }; return receipt; } });
  await expect(session.submit(payload)).rejects.toMatchObject({ status: 422 }); expect(session.hasPending).toBe(false);
  expect(await session.submit(JSON.stringify({ formId, formVersionId, email: "changed@catchsecu.test" }))).toEqual(receipt); expect(keys).toEqual(["key1", "key2"]);
});
test("429 after a lost response cannot reset the uncertain request", async () => {
  let n = 0; const keys: string[] = [];
  const session = new ShareCreationSession({ send: async (_body, key) => { keys.push(key); if (++n === 1) throw new TypeError("lost"); if (n === 2) throw { status: 429 }; return receipt; } });
  await expect(session.submit(payload)).rejects.toThrow("lost"); await expect(session.retry()).rejects.toMatchObject({ status: 429 });
  expect(session.hasPending).toBe(true); expect(await session.retry()).toEqual(receipt); expect(new Set(keys).size).toBe(1);
});
test("concurrent submits share one in-flight request", async () => {
  let resolve!: (value: unknown) => void, sends = 0;
  const session = new ShareCreationSession({ send: () => { sends++; return new Promise(done => { resolve = done; }); } });
  const a = session.submit(payload), b = session.submit(payload); expect(a).toBe(b); resolve(receipt); expect(await a).toEqual(receipt); expect(sends).toBe(1);
});
test.each([{}, { ...receipt, formVersionId: randomUUID() }])("malformed or unrelated successful body retains the pending request: %j", async response => {
  const session = new ShareCreationSession({ send: async () => response });
  await expect(session.submit(payload)).rejects.toThrow("초대 결과를 확인할 수 없습니다"); expect(session.hasPending).toBe(true);
});
