CREATE TABLE "Notice" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  category text NOT NULL,
  title text NOT NULL,
  "bodyHtml" text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  "sortOrder" integer NOT NULL DEFAULT 0,
  "authorName" text NOT NULL DEFAULT '운영자',
  "publishedAt" timestamp(3),
  version integer NOT NULL DEFAULT 1,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notice_fields_check" CHECK (
    status IN ('draft','published','archived') AND version > 0
    AND length(btrim(category)) BETWEEN 1 AND 30
    AND length(btrim(title)) BETWEEN 1 AND 200
    AND length("bodyHtml") BETWEEN 1 AND 100000
    AND length(btrim("authorName")) BETWEEN 1 AND 100
    AND (status <> 'published' OR "publishedAt" IS NOT NULL)
  )
);
CREATE INDEX "Notice_status_sortOrder_publishedAt_id_idx" ON "Notice"(status, "sortOrder", "publishedAt", id);
