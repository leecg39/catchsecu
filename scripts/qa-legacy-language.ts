import assert from "node:assert/strict";

/**
 * Pre-125 frozen snapshots predate rich form bodies, pages, page branches,
 * rich-document pins, stored page paths, and body sharing.  Migrations add
 * only neutral values to those rows.  Assert every neutral value before
 * omitting it so a backfill or drift still fails the frozen fixture.
 */
export function legacyBodyImageColumn(key: string, value: unknown) {
  if ([
    "bodyRich",
    "completionPageMode",
    "completionPageBody",
    "completionPageBodyRich",
    "closedPageMode",
    "closedPageBody",
    "closedPageBodyRich",
    "sectionId",
    "branchDestinationKind",
    "branchDestinationSectionId",
    "documentKey",
    "nodeKey",
    "visitedPageKeys",
    "terminationKind",
    "infoPatternId",
    "consentItems",
  ].includes(key)) {
    assert.equal(value, null, `Frozen fixture acquired non-neutral ${key}`);
    return undefined;
  }
  if (["sectionSchemaVersion", "pagePathVersion", "consentItemSchemaVersion"].includes(key)) {
    assert.equal(value, 0, `Frozen fixture acquired non-neutral ${key}`);
    return undefined;
  }
  if (key === "shareFormBody") {
    assert.equal(value, false, "Frozen share grant acquired form-body access");
    return undefined;
  }
  // versionInclude now loads FormSection rows. Legacy versions must have none.
  if (key === "sections") {
    assert(Array.isArray(value), "Frozen fixture sections must be an array");
    assert.equal(value.length, 0, "Frozen fixture acquired form sections");
    return undefined;
  }
  return value;
}

/** Pre-124 snapshots exclude the new question image field, after asserting null. */
export function legacyQuestionImageColumn(key: string, value: unknown) {
  if (key === "questionImageKey") {
    assert.equal(value, null, "Frozen question acquired a question image");
    return undefined;
  }
  return legacyBodyImageColumn(key, value);
}

/** Pre-122 snapshots exclude only the additive image key after verifying null. */
export function legacyQuestionAuthorAssetColumn(key: string, value: unknown) {
  if (key === "optionImageKey") {
    assert.equal(value, null, "Frozen option acquired an author image");
    return undefined;
  }
  return legacyQuestionImageColumn(key, value);
}

/** Pre-121 snapshots exclude only the additive custom-choice flag after verifying null. */
export function legacyQuestionCustomChoiceColumn(key: string, value: unknown) {
  if (key === "isCustomValue") {
    assert.equal(value, null, "Frozen option acquired a custom-choice flag");
    return undefined;
  }
  return legacyQuestionAuthorAssetColumn(key, value);
}

/** Pre-120 snapshots exclude only the additive manual-classification column after verifying null. */
export function legacyQuestionPersonalInformationColumn(key: string, value: unknown) {
  if (key === "catchFormPersonalInformationRequests") {
    assert.equal(value, null, "Frozen question acquired manual personal-information metadata");
    return undefined;
  }
  return legacyQuestionCustomChoiceColumn(key, value);
}

/** Pre-119 snapshots exclude only the additive material column after verifying null. */
export function legacyQuestionMaterialsColumn(key: string, value: unknown) {
  if (key === "materialList") {
    assert.equal(value, null, "Frozen question acquired reference materials");
    return undefined;
  }
  return legacyQuestionPersonalInformationColumn(key, value);
}

/** Pre-118 frozen snapshots exclude only the additive explanation column after verifying null. */
export function legacyQuestionExplanationColumn(key: string, value: unknown) {
  if (key === "additionalExplanation") {
    assert.equal(value, null, "Frozen question acquired an explanation");
    return undefined;
  }
  return legacyQuestionMaterialsColumn(key, value);
}

/** Pre-117 snapshots also exclude the additive language column after verifying it remains null. */
export function legacyFormLanguageColumn(key: string, value: unknown) {
  if (key === "formLanguage") {
    assert.equal(value, null, "Frozen form version acquired a language");
    return undefined;
  }
  return legacyQuestionExplanationColumn(key, value);
}
