-- Additive only: keep existing published rows, approval snapshots and receipt bytes untouched.
ALTER TABLE "Question" ADD COLUMN "additionalExplanation" TEXT;

-- PostgreSQL char_length counts Unicode scalar values. JavaScript/HTML maxLength counts UTF-16
-- units, so every supplementary scalar adds a second unit. NUL and invalid UTF-8 are already
-- rejected by PostgreSQL text/UTF8 encoding. The API separately rejects unpaired UTF-16 surrogates.
CREATE FUNCTION question_explanation_utf16_length(value text) RETURNS integer
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT char_length(value) + (
      SELECT count(*)::integer FROM regexp_split_to_table(value, '') AS chars(character)
      WHERE ascii(character) > 65535
    )
  $$;
ALTER TABLE "Question" ADD CONSTRAINT "Question_additional_explanation_check" CHECK (
  "additionalExplanation" IS NULL OR question_explanation_utf16_length("additionalExplanation") <= 3000
);
