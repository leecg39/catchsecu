BEGIN;
CREATE OR REPLACE FUNCTION prevent_erased_subject_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target TEXT; state TEXT;
BEGIN
 -- Deletion already has a committed barrier. Do not take a parent lock after
 -- a file lock: the erasure worker always locks the parent before files.
 IF TG_TABLE_NAME='FileObject' THEN
   IF TG_OP='UPDATE' AND NEW.status IN ('deleting','deleted') THEN RETURN NEW; END IF;
 END IF;
 IF TG_TABLE_NAME='ConsentEvent' THEN
   SELECT "submissionId" INTO target FROM "ConsentReceipt" WHERE id=NEW."receiptId";
 ELSIF TG_TABLE_NAME='CorrectionPayload' THEN
   SELECT "submissionId" INTO target FROM "Correction" WHERE id=NEW."correctionId";
 ELSE target:=NEW."submissionId"; END IF;
 IF target IS NULL THEN RETURN NEW; END IF;
 SELECT status INTO state FROM "Submission" WHERE id=target FOR SHARE;
 IF state IN ('destroying','destroyed') THEN
   RAISE EXCEPTION 'subject destruction write barrier' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
COMMIT;
