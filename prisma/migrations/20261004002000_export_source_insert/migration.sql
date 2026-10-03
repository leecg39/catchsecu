CREATE OR REPLACE FUNCTION invalidate_export_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb; source_id text;
BEGIN
  IF TG_OP='INSERT' THEN row_data:=to_jsonb(NEW); ELSE row_data:=to_jsonb(OLD); END IF;
  source_id:=CASE WHEN TG_TABLE_NAME='Submission' THEN row_data->>'id' ELSE row_data->>'submissionId' END;
  PERFORM erase_export_jobs(ARRAY(SELECT DISTINCT "jobId" FROM "ExportSource" WHERE "tenantId"=row_data->>'tenantId' AND "submissionId"=source_id),'SOURCE_CHANGED');
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER export_answer_insert AFTER INSERT ON "Answer" FOR EACH ROW EXECUTE FUNCTION invalidate_export_source();
CREATE TRIGGER export_file_insert AFTER INSERT ON "FileObject" FOR EACH ROW EXECUTE FUNCTION invalidate_export_source();
CREATE TRIGGER export_policy_access BEFORE UPDATE OR DELETE ON "SecurityPolicy" FOR EACH ROW EXECUTE FUNCTION invalidate_export_access();
CREATE TRIGGER export_user_mfa_access BEFORE UPDATE OF "twoFactorEnabled" ON "User" FOR EACH ROW EXECUTE FUNCTION invalidate_export_access();
