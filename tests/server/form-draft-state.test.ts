import { afterEach, expect, test, vi } from "vitest";
import { FormDraftSession, type FormDraftValue } from "@/lib/form-draft";
import type { FormRecord } from "@/contracts/forms";

const value: FormDraftValue = { serviceId: "service", title: "초안", content: { body: "원본", questions: [{ id: "question", type: "단문형 답변", label: "이름", required: true }],
  consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 50 } };
function record(input = value, version = 1): FormRecord {
  return { ...structuredClone(input), id: "form", serviceName: "서비스", ownerName: "소유자", version, status: "draft", createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z",
    hasDraft: true, draftNumber: 1, published: false, favorite: false, publication: null };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const sessions: FormDraftSession[] = [];
function session(persist = vi.fn(async (saved: FormRecord | undefined, next: FormDraftValue, _key: string) => { void _key; return record(next, (saved?.version ?? 0) + 1); }), initial: FormRecord | null = record()) {
  let keys = 0;
  const s = new FormDraftSession({ initial: initial ?? undefined, seed: value, persist, makeKey: () => "request-key-" + ++keys,
    validate: draft => { if (!draft.title.trim()) throw new Error("제목 필요"); return { ...draft, title: draft.title.trim() }; } });
  sessions.push(s); s.start(); return { s, persist };
}
afterEach(() => { sessions.forEach(s => s.stop()); sessions.length = 0; vi.useRealTimers(); });

test("입력은 1.2초 뒤 저장하고 그 전의 추가 입력으로 대기 시간을 갱신한다", async () => {
  vi.useFakeTimers(); const { s, persist } = session();
  s.edit({ ...value, title: "첫 입력" }); await vi.advanceTimersByTimeAsync(900);
  s.edit({ ...value, title: "최종 입력" }); await vi.advanceTimersByTimeAsync(1199); expect(persist).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(persist).toHaveBeenCalledTimes(1); expect(s.getSnapshot().record?.title).toBe("최종 입력");
  expect(s.getSnapshot().dirty).toBe(false);
});
test("저장 중 입력을 보존하고 후속 요청은 확인된 최신 version으로 직렬 저장한다", async () => {
  const a = deferred<FormRecord>(), b = deferred<FormRecord>();
  const persist = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise), { s } = session(persist);
  s.edit({ ...value, title: "첫 저장" }); const saved = s.save();
  s.edit({ ...value, title: "추가 입력", content: { ...value.content, body: "저장 중 작성" } });
  const duplicate = s.save(); expect(persist).toHaveBeenCalledTimes(1);
  a.resolve(record({ ...value, title: "첫 저장" },2)); await Promise.resolve(); await Promise.resolve();
  expect(s.getSnapshot().value.title).toBe("추가 입력"); expect(persist).toHaveBeenCalledTimes(2);
  expect(persist.mock.calls[1][0].version).toBe(2);
  b.resolve(record(s.getSnapshot().value,3)); await Promise.all([saved, duplicate]);
  expect(s.getSnapshot().record?.version).toBe(3); expect(s.getSnapshot().value.content.body).toBe("저장 중 작성"); expect(s.getSnapshot().dirty).toBe(false);
});
test("응답 유실은 동일 키/본문/version을 재전송한 뒤 추가 입력을 새 키로 저장한다", async () => {
  let committed: FormRecord;
  const persist = vi.fn(async (saved: FormRecord | undefined, next: FormDraftValue, _key: string) => {
    void _key;
    if (persist.mock.calls.length === 1) { committed = record(next,2); throw new TypeError("응답 유실"); }
    if (persist.mock.calls.length === 2) return committed;
    return record(next, (saved?.version ?? 0)+1);
  });
  const { s } = session(persist); s.edit({ ...value, title: "반영됨" }); expect(await s.save()).toBeUndefined();
  s.edit({ ...value, title: "추가 입력" }); expect(s.getSnapshot().phase).toBe("error");
  await s.save(); expect(persist).toHaveBeenCalledTimes(3); expect(persist.mock.calls[0]).toEqual(persist.mock.calls[1]);
  expect(persist.mock.calls[2][0]?.version).toBe(2); expect(persist.mock.calls[2][2]).not.toBe(persist.mock.calls[1][2]);
  expect(s.getSnapshot().record?.title).toBe("추가 입력");
});
test("409는 내 입력을 유지하고 자동 덮어쓰기를 멈춘다; 최신본을 불러온 뒤 새 version을 쓴다", async () => {
  vi.useFakeTimers(); const persist = vi.fn().mockRejectedValueOnce(Object.assign(new Error("다른 기기 변경"),{ status:409 })).mockImplementation(async (saved, next) => record(next,saved.version+1));
  const { s } = session(persist); s.edit({ ...value, title: "내 입력" }); await s.save();
  expect(s.getSnapshot().phase).toBe("conflict"); expect(s.getSnapshot().value.title).toBe("내 입력");
  s.edit({ ...value, title: "충돌 뒤 추가 입력" }); await vi.advanceTimersByTimeAsync(4000); await s.save(); expect(persist).toHaveBeenCalledTimes(1);
  s.load(record({ ...value,title:"다른 기기" },7)); s.edit({ ...value,title:"최신본에서 변경" }); await s.save();
  expect(persist.mock.calls[1][0].version).toBe(7); expect(s.getSnapshot().record?.version).toBe(8);
});
test("미완성 입력은 보내지 않고 입력을 마치면 자동저장한다", async () => {
  vi.useFakeTimers(); const { s, persist } = session(); s.edit({ ...value,title:"" }); await vi.advanceTimersByTimeAsync(1200);
  expect(s.getSnapshot().phase).toBe("invalid"); expect(persist).not.toHaveBeenCalled();
  s.edit({ ...value,title:"완성" }); await vi.advanceTimersByTimeAsync(1200); expect(persist).toHaveBeenCalledTimes(1);
});
test("최초 생성 중 추가 입력은 첫 ID를 사용해 변경하고 두 번째 폼을 만들지 않는다", async () => {
  const a = deferred<FormRecord>(); const persist = vi.fn().mockReturnValueOnce(a.promise).mockImplementation(async (saved,next) => record(next,saved.version+1));
  const { s } = session(persist, null); s.edit({ ...value,title:"새 폼" }); const saved = s.save();
  s.edit({ ...value,title:"추가 입력" }); a.resolve(record({ ...value,title:"새 폼" },1)); await saved;
  expect(persist.mock.calls[0][0]).toBeUndefined(); expect(persist.mock.calls[1][0].id).toBe("form"); expect(s.getSnapshot().record?.version).toBe(2);
});
test("편집기를 떠나면 예약된 자동저장을 취소한다", async () => {
  vi.useFakeTimers(); const { s, persist } = session(); s.edit({ ...value,title:"대기" }); s.stop(); await vi.advanceTimersByTimeAsync(5000);
  expect(persist).not.toHaveBeenCalled();
});
test("변경 없는 저장은 쓰지 않고 현재 표시 갱신을 명시한 저장만 수행한다", async () => {
  const { s,persist } = session(); await s.save(); expect(persist).not.toHaveBeenCalled(); await s.save(true); expect(persist).toHaveBeenCalledTimes(1); expect(s.getSnapshot().record?.version).toBe(2);
});
test("서버가 정규화한 값은 입력이 그대로일 때만 편집 상태에 반영한다", async () => {
  const { s,persist } = session(); s.edit({ ...value,title:"  제목  " }); await s.save(); expect(persist.mock.calls[0][1].title).toBe("제목");
  expect(s.getSnapshot().value.title).toBe("제목"); expect(s.getSnapshot().dirty).toBe(false);
});
test("서버가 확정 거부한 요청의 재시도는 새 키를 사용한다", async () => {
  const persist = vi.fn().mockRejectedValueOnce(Object.assign(new Error("선택한 문서 종료"),{ status:422 })).mockImplementation(async (saved,next) => record(next,saved.version+1));
  const { s } = session(persist); s.edit({ ...value,title:"입력" }); await s.save(); s.edit({ ...value,title:"입력 수정" }); await s.save();
  expect(persist.mock.calls[1][2]).not.toBe(persist.mock.calls[0][2]); expect(s.getSnapshot().record?.title).toBe("입력 수정");
});
test("입력을 저장본으로 되돌리면 예약을 취소하고 불필요한 개정을 만들지 않는다", async () => {
  vi.useFakeTimers(); const { s,persist } = session(); s.edit({ ...value,title:"임시 입력" }); s.edit(value); await vi.advanceTimersByTimeAsync(5000);
  expect(persist).not.toHaveBeenCalled(); expect(s.getSnapshot().dirty).toBe(false); expect(s.getSnapshot().phase).toBe("saved");
});
test("최초 생성 응답이 유실되면 서비스 선택을 고정한 채 입력만 이어 저장한다", async () => {
  let committed: FormRecord;
  const persist = vi.fn(async (saved: FormRecord | undefined, next: FormDraftValue, _key: string) => {
    void _key;
    if (persist.mock.calls.length === 1) { committed = record(next,1); throw new TypeError("생성 응답 유실"); }
    if (persist.mock.calls.length === 2) return committed;
    return record(next,(saved?.version ?? 0)+1);
  });
  const { s } = session(persist,null); s.edit({ ...value,title:"첫 생성" }); await s.save();
  s.edit({ ...s.getSnapshot().value,serviceId:"another-service",title:"추가 입력" });
  expect(s.getSnapshot().value.serviceId).toBe(value.serviceId); await s.save();
  expect(persist.mock.calls[0]).toEqual(persist.mock.calls[1]); expect(persist.mock.calls[2][0]?.id).toBe("form");
  expect(s.getSnapshot().record?.serviceId).toBe(value.serviceId); expect(s.getSnapshot().record?.title).toBe("추가 입력");
});
test("최초 생성이 확정 거부되면 다른 서비스로 새 생성 요청을 보낼 수 있다", async () => {
  const persist = vi.fn().mockRejectedValueOnce(Object.assign(new Error("서비스 쓰기 권한 없음"),{ status:403 })).mockImplementation(async (_saved,next) => record(next,1));
  const { s } = session(persist,null); s.edit({ ...value,title:"첫 시도" }); await s.save();
  s.edit({ ...s.getSnapshot().value,serviceId:"another-service",title:"다른 서비스" }); await s.save();
  expect(persist.mock.calls[1][0]).toBeUndefined(); expect(persist.mock.calls[1][2]).not.toBe(persist.mock.calls[0][2]); expect(s.getSnapshot().record?.serviceId).toBe("another-service");
});
