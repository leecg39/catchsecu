-- Avoid O(all options) deferred graph checks for ordinary options. The graph
-- can only change when an option branch is added, changed or removed.
DROP TRIGGER "QuestionOption_section_graph" ON "QuestionOption";

CREATE CONSTRAINT TRIGGER "QuestionOption_section_graph_insert"
  AFTER INSERT ON "QuestionOption" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."branchDestinationKind" IS NOT NULL)
  EXECUTE FUNCTION check_form_section_graph();

CREATE CONSTRAINT TRIGGER "QuestionOption_section_graph_update"
  AFTER UPDATE ON "QuestionOption" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (
    OLD."branchDestinationKind" IS DISTINCT FROM NEW."branchDestinationKind"
    OR OLD."branchDestinationSectionId" IS DISTINCT FROM NEW."branchDestinationSectionId"
  ) EXECUTE FUNCTION check_form_section_graph();

CREATE CONSTRAINT TRIGGER "QuestionOption_section_graph_delete"
  AFTER DELETE ON "QuestionOption" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD."branchDestinationKind" IS NOT NULL)
  EXECUTE FUNCTION check_form_section_graph();
