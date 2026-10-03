CREATE OR REPLACE FUNCTION invalidate_export_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_data jsonb; new_data jsonb; source_ids text[]; tenant_ids text[];
BEGIN
  IF TG_OP<>'INSERT' THEN old_data:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_data:=to_jsonb(NEW); END IF;
  source_ids:=ARRAY[CASE WHEN TG_TABLE_NAME='Submission' THEN old_data->>'id' ELSE old_data->>'submissionId' END,
                    CASE WHEN TG_TABLE_NAME='Submission' THEN new_data->>'id' ELSE new_data->>'submissionId' END];
  tenant_ids:=ARRAY[old_data->>'tenantId',new_data->>'tenantId'];
  PERFORM erase_export_jobs(ARRAY(SELECT DISTINCT "jobId" FROM "ExportSource" WHERE "tenantId"=ANY(tenant_ids) AND "submissionId"=ANY(source_ids)),'SOURCE_CHANGED');
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
