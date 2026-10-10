import { beforeEach, expect, test, vi } from "vitest";
import type { AuthorAssetUploadInfo } from "@/contracts/author-assets";
import type { AuthorAssetUploadCache } from "@/lib/author-assets";
import { AuthorAssetUploadSession, type AuthorAssetEditContext } from "@/components/forms/AuthorAssetUpload";
import { confirmQuestionImageRemoval } from "@/components/forms/QuestionImageEditor";

const transport = vi.hoisted(() => ({ upload: vi.fn(), discard: vi.fn() }));
vi.mock("@/lib/author-assets", () => ({ uploadAuthorAsset: transport.upload, discardAuthorAssetUpload: transport.discard }));
type State = NonNullable<ReturnType<Parameters<typeof confirmQuestionImageRemoval>[0]>>;
const oldKey = "70000000-0000-4000-8000-000000000090";
const image: AuthorAssetUploadInfo = { id: "70000000-0000-4000-8000-000000000091", purpose: "QUESTION_IMAGE", name: "question.png", mime: "image/png",
  size: 64, sha256: "a".repeat(64), status: "ready", version: 3, expiresAt: "2026-10-31T00:00:00Z", usage: { usedBytes: 64, limitBytes: 1024 } };
const file = new File([new Uint8Array([137, 80, 78, 71])], "question.png", { type: "image/png" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function destination() {
  let revision = {}, state: State | undefined;
  const changed = vi.fn((assetKey: string | null) => { if (state) state = { ...state, assetKey }; }), release = vi.fn();
  const context: AuthorAssetEditContext = { serviceId: "service-a", capture: () => revision, isCurrent: snapshot => revision === snapshot,
    begin: vi.fn(() => release), register: vi.fn() };
  state = { questionId: "question-a", assetKey: oldKey, disabled: false, context, onChange: changed };
  return { read: () => state, patch: (patch: Partial<State>) => { state = { ...state!, ...patch }; }, unmount: () => { state = undefined; },
    revise: () => { revision = {}; }, changed, context, release };
}
beforeEach(() => { transport.upload.mockReset(); transport.discard.mockReset().mockResolvedValue(undefined); });

test.each([false, true])("cancelled remove/off (%s) preserves the existing image without emitting a patch", async turnOff => {
  const target = destination(), confirm = vi.fn(async () => false);
  expect(await confirmQuestionImageRemoval(target.read, confirm, turnOff)).toBe("cancelled");
  expect(target.changed).not.toHaveBeenCalled(); expect(target.read()?.assetKey).toBe(oldKey);
});
test.each([false, true])("confirmed remove/off (%s) emits explicit null once and does not resurrect the prior key", async turnOff => {
  const target = destination(), confirm = vi.fn(async () => true);
  expect(await confirmQuestionImageRemoval(target.read, confirm, turnOff)).toBe("removed");
  expect(target.changed).toHaveBeenCalledExactlyOnceWith(null); expect(target.read()?.assetKey).toBeNull();
  // A subsequently enabled empty feature has no hidden previous key to restore.
  expect(await confirmQuestionImageRemoval(target.read, confirm, true)).toBe("removed");
  expect(target.changed).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledOnce();
});
test.each(["question", "replacement", "service", "save-state", "read-only", "unmount"])("confirmation cannot delete after %s changes", async change => {
  const target = destination(), pending = deferred<boolean>(), work = confirmQuestionImageRemoval(target.read, () => pending.promise, true);
  if (change === "question") target.patch({ questionId: "question-b" });
  else if (change === "replacement") target.patch({ assetKey: image.id });
  else if (change === "service") target.patch({ context: { ...target.context, serviceId: "service-b" } });
  else if (change === "save-state") target.revise();
  else if (change === "read-only") target.patch({ disabled: true });
  else target.unmount();
  pending.resolve(true); expect(["stale", "blocked"]).toContain(await work); expect(target.changed).not.toHaveBeenCalled();
});
test("read-only or in-flight upload prevents even opening a destructive confirmation", async () => {
  const target = destination(), confirm = vi.fn(async () => true); target.patch({ disabled: true });
  expect(await confirmQuestionImageRemoval(target.read, confirm, false)).toBe("blocked");
  expect(confirm).not.toHaveBeenCalled(); expect(target.changed).not.toHaveBeenCalled();
});

function uploading(target = destination()) {
  const session = new AuthorAssetUploadSession();
  const events = { purpose: "QUESTION_IMAGE" as const, context: target.context,
    isCurrent: () => target.read()?.questionId === "question-a" && target.read()?.assetKey === oldKey && !target.read()?.disabled,
    onComplete: vi.fn((upload: AuthorAssetUploadInfo) => { target.changed(upload.id); return true; }),
    started: vi.fn(), status: vi.fn(), success: vi.fn(), stale: vi.fn(), error: vi.fn(), done: vi.fn() };
  return { ...target, session, events };
}
test("question image replacement attaches only after ready, registers provider metadata and releases its save barrier", async () => {
  const target = uploading(), pending = deferred<AuthorAssetUploadInfo>(); transport.upload.mockReturnValue(pending.promise);
  const work = target.session.run(file, target.events);
  expect(target.read()?.assetKey).toBe(oldKey); expect(target.release).not.toHaveBeenCalled();
  expect(transport.upload.mock.calls[0][1]).toEqual({ serviceId: "service-a", purpose: "QUESTION_IMAGE" });
  pending.resolve(image); await work;
  expect(target.changed).toHaveBeenCalledExactlyOnceWith(image.id); expect(target.context.register).toHaveBeenCalledExactlyOnceWith(image);
  expect(target.release).toHaveBeenCalledOnce(); expect(transport.discard).not.toHaveBeenCalled();
});
test.each(["question", "replacement", "save-state", "read-only", "unmount", "cancel"])("late QUESTION_IMAGE upload after %s never replaces the destination", async change => {
  const target = uploading(), pending = deferred<AuthorAssetUploadInfo>(); transport.upload.mockReturnValue(pending.promise);
  const work = target.session.run(file, target.events);
  if (change === "question") target.patch({ questionId: "question-b" });
  else if (change === "replacement") target.patch({ assetKey: "newer-image" });
  else if (change === "save-state") target.revise();
  else if (change === "read-only") target.patch({ disabled: true });
  else if (change === "unmount") target.unmount();
  else target.session.cancel();
  pending.resolve(image); await work;
  expect(target.changed).not.toHaveBeenCalled(); expect(target.context.register).not.toHaveBeenCalled();
  expect(transport.discard).toHaveBeenCalledWith(image); expect(target.release).toHaveBeenCalledOnce();
});
test("failed image replacement preserves the old key and retries using the same upload cache", async () => {
  const target = uploading(); let cacheBefore: { current: AuthorAssetUploadCache | undefined } | undefined;
  transport.upload.mockImplementationOnce(async (_file, _target, cache) => { cacheBefore = cache; cache.current = { fingerprint: "question-bytes", key: "same-request", upload: { ...image, status: "uploaded" } }; throw new Error("응답 유실"); })
    .mockImplementationOnce(async (_file, _target, cache) => { expect(cache).toBe(cacheBefore); expect(cache.current.key).toBe("same-request"); return image; });
  await target.session.run(file, target.events);
  expect(target.read()?.assetKey).toBe(oldKey); expect(target.changed).not.toHaveBeenCalled();
  await target.session.run(file, target.events);
  expect(target.changed).toHaveBeenCalledExactlyOnceWith(image.id); expect(target.release).toHaveBeenCalledTimes(2);
});
