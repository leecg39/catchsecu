-- PATH_KILL/ineligible is a terminal display state, never a stored successful
-- response. Persisted submission evidence can finish only at consent or submit.
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_page_path_state";
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_page_path_state" CHECK (
  ("pagePathVersion"=0 AND "visitedPageKeys" IS NULL AND "terminationKind" IS NULL)
  OR ("pagePathVersion"=1 AND valid_submission_page_path("visitedPageKeys") AND "terminationKind" IN ('consent','submit'))
);
