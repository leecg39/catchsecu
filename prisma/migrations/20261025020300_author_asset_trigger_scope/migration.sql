-- Asset graph locks and checks are needed only when asset-bearing fields can
-- change. Ordinary labels, ordering and asset-free bulk options stay O(n).
DROP TRIGGER "QuestionOption_author_asset_lock" ON "QuestionOption";
DROP TRIGGER "QuestionOption_author_asset_consistency" ON "QuestionOption";
DROP TRIGGER "Question_author_asset_lock" ON "Question";
DROP TRIGGER "Question_author_asset_consistency" ON "Question";

CREATE TRIGGER "QuestionOption_author_asset_lock_insert" BEFORE INSERT ON "QuestionOption"
  FOR EACH ROW WHEN (NEW."optionImageKey" IS NOT NULL) EXECUTE FUNCTION lock_author_asset_content();
CREATE TRIGGER "QuestionOption_author_asset_lock_update" BEFORE UPDATE ON "QuestionOption"
  FOR EACH ROW WHEN (OLD."optionImageKey" IS DISTINCT FROM NEW."optionImageKey" OR OLD."questionId" IS DISTINCT FROM NEW."questionId")
  EXECUTE FUNCTION lock_author_asset_content();
CREATE TRIGGER "QuestionOption_author_asset_lock_delete" BEFORE DELETE ON "QuestionOption"
  FOR EACH ROW WHEN (OLD."optionImageKey" IS NOT NULL) EXECUTE FUNCTION lock_author_asset_content();

CREATE CONSTRAINT TRIGGER "QuestionOption_author_asset_consistency_insert" AFTER INSERT ON "QuestionOption" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."optionImageKey" IS NOT NULL) EXECUTE FUNCTION check_author_asset_graph();
CREATE CONSTRAINT TRIGGER "QuestionOption_author_asset_consistency_update" AFTER UPDATE ON "QuestionOption" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD."optionImageKey" IS DISTINCT FROM NEW."optionImageKey" OR OLD."questionId" IS DISTINCT FROM NEW."questionId")
  EXECUTE FUNCTION check_author_asset_graph();
CREATE CONSTRAINT TRIGGER "QuestionOption_author_asset_consistency_delete" AFTER DELETE ON "QuestionOption" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD."optionImageKey" IS NOT NULL) EXECUTE FUNCTION check_author_asset_graph();

CREATE TRIGGER "Question_author_asset_lock_insert" BEFORE INSERT ON "Question"
  FOR EACH ROW WHEN (NEW."questionImageKey" IS NOT NULL OR NEW."materialList" IS NOT NULL) EXECUTE FUNCTION lock_author_asset_content();
CREATE TRIGGER "Question_author_asset_lock_update" BEFORE UPDATE ON "Question"
  FOR EACH ROW WHEN (
    OLD."formVersionId" IS DISTINCT FROM NEW."formVersionId" OR OLD."stableKey" IS DISTINCT FROM NEW."stableKey"
    OR OLD.type IS DISTINCT FROM NEW.type OR OLD."questionImageKey" IS DISTINCT FROM NEW."questionImageKey"
    OR OLD."materialList" IS DISTINCT FROM NEW."materialList"
  ) EXECUTE FUNCTION lock_author_asset_content();
CREATE TRIGGER "Question_author_asset_lock_delete" BEFORE DELETE ON "Question"
  FOR EACH ROW EXECUTE FUNCTION lock_author_asset_content();

CREATE CONSTRAINT TRIGGER "Question_author_asset_consistency_insert" AFTER INSERT ON "Question" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."questionImageKey" IS NOT NULL OR NEW."materialList" IS NOT NULL) EXECUTE FUNCTION check_author_asset_graph();
CREATE CONSTRAINT TRIGGER "Question_author_asset_consistency_update" AFTER UPDATE ON "Question" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (
    OLD."formVersionId" IS DISTINCT FROM NEW."formVersionId" OR OLD."stableKey" IS DISTINCT FROM NEW."stableKey"
    OR OLD.type IS DISTINCT FROM NEW.type OR OLD."questionImageKey" IS DISTINCT FROM NEW."questionImageKey"
    OR OLD."materialList" IS DISTINCT FROM NEW."materialList"
  ) EXECUTE FUNCTION check_author_asset_graph();
CREATE CONSTRAINT TRIGGER "Question_author_asset_consistency_delete" AFTER DELETE ON "Question" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_author_asset_graph();
