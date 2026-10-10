import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AuthorAssetUploadInfo } from "@/contracts/author-assets";
import type { AuthorAssetUploadCache } from "@/lib/author-assets";
import { AuthorAssetUploadSession, type AuthorAssetEditContext } from "@/components/forms/AuthorAssetUpload";

const transport = vi.hoisted(() => ({ upload: vi.fn(), discard: vi.fn() }));
vi.mock("@/lib/author-assets", () => ({ uploadAuthorAsset: transport.upload, discardAuthorAssetUpload: transport.discard }));
const info: AuthorAssetUploadInfo = { id: "60000000-0000-4000-8000-000000000001", purpose: "QUESTION_MATERIAL", name: "guide.pdf", mime: "application/pdf",
  size: 64, sha256: "a".repeat(64), status: "ready", version: 3, expiresAt: "2026-10-31T00:00:00Z", usage: { usedBytes: 64, limitBytes: 1024 } };
const file = new File(["%PDF-1.7\n%%EOF"], "guide.pdf", { type: "application/pdf" });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function setup() {
  const snapshot = {}, release = vi.fn();
  const context: AuthorAssetEditContext = { serviceId: "service", capture: vi.fn(() => snapshot), isCurrent: vi.fn(value => value === snapshot), begin: vi.fn(() => release), register: vi.fn() };
  const events = { context, purpose: "QUESTION_MATERIAL" as const, isCurrent: vi.fn(() => true), onComplete: vi.fn(() => true),
    started: vi.fn(), status: vi.fn(), success: vi.fn(), stale: vi.fn(), error: vi.fn(), done: vi.fn() };
  return { session: new AuthorAssetUploadSession(), events, release, context };
}
beforeEach(() => { transport.upload.mockReset(); transport.discard.mockReset().mockResolvedValue(undefined); });
afterEach(() => vi.restoreAllMocks());

test("ready completion attaches once, registers metadata, and releases the save lock", async () => {
  const { session, events, release, context } = setup(); transport.upload.mockResolvedValue(info);
  await session.run(file, events);
  expect(events.onComplete).toHaveBeenCalledExactlyOnceWith(info); expect(context.register).toHaveBeenCalledExactlyOnceWith(info);
  expect(events.success).toHaveBeenCalledOnce(); expect(events.done).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce(); expect(transport.discard).not.toHaveBeenCalled();
});
test("retry after a lost response keeps the same upload cache and idempotency key", async () => {
  const { session, events, release } = setup(); let original: { current: AuthorAssetUploadCache | undefined } | undefined;
  transport.upload.mockImplementationOnce(async (_file, _target, cache) => { original = cache; cache.current = { fingerprint: "bytes", key: "same-key", upload: { ...info, status: "uploaded" } }; throw new Error("응답 유실"); })
    .mockImplementationOnce(async (_file, _target, cache) => { expect(cache).toBe(original); expect(cache.current.key).toBe("same-key"); return info; });
  await session.run(file, events); expect(events.error).toHaveBeenCalledWith("응답 유실"); expect(events.onComplete).not.toHaveBeenCalled();
  await session.run(file, events); expect(events.success).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledTimes(2); expect(transport.discard).not.toHaveBeenCalled();
});
test.each(["editor", "target"])("late completion after %s change is discarded without replacing old metadata", async change => {
  const { session, events, release, context } = setup(), pending = deferred<AuthorAssetUploadInfo>(); transport.upload.mockReturnValue(pending.promise);
  const work = session.run(file, events);
  if (change === "editor") vi.mocked(context.isCurrent).mockReturnValue(false); else events.isCurrent.mockReturnValue(false);
  pending.resolve(info); await work;
  expect(events.onComplete).not.toHaveBeenCalled(); expect(context.register).not.toHaveBeenCalled(); expect(transport.discard).toHaveBeenCalledWith(info);
  expect(events.stale).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
});
test("deleting/off/unmount cancels immediately, allows a new attempt, and ignores the old completion", async () => {
  const { session, events, release } = setup(), first = deferred<AuthorAssetUploadInfo>(), second = deferred<AuthorAssetUploadInfo>();
  const caches: unknown[] = []; transport.upload.mockImplementationOnce((_file, _target, cache) => { caches.push(cache); return first.promise; })
    .mockImplementationOnce((_file, _target, cache) => { caches.push(cache); return second.promise; });
  const a = session.run(file, events); session.cancel(); expect(release).toHaveBeenCalledOnce();
  const b = session.run(file, events); expect(caches[0]).not.toBe(caches[1]);
  first.resolve(info); await a; expect(events.done).not.toHaveBeenCalled(); expect(events.onComplete).not.toHaveBeenCalled();
  const replacement = { ...info, id: "60000000-0000-4000-8000-000000000002" }; second.resolve(replacement); await b;
  expect(events.onComplete).toHaveBeenCalledExactlyOnceWith(replacement); expect(release).toHaveBeenCalledTimes(2); expect(transport.discard).toHaveBeenCalledExactlyOnceWith(info);
});
test("two immediate starts only allocate one upload and one save lock", async () => {
  const { session, events, release } = setup(), pending = deferred<AuthorAssetUploadInfo>(); transport.upload.mockReturnValue(pending.promise);
  const a = session.run(file, events), b = session.run(file, events); await b;
  expect(transport.upload).toHaveBeenCalledOnce(); pending.resolve(info); await a; expect(release).toHaveBeenCalledOnce();
});
test("an active save prevents starting or allocating an upload", async () => {
  const { session, events, context } = setup(); vi.mocked(context.begin).mockReturnValue(undefined);
  await session.run(file, events); expect(transport.upload).not.toHaveBeenCalled(); expect(events.started).not.toHaveBeenCalled(); expect(events.error).toHaveBeenCalledOnce();
});
test("a rejected destination discards the new ready asset and leaves existing attachment untouched", async () => {
  const { session, events, context } = setup(); transport.upload.mockResolvedValue(info); events.onComplete.mockReturnValue(false);
  await session.run(file, events); expect(context.register).not.toHaveBeenCalled(); expect(events.stale).toHaveBeenCalledOnce(); expect(transport.discard).toHaveBeenCalledWith(info);
});
test("discard 409 is best effort and does not turn cancellation into an unhandled failure", async () => {
  const { session, events, release } = setup(); transport.discard.mockRejectedValue(Object.assign(new Error("pinned"), { status: 409 }));
  transport.upload.mockImplementationOnce(async (_file, _target, cache) => { cache.current = { fingerprint: "bytes", key: "key", upload: info }; throw new Error("연결 실패"); });
  await session.run(file, events); session.cancel(); await Promise.resolve(); expect(transport.discard).toHaveBeenCalledWith(info); expect(release).toHaveBeenCalledOnce();
});
