import { afterEach, expect, test, vi } from "vitest";
import { FormDraftSession, type FormDraftValue } from "@/lib/form-draft";
import type { FormRecord } from "@/contracts/forms";
const value: FormDraftValue = { serviceId: "service", title: "초안", content: { body: "원본", questions: [{ id: "question", type: "단문형 답변", label: "이름", required: true }], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 50 } };
function record(input = value, version = 1): FormRecord { return { ...structuredClone(input), id: "form", serviceName: "서비스", ownerName: "소유자", version, status: "draft", createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z", hasDraft: true, draftNumber: 1, published: false, favorite: false, publication: null }; }
const sessions: FormDraftSession[] = [];
function setup(persist = vi.fn(async (saved: FormRecord | undefined, next: FormDraftValue) => record(next, (saved?.version ?? 0) + 1))) {
  const session = new FormDraftSession({ initial: record(), seed: value, persist, validate: value => value }); sessions.push(session); session.start(); return { session, persist };
}
afterEach(() => { sessions.forEach(session => session.stop()); sessions.length = 0; vi.useRealTimers(); });

test("upload hold cancels the queued autosave and blocks manual/force/navigation save until release", async () => {
  vi.useFakeTimers(); const { session, persist } = setup(); session.edit({ ...value, title: "업로드 전" }); const before = session.getSnapshot(), release = session.pauseSaving();
  expect(release).toBeTypeOf("function"); expect(session.getSnapshot()).toBe(before);
  session.edit({ ...value, title: "업로드 중 수정" }); await vi.advanceTimersByTimeAsync(5000);
  expect(await session.save()).toBeUndefined(); expect(await session.save(true)).toBeUndefined(); expect(persist).not.toHaveBeenCalled();
  release!(); await vi.advanceTimersByTimeAsync(1199); expect(persist).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1);
  expect(persist).toHaveBeenCalledOnce(); expect(session.getSnapshot().record?.title).toBe("업로드 중 수정");
});
test("nested uploads resume only after the final idempotent release", async () => {
  vi.useFakeTimers(); const { session, persist } = setup(), a = session.pauseSaving()!, b = session.pauseSaving()!;
  session.edit({ ...value, title: "최종 입력" }); a(); a(); await vi.advanceTimersByTimeAsync(5000); expect(persist).not.toHaveBeenCalled();
  b(); b(); await vi.advanceTimersByTimeAsync(1200); expect(persist).toHaveBeenCalledOnce();
});
test("hold cannot race an in-flight save and reload cannot destroy an upload draft", async () => {
  let resolve!: (record: FormRecord) => void; const pending = new Promise<FormRecord>(done => { resolve = done; });
  const { session } = setup(vi.fn(() => pending)); session.edit({ ...value, title: "저장" }); const work = session.save(); expect(session.pauseSaving()).toBeUndefined();
  resolve(record({ ...value, title: "저장" }, 2)); await work; const release = session.pauseSaving()!;
  expect(() => session.load(record())).toThrow("업로드"); release(); expect(() => session.load(record())).not.toThrow();
});
test("unmount stops autosave even when a cancelled upload releases its lock afterward", async () => {
  vi.useFakeTimers(); const { session, persist } = setup(), release = session.pauseSaving()!;
  session.edit({ ...value, title: "떠날 입력" }); session.stop(); release(); await vi.advanceTimersByTimeAsync(5000); expect(persist).not.toHaveBeenCalled();
});
test("a hold preserves an uncertain retry payload/key and a 409 remains blocked after release", async () => {
  const persist = vi.fn().mockRejectedValueOnce(new Error("응답 유실")).mockRejectedValueOnce(Object.assign(new Error("충돌"), { status: 409 }));
  const { session } = setup(persist); session.edit({ ...value, title: "저장 대기" }); await session.save(); const release = session.pauseSaving()!;
  session.edit({ ...value, title: "추가 입력" }); await session.save(); expect(persist).toHaveBeenCalledOnce(); release(); await session.save();
  expect(persist.mock.calls[1]).toEqual(persist.mock.calls[0]); const end = session.pauseSaving()!; end(); await session.save(); expect(persist).toHaveBeenCalledTimes(2); expect(session.getSnapshot().value.title).toBe("추가 입력");
});
