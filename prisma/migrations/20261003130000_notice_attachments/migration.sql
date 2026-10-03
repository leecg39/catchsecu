CREATE TABLE "NoticeAttachment" (
  id text PRIMARY KEY,
  "noticeId" text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  "fileName" text,
  mime text,
  "fileSize" integer NOT NULL DEFAULT 0,
  "fileSha256" text,
  "storageKey" text UNIQUE,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NoticeAttachment_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"(id) ON DELETE RESTRICT,
  CONSTRAINT "NoticeAttachment_status_check" CHECK (
    status IN ('active', 'deleting', 'deleted') AND
    ((status IN ('active','deleting') AND "fileName" IS NOT NULL AND mime IN ('application/pdf','image/png','image/jpeg','text/plain','text/csv')
      AND "fileSize" BETWEEN 1 AND 10485760 AND "fileSha256" ~ '^[a-f0-9]{64}$' AND "storageKey" IS NOT NULL)
      OR (status = 'deleted' AND "fileName" IS NULL AND mime IS NULL AND "fileSize" = 0 AND "fileSha256" IS NULL AND "storageKey" IS NULL))
  )
);
CREATE INDEX "NoticeAttachment_notice_status_created_idx" ON "NoticeAttachment"("noticeId",status,"createdAt",id);
CREATE INDEX "NoticeAttachment_status_created_idx" ON "NoticeAttachment"(status,"createdAt",id);
