CREATE TABLE "Guide" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  category text NOT NULL,
  "categoryOrder" integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  "sortOrder" integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  "fileName" text,
  "fileSize" integer,
  "fileSha256" text,
  "assetKey" text UNIQUE,
  "storageKey" text UNIQUE,
  "publishedAt" timestamp(3),
  version integer NOT NULL DEFAULT 1,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Guide_fields_check" CHECK (
    status IN ('draft','published','archived') AND version > 0
    AND length(btrim(category)) BETWEEN 1 AND 100
    AND length(btrim(title)) BETWEEN 1 AND 200
    AND "categoryOrder" BETWEEN -1000000 AND 1000000
    AND "sortOrder" BETWEEN -1000000 AND 1000000
    AND (("assetKey" IS NOT NULL)::int + ("storageKey" IS NOT NULL)::int) <= 1
    AND (("fileName" IS NULL AND "fileSize" IS NULL AND "fileSha256" IS NULL AND "assetKey" IS NULL AND "storageKey" IS NULL)
      OR ("fileName" IS NOT NULL AND "fileSize" BETWEEN 1 AND 10485760 AND "fileSha256" ~ '^[0-9a-f]{64}$'
        AND ("assetKey" IS NOT NULL OR "storageKey" IS NOT NULL)))
    AND (status <> 'published' OR ("publishedAt" IS NOT NULL AND "fileName" IS NOT NULL))
    AND ("assetKey" IS NULL OR "assetKey" ~ '^[0-9]+-[0-9]+$')
  )
);
CREATE INDEX "Guide_status_categoryOrder_sortOrder_id_idx" ON "Guide"(status, "categoryOrder", "sortOrder", id);
