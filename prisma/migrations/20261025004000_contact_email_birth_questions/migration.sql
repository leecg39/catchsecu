-- Expand question types and compatible bindings without changing existing rows.
ALTER TABLE "Question" DROP CONSTRAINT "Question_type_check";
ALTER TABLE "Question" ADD CONSTRAINT "Question_type_check" CHECK (type IN (
  '단문형 답변','장문형 답변','객관식 답변','체크박스','드롭다운','날짜','파일 업로드','행렬형 단일 선택','행렬형 복수 선택',
  '연락처','이메일','이메일 직접 입력','생년월일'
));
ALTER TABLE "Question" DROP CONSTRAINT "Question_subject_role_check";
ALTER TABLE "Question" ADD CONSTRAINT "Question_subject_role_check" CHECK (
  "subjectRole" IS NULL OR (required AND (
    ("subjectRole"='name' AND type='단문형 답변') OR
    ("subjectRole"='email' AND type IN ('단문형 답변','이메일','이메일 직접 입력'))
  ))
);

-- Preserve the latest scope, version, source lifetime and wall-clock guards.
CREATE OR REPLACE FUNCTION guard_marketing_preference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'erase marketing contact instead of deleting its denial marker' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (ROW(NEW.id,NEW."tenantId",NEW."serviceId",NEW.channel,NEW."contactHash",NEW."createdAt") IS DISTINCT FROM
 ROW(OLD.id,OLD."tenantId",OLD."serviceId",OLD.channel,OLD."contactHash",OLD."createdAt") OR NEW.version<>OLD.version+1)
 THEN RAISE EXCEPTION 'marketing scope immutable or invalid version' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "Submission" s JOIN "FormVersion" v ON v.id=s."formVersionId" JOIN "Form" f ON f.id=v."formId"
 WHERE s.id=NEW."sourceSubmissionId" AND s."tenantId"=NEW."tenantId" AND f."serviceId"=NEW."serviceId"
 AND (NEW.status<>'granted' OR (s.status IN ('submitted','corrected') AND s."retentionUntil">now()))
 AND NEW."nameQuestionId"<>NEW."contactQuestionId"
 AND EXISTS (SELECT 1 FROM "Question" q WHERE q."formVersionId"=s."formVersionId" AND q."stableKey"=NEW."nameQuestionId" AND q.type IN ('단문형 답변','장문형 답변'))
 AND EXISTS (SELECT 1 FROM "Question" q WHERE q."formVersionId"=s."formVersionId" AND q."stableKey"=NEW."contactQuestionId" AND (
   q.type IN ('단문형 답변','장문형 답변') OR
   (NEW.channel='email' AND q.type IN ('이메일','이메일 직접 입력')) OR
   (NEW.channel IN ('sms','kakao') AND q.type='연락처')
 )))
 THEN RAISE EXCEPTION 'marketing source invalid' USING ERRCODE='23514'; END IF;
 IF NEW."grantedAt">clock_timestamp()+interval '1 second' OR NEW."grantedAt"<'2000-01-01'::timestamp
 THEN RAISE EXCEPTION 'invalid marketing consent time' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
