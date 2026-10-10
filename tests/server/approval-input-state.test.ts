import { expect, test } from "vitest";
import { approvalInputDirty, createApprovalInputState, updateApprovalInput } from "@/lib/approval-input";

test("승인 요청 템플릿은 최초 기준값이며 메시지와 증빙 변경만 dirty로 표시한다", () => {
  const initial = createApprovalInputState({ message: "기본 승인 문구" });
  expect(approvalInputDirty(initial)).toBe(false);
  const message = updateApprovalInput(initial, "message", "검토 부탁드립니다.");
  const reference = updateApprovalInput(initial, "reference", "LEGAL-42");
  expect(approvalInputDirty(message)).toBe(true);
  expect(approvalInputDirty(reference)).toBe(true);
  expect(message.baseline.message).toBe("기본 승인 문구");
});

test("검토 의견은 승인 경합 중에도 현재 입력과 빈 기준값을 함께 보존한다", () => {
  const initial = createApprovalInputState();
  const changed = updateApprovalInput(initial, "reason", "입력 중인 검토 의견");
  expect(changed.values.reason).toBe("입력 중인 검토 의견");
  expect(changed.baseline.reason).toBe("");
  expect(approvalInputDirty(changed)).toBe(true);
});

test("사용자가 모든 값을 기준값으로 되돌리면 이탈 경고가 해제된다", () => {
  const initial = createApprovalInputState({ message: "기본 문구", reference: "REF-1" });
  const changed = updateApprovalInput(initial, "message", "다른 문구");
  const restored = updateApprovalInput(changed, "message", "기본 문구");
  expect(approvalInputDirty(restored)).toBe(false);
});
