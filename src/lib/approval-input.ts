export type ApprovalInputValues = { message: string; reference: string; reason: string };
export type ApprovalInputState = { baseline: ApprovalInputValues; values: ApprovalInputValues };

export function createApprovalInputState(values?: Partial<ApprovalInputValues>): ApprovalInputState {
  const initial = { message: values?.message ?? "", reference: values?.reference ?? "", reason: values?.reason ?? "" };
  return { baseline: initial, values: initial };
}

export function updateApprovalInput(state: ApprovalInputState, field: keyof ApprovalInputValues, value: string): ApprovalInputState {
  return { ...state, values: { ...state.values, [field]: value } };
}

export function approvalInputDirty(state: ApprovalInputState) {
  return state.values.message !== state.baseline.message
    || state.values.reference !== state.baseline.reference
    || state.values.reason !== state.baseline.reason;
}
