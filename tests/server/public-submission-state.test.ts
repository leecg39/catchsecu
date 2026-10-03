import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { PublicSubmissionSession } from "@/lib/public-submission";

const receipt = () => ({ id: randomUUID(), submittedAt: new Date().toISOString(), status: "submitted" });
test("성공 응답 유실 뒤에는 원래 본문/키로 재확인하며 변경 본문을 추가 제출하지 않는다", async () => {
  const result = receipt(), send = vi.fn().mockRejectedValueOnce(new TypeError("success response lost")).mockResolvedValue(result);
  const session = new PublicSubmissionSession({ send, makeKey: () => "original-key" });
  await expect(session.submit("original answers and file proof")).rejects.toThrow(); expect(session.hasPending).toBe(true);
  await expect(session.submit("changed answers")).rejects.toThrow("이전 제출 결과"); expect(send).toHaveBeenCalledTimes(1);
  await expect(session.retry()).resolves.toEqual(result); expect(send.mock.calls[0]).toEqual(send.mock.calls[1]); expect(session.hasPending).toBe(false);
});
test("확정된 최초 입력 거부 뒤에는 고친 본문을 새 키로 제출할 수 있다", async () => {
  const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error("required answer"), { status: 422, code: "REQUIRED_ANSWER" })).mockResolvedValue(receipt());
  let sequence = 0; const session = new PublicSubmissionSession({ send, makeKey: () => String(++sequence) });
  await expect(session.submit("missing")).rejects.toThrow(); expect(session.hasPending).toBe(false); await session.submit("corrected");
  expect(send.mock.calls.map(([payload, key]) => [payload, key])).toEqual([["missing", "1"], ["corrected", "2"]]);
});
test("이미 유실된 요청의 재확인 429는 이전 성공 가능성을 없애거나 새 요청 키를 만들지 않는다", async () => {
  const send = vi.fn().mockRejectedValueOnce(new TypeError("lost")).mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 })).mockResolvedValue(receipt());
  const session = new PublicSubmissionSession({ send }); await expect(session.submit("original")).rejects.toThrow(); await expect(session.retry()).rejects.toThrow();
  expect(session.hasPending).toBe(true); await expect(session.submit("edited")).rejects.toThrow(); await session.retry();
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]); expect(send.mock.calls[1]).toEqual(send.mock.calls[2]);
});
test("201의 잘못된 응답 본문은 제출 완료로 표시하지 않고 같은 요청으로 확인한다", async () => {
  const send = vi.fn().mockResolvedValueOnce({ error: { code: "INVALID_RESPONSE" } }).mockResolvedValue(receipt()), session = new PublicSubmissionSession({ send });
  await expect(session.submit("original")).rejects.toThrow("접수 결과"); expect(session.hasPending).toBe(true); await session.retry();
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
});
test("동시에 누른 제출/재확인은 하나의 진행 Promise와 한 번의 HTTP 요청을 공유한다", async () => {
  let resolve!: (value: unknown) => void; const pending = new Promise(done => { resolve = done; });
  const send = vi.fn(() => pending), session = new PublicSubmissionSession({ send });
  const first = session.submit("one"), second = session.retry(); expect(second).toBe(first); expect(send).toHaveBeenCalledTimes(1);
  resolve(receipt()); await first;
});
test("완료된 화면의 후속 제출 이벤트는 접수 영수증을 유지하고 두 번째 응답을 생성하지 않는다", async () => {
  const result = receipt(), send = vi.fn().mockResolvedValue(result), session = new PublicSubmissionSession({ send });
  expect(await session.submit("one")).toEqual(result); expect(await session.submit("changed")).toEqual(result); expect(await session.retry()).toEqual(result);
  expect(send).toHaveBeenCalledTimes(1);
});
