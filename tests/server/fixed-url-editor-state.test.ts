import { expect, test } from "vitest";
import { createFixedUrlEditorState, fixedUrlEditorDirty, fixedUrlEditorReducer } from "@/lib/fixed-url-editor";

test("기존 고정 URL은 원본과 같은 동안 깨끗하고 이름이나 연결 폼 변경을 감지한다", () => {
  const initial = createFixedUrlEditorState({ name: "기존 주소", slug: "existing-url", formId: "form-a" });
  expect(fixedUrlEditorDirty(initial)).toBe(false);

  const renamed = fixedUrlEditorReducer(initial, { type: "change", field: "name", value: "수정 주소" });
  expect(fixedUrlEditorDirty(renamed)).toBe(true);
  expect(renamed.baseline).toEqual(initial.baseline);

  const retargeted = fixedUrlEditorReducer(initial, { type: "change", field: "formId", value: "form-b" });
  expect(fixedUrlEditorDirty(retargeted)).toBe(true);
});

test("신규 주소의 사용자가 입력한 slug도 이탈 보호 대상이다", () => {
  const initial = createFixedUrlEditorState();
  const changed = fixedUrlEditorReducer(initial, { type: "change", field: "slug", value: "my-fixed-url" });
  expect(fixedUrlEditorDirty(changed)).toBe(true);
});

test("버전 충돌 뒤 입력을 계속 바꿔도 최신본 적용 전까지 충돌 잠금을 유지한다", () => {
  const initial = createFixedUrlEditorState({ name: "내 입력", slug: "locked-url", formId: "form-a" });
  const conflicted = fixedUrlEditorReducer(initial, { type: "conflict" });
  const changed = fixedUrlEditorReducer(conflicted, { type: "change", field: "name", value: "보존할 내 입력" });
  expect(changed.conflict).toBe(true);
  expect(changed.values.name).toBe("보존할 내 입력");
  expect(changed.baseline.name).toBe("내 입력");
  expect(fixedUrlEditorDirty(changed)).toBe(true);
});
