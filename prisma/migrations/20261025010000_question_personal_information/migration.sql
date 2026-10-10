-- Additive manual metadata. Existing questions remain NULL and published rows stay immutable.
ALTER TABLE "Question" ADD COLUMN "catchFormPersonalInformationRequests" JSONB;

CREATE FUNCTION question_personal_information_utf16_length(value text) RETURNS integer
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT char_length(value) + (
      SELECT count(*)::integer FROM regexp_split_to_table(value, '') AS chars(character)
      WHERE ascii(character) > 65535
    )
  $$;

CREATE FUNCTION valid_question_personal_information(value jsonb, question_type text, is_required boolean) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  item jsonb;
  classification text;
  item_name text;
  -- Exactly ECMAScript WhiteSpace and LineTerminator used by String.prototype.trim.
  -- Includes NBSP/BOM, excludes U+0085; values are tested but never trimmed on storage.
  trim_characters constant text := U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(value) > 20 THEN RETURN false; END IF;
  FOR item IN SELECT entry FROM jsonb_array_elements(value) AS entries(entry) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR NOT (item ?& ARRAY['nlpFeedbackId','personalInformationType','detectedPersonalInformation','personalInformationSource'])
      OR (item - ARRAY['nlpFeedbackId','personalInformationType','detectedPersonalInformation','personalInformationSource']) <> '{}'::jsonb
      OR item->'nlpFeedbackId' IS DISTINCT FROM 'null'::jsonb
      OR jsonb_typeof(item->'personalInformationType') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'detectedPersonalInformation') IS DISTINCT FROM 'string'
      OR item->>'personalInformationSource' IS DISTINCT FROM 'USER' THEN RETURN false; END IF;
    classification := item->>'personalInformationType';
    item_name := item->>'detectedPersonalInformation';
    IF classification NOT IN ('PERSONAL_INFORMATION','SENSITIVE','IDENTIFICATION','RESIDENT','NON_PERSONAL_INFORMATION')
      OR question_personal_information_utf16_length(item_name) > 50 THEN RETURN false; END IF;
    IF classification = 'NON_PERSONAL_INFORMATION' THEN
      IF item_name <> '' THEN RETURN false; END IF;
    ELSIF btrim(item_name, trim_characters) = '' THEN RETURN false;
    END IF;
    IF question_type IN ('행렬형 단일 선택','행렬형 복수 선택') AND classification <> 'NON_PERSONAL_INFORMATION' THEN RETURN false; END IF;
    IF classification = 'RESIDENT' AND NOT is_required THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE "Question" ADD CONSTRAINT "Question_personal_information_check" CHECK (
  "catchFormPersonalInformationRequests" IS NULL
  OR valid_question_personal_information("catchFormPersonalInformationRequests", type, required)
);
