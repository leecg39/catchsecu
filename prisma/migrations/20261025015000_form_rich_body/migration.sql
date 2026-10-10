ALTER TABLE "FormVersion" ADD COLUMN "bodyRich" JSONB;

ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_bodyRich_shape" CHECK (
  "bodyRich" IS NULL OR (
    jsonb_typeof("bodyRich") = 'object'
    AND "bodyRich"->>'schemaVersion' = '1'
    AND jsonb_typeof("bodyRich"->'blocks') = 'array'
  )
);
