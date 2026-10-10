export type FixedUrlEditorValues = { name: string; slug: string; formId: string };
export type FixedUrlEditorState = { baseline: FixedUrlEditorValues; values: FixedUrlEditorValues; conflict: boolean };
export type FixedUrlEditorAction =
  | { type: "change"; field: keyof FixedUrlEditorValues; value: string }
  | { type: "conflict" };

export function createFixedUrlEditorState(values?: Partial<FixedUrlEditorValues>): FixedUrlEditorState {
  const initial = { name: values?.name ?? "", slug: values?.slug ?? "", formId: values?.formId ?? "" };
  return { baseline: initial, values: initial, conflict: false };
}

export function fixedUrlEditorReducer(state: FixedUrlEditorState, action: FixedUrlEditorAction): FixedUrlEditorState {
  if (action.type === "conflict") return { ...state, conflict: true };
  return { ...state, values: { ...state.values, [action.field]: action.value } };
}

export function fixedUrlEditorDirty(state: FixedUrlEditorState) {
  return state.values.name !== state.baseline.name
    || state.values.slug !== state.baseline.slug
    || state.values.formId !== state.baseline.formId;
}
