-- Additive metadata only. Do not update legacy questions, published snapshots or receipt bytes.
ALTER TABLE "Question" ADD COLUMN "materialList" JSONB;

CREATE FUNCTION question_material_utf16_length(value text) RETURNS integer
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT char_length(value) + (
      SELECT count(*)::integer FROM regexp_split_to_table(value, '') AS chars(character)
      WHERE ascii(character) > 65535
    )
  $$;

CREATE FUNCTION valid_question_material_links(value jsonb) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  material jsonb;
  ordinal bigint;
  link_url text;
  link_label text;
  authority text;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(value) > 3 THEN RETURN false; END IF;
  FOR material, ordinal IN SELECT item, item_position FROM jsonb_array_elements(value) WITH ORDINALITY AS entries(item, item_position) LOOP
    IF jsonb_typeof(material) IS DISTINCT FROM 'object'
      OR NOT (material ?& ARRAY['materialType','orderNumber','fileKey','linkLabel','linkUrl'])
      OR (material - ARRAY['materialType','orderNumber','fileKey','linkLabel','linkUrl']) <> '{}'::jsonb
      OR material->>'materialType' IS DISTINCT FROM 'LINK'
      OR jsonb_typeof(material->'orderNumber') IS DISTINCT FROM 'number'
      OR material->'fileKey' IS DISTINCT FROM 'null'::jsonb
      OR jsonb_typeof(material->'linkLabel') IS DISTINCT FROM 'string'
      OR jsonb_typeof(material->'linkUrl') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    IF (material->>'orderNumber')::numeric <> ordinal - 1 THEN RETURN false; END IF;
    link_url := material->>'linkUrl';
    link_label := material->>'linkLabel';
    IF question_material_utf16_length(link_url) NOT BETWEEN 1 AND 512
      OR question_material_utf16_length(link_label) NOT BETWEEN 1 AND 100
      OR link_url !~* '^https?://'
      OR position(chr(92) in link_url) > 0
      OR EXISTS (SELECT 1 FROM regexp_split_to_table(link_url, '') AS chars(character)
        WHERE ascii(character) BETWEEN 1 AND 31 OR ascii(character) BETWEEN 127 AND 159)
      THEN RETURN false; END IF;
    -- The application also applies WHATWG URL parsing. This database boundary enforces the
    -- scheme and a nonempty authority without userinfo; it never resolves or fetches a URL.
    authority := substring(link_url from '^[^:]+://([^/?#]+)');
    IF authority IS NULL OR authority = '' OR authority ~ '[[:space:]@]' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE "Question" ADD CONSTRAINT "Question_material_list_check" CHECK (
  "materialList" IS NULL OR valid_question_material_links("materialList")
);
