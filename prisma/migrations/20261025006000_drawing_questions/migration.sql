-- Preserve published rows and the existing FILE UUID contract; DRAW uses the same private FileObject lifecycle.
ALTER TABLE "Question" DROP CONSTRAINT "Question_type_check";
ALTER TABLE "Question" ADD CONSTRAINT "Question_type_check" CHECK (type IN (
  '단문형 답변','장문형 답변','객관식 답변','체크박스','드롭다운','날짜','파일 업로드','행렬형 단일 선택','행렬형 복수 선택',
  '연락처','이메일','이메일 직접 입력','생년월일','주소','해외 주소','직접 그리기'
));

-- Retain every existing transition, immutable binding and byte guard.
-- Do not replace the later import/sender/campaign owner or attached CHECK constraints.
CREATE OR REPLACE FUNCTION check_file_object() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' AND (NEW.status<>'pending' OR NEW."scanStatus"<>'pending' OR NEW.version<>1) THEN
    RAISE EXCEPTION 'files must start pending' USING ERRCODE='23514';
  END IF;
  IF NEW."questionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Question" q JOIN "FormVersion" v ON v.id=q."formVersionId"
    JOIN "Form" f ON f.id=v."formId"
    JOIN "Publication" p ON p.id=NEW."publicationId" AND p."formVersionId"=v.id AND p."tenantId"=f."tenantId"
    WHERE q.id=NEW."questionId" AND (q.type='파일 업로드' OR (q.type='직접 그리기' AND NEW.mime='image/png'))
      AND q."formVersionId"=NEW."formVersionId" AND f."serviceId"=NEW."serviceId" AND f."tenantId"=NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'invalid file question or service' USING ERRCODE='23514';
  END IF;
  IF NEW."submissionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Submission" WHERE id=NEW."submissionId" AND "tenantId"=NEW."tenantId"
      AND "publicationId"=NEW."publicationId" AND "formVersionId"=NEW."formVersionId"
  ) THEN
    RAISE EXCEPTION 'invalid file submission' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status='deleted' OR NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION 'invalid file revision' USING ERRCODE='23514';
    END IF;
    IF (NEW."tenantId",NEW."serviceId",NEW."ownerKind",NEW."ownerId",NEW."storageKey",NEW.mime,NEW."publicationId",NEW."formVersionId",NEW."questionId")
      IS DISTINCT FROM (OLD."tenantId",OLD."serviceId",OLD."ownerKind",OLD."ownerId",OLD."storageKey",OLD.mime,OLD."publicationId",OLD."formVersionId",OLD."questionId") THEN
      RAISE EXCEPTION 'immutable file binding' USING ERRCODE='23514';
    END IF;
    IF NEW."submissionId" IS DISTINCT FROM OLD."submissionId" AND NOT
      (OLD."submissionId" IS NULL AND NEW."submissionId" IS NOT NULL AND OLD.status='ready' AND NEW.status='attached') THEN
      RAISE EXCEPTION 'immutable file submission' USING ERRCODE='23514';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='pending' AND NEW.status IN ('uploaded','deleting')) OR
      (OLD.status='uploaded' AND NEW.status IN ('ready','rejected','deleting')) OR
      (OLD.status='ready' AND NEW.status IN ('attached','deleting')) OR
      (OLD.status IN ('attached','rejected') AND NEW.status='deleting') OR
      (OLD.status='deleting' AND NEW.status='deleted')
    ) THEN RAISE EXCEPTION 'invalid file transition' USING ERRCODE='23514'; END IF;
    IF NEW.status<>'deleted' AND (NEW.size,NEW.sha256) IS DISTINCT FROM (OLD.size,OLD.sha256) THEN
      RAISE EXCEPTION 'immutable file bytes' USING ERRCODE='23514';
    END IF;
    IF NEW."nameCipher" IS DISTINCT FROM OLD."nameCipher" AND NOT
      (NEW.status='deleted' OR (OLD.status='ready' AND NEW.status='ready' AND OLD."ownerKind"='member' AND OLD."submissionId" IS NULL)) THEN
      RAISE EXCEPTION 'immutable attachment filename' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
