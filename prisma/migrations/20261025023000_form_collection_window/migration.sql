ALTER TABLE "FormVersion"
  ADD COLUMN "collectionWindowSchemaVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "collectionOpenAt" TIMESTAMP(3),
  ADD COLUMN "collectionCloseAt" TIMESTAMP(3);

ALTER TABLE "Publication"
  ADD COLUMN "opensAt" TIMESTAMP(3);

ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_collection_window_check" CHECK (
  ("collectionWindowSchemaVersion" = 0 AND "collectionOpenAt" IS NULL AND "collectionCloseAt" IS NULL)
  OR
  ("collectionWindowSchemaVersion" = 1 AND
    ("collectionOpenAt" IS NULL OR "collectionCloseAt" IS NULL OR "collectionOpenAt" < "collectionCloseAt"))
);

ALTER TABLE "Publication" ADD CONSTRAINT "Publication_collection_window_check" CHECK (
  "opensAt" IS NULL OR "expiresAt" IS NULL OR "opensAt" < "expiresAt"
);
