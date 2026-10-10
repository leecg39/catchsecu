import { describe, expect, test, vi } from "vitest";
import { protectHistoryNavigation, type HistoryNavigation } from "@/lib/history-guard";

function setup() {
  const answers: ((answer: boolean) => void)[] = [];
  const ask = vi.fn(() => new Promise<boolean>(resolve => answers.push(resolve)));
  const blocked = vi.fn(() => true);
  const navigation = new EventTarget() as HistoryNavigation;
  navigation.currentEntry = { key: "editing" };
  navigation.entries = () => [{ key: "before" }, { key: "editing" }, { key: "after" }];
  const emit = (key = "before", options: { cancelable?: boolean; sameDocument?: boolean; type?: string; info?: unknown } = {}) => {
    const event = Object.assign(new Event("navigate", { cancelable: options.cancelable ?? true }), {
      destination: { key, sameDocument: options.sameDocument ?? true }, navigationType: options.type ?? "traverse", info: options.info,
    });
    navigation.dispatchEvent(event);
    return event;
  };
  navigation.traverseTo = vi.fn((key, options) => {
    const event = emit(key, { info: options.info });
    if (!event.defaultPrevented) navigation.currentEntry = { key };
    return { committed: Promise.resolve(), finished: Promise.resolve() };
  });
  const stop = protectHistoryNavigation(navigation, blocked, ask);
  const settle = async (index: number, answer: boolean) => { answers[index](answer); await new Promise(resolve => setTimeout(resolve, 0)); };
  return { navigation, emit, ask, blocked, stop, settle };
}

describe("미저장 입력의 브라우저 기록 이동", () => {
  test.each(["before", "after"])("%s 이동 취소는 원래 기록 위치를 유지한다", async key => {
    const s = setup(); expect(s.emit(key).defaultPrevented).toBe(true);
    await s.settle(0, false);
    expect(s.navigation.currentEntry?.key).toBe("editing");
    expect(s.navigation.traverseTo).not.toHaveBeenCalled(); s.stop();
  });
  test("동의한 원래 기록으로 한 번 이동하고 다시 이탈하면 재확인한다", async () => {
    const s = setup(); s.emit("after"); await s.settle(0, true);
    expect(s.navigation.currentEntry?.key).toBe("after");
    expect(s.ask).toHaveBeenCalledTimes(1);
    expect(s.navigation.traverseTo).toHaveBeenCalledTimes(1);
    expect(s.emit("before").defaultPrevented).toBe(true);
    expect(s.ask).toHaveBeenCalledTimes(2); s.stop();
  });
  test("변경 없는 이동과 다른 문서·push·replace·새로고침은 가로채지 않는다", () => {
    const s = setup();
    for (const options of [{ sameDocument: false }, { type: "push" }, { type: "replace" }, { type: "reload" }]) expect(s.emit("before", options).defaultPrevented).toBe(false);
    s.blocked.mockReturnValue(false); expect(s.emit().defaultPrevented).toBe(false);
    expect(s.ask).not.toHaveBeenCalled(); s.stop();
  });
  test("새 이동 의사가 생기면 앞선 늦은 동의로 이동하지 않는다", async () => {
    const s = setup(); s.emit("before"); s.emit("after");
    await s.settle(0, true); expect(s.navigation.traverseTo).not.toHaveBeenCalled();
    await s.settle(1, true); expect(s.navigation.currentEntry?.key).toBe("after"); s.stop();
  });
  test.each(["unmount", "entry-changed", "entry-removed", "browser-escape"])("%s 이후 늦게 확인한 이동은 실행하지 않는다", async reason => {
    const s = setup(); s.emit();
    if (reason === "unmount") s.stop();
    if (reason === "entry-changed") s.navigation.currentEntry = { key: "after" };
    if (reason === "entry-removed") s.navigation.entries = () => [{ key: "editing" }];
    if (reason === "browser-escape") expect(s.emit("after", { cancelable: false }).defaultPrevented).toBe(false);
    await s.settle(0, true); expect(s.navigation.traverseTo).not.toHaveBeenCalled(); s.stop();
  });
  test("승인 후 이동 실패는 처리하고 다음 이동을 계속 보호한다", async () => {
    const s = setup();
    vi.mocked(s.navigation.traverseTo).mockImplementationOnce(() => ({ committed: Promise.reject(new DOMException("aborted", "AbortError")), finished: Promise.reject(new DOMException("aborted", "AbortError")) }));
    s.emit(); await s.settle(0, true);
    expect(s.navigation.currentEntry?.key).toBe("editing");
    expect(s.emit("after").defaultPrevented).toBe(true); s.stop();
  });
});
