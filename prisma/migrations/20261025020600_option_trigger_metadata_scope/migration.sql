-- Custom-option and stable identity changes alter both branch eligibility and
-- option-image reference identity, so they must enter the scoped guards too.
DROP TRIGGER "QuestionOption_section_graph_update" ON "QuestionOption";
CREATE CONSTRAINT TRIGGER "QuestionOption_section_graph_update"
  AFTER UPDATE ON "QuestionOption" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (
    OLD."branchDestinationKind" IS DISTINCT FROM NEW."branchDestinationKind"
    OR OLD."branchDestinationSectionId" IS DISTINCT FROM NEW."branchDestinationSectionId"
    OR (OLD."isCustomValue" IS DISTINCT FROM NEW."isCustomValue" AND (OLD."branchDestinationKind" IS NOT NULL OR NEW."branchDestinationKind" IS NOT NULL))
    OR (OLD."questionId" IS DISTINCT FROM NEW."questionId" AND (OLD."branchDestinationKind" IS NOT NULL OR NEW."branchDestinationKind" IS NOT NULL))
  ) EXECUTE FUNCTION check_form_section_graph();

DROP TRIGGER "QuestionOption_author_asset_lock_update" ON "QuestionOption";
DROP TRIGGER "QuestionOption_author_asset_consistency_update" ON "QuestionOption";
CREATE TRIGGER "QuestionOption_author_asset_lock_update" BEFORE UPDATE ON "QuestionOption"
  FOR EACH ROW WHEN (
    OLD."optionImageKey" IS DISTINCT FROM NEW."optionImageKey" OR OLD."questionId" IS DISTINCT FROM NEW."questionId"
    OR ((OLD."optionImageKey" IS NOT NULL OR NEW."optionImageKey" IS NOT NULL) AND (
      OLD."stableKey" IS DISTINCT FROM NEW."stableKey" OR OLD."isCustomValue" IS DISTINCT FROM NEW."isCustomValue"
    ))
  ) EXECUTE FUNCTION lock_author_asset_content();
CREATE CONSTRAINT TRIGGER "QuestionOption_author_asset_consistency_update" AFTER UPDATE ON "QuestionOption" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (
    OLD."optionImageKey" IS DISTINCT FROM NEW."optionImageKey" OR OLD."questionId" IS DISTINCT FROM NEW."questionId"
    OR ((OLD."optionImageKey" IS NOT NULL OR NEW."optionImageKey" IS NOT NULL) AND (
      OLD."stableKey" IS DISTINCT FROM NEW."stableKey" OR OLD."isCustomValue" IS DISTINCT FROM NEW."isCustomValue"
    ))
  ) EXECUTE FUNCTION check_author_asset_graph();
