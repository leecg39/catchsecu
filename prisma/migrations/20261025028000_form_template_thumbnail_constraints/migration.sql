ALTER TABLE "AuthorAssetReference" DROP CONSTRAINT "AuthorAssetReference_parent_check";
ALTER TABLE "AuthorAssetReference" ADD CONSTRAINT "AuthorAssetReference_parent_check" CHECK (
  num_nonnulls("formVersionId", "templateId", "approvalId") = 1
  AND (
    (slot IN ('material', 'option', 'question')
      AND "questionKey" IS NOT NULL AND "documentKey" IS NULL AND "nodeKey" IS NULL
      AND (("formVersionId" IS NOT NULL AND "questionId" IS NOT NULL AND "tenantId" IS NOT NULL AND "serviceId" IS NOT NULL)
        OR ("formVersionId" IS NULL AND "questionId" IS NULL)))
    OR
    (slot IN ('form_content', 'page_content', 'end_page_content', 'private_page_content')
      AND "questionKey" IS NULL AND "documentKey" IS NOT NULL AND "nodeKey" IS NOT NULL AND "questionId" IS NULL
      AND (("formVersionId" IS NOT NULL AND "tenantId" IS NOT NULL AND "serviceId" IS NOT NULL)
        OR "formVersionId" IS NULL))
    OR
    (slot = 'template_thumbnail' AND "templateId" IS NOT NULL
      AND "questionKey" IS NULL AND "documentKey" = 'template' AND "nodeKey" IS NULL AND "questionId" IS NULL
      AND (("tenantId" IS NULL AND "serviceId" IS NULL) OR ("tenantId" IS NOT NULL AND "serviceId" IS NOT NULL)))
  )
);

ALTER TABLE "AuthorAssetReference" DROP CONSTRAINT "AuthorAssetReference_key_check";
ALTER TABLE "AuthorAssetReference" ADD CONSTRAINT "AuthorAssetReference_key_check" CHECK (
  ("questionKey" IS NULL OR "questionKey" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
  AND ("optionKey" IS NULL OR "optionKey" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
  AND ("nodeKey" IS NULL OR "nodeKey" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
  AND ((slot = 'form_content' AND "documentKey" = 'form')
    OR (slot = 'page_content' AND "documentKey" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
    OR (slot = 'end_page_content' AND "documentKey" = 'completion')
    OR (slot = 'private_page_content' AND "documentKey" = 'closed')
    OR (slot = 'template_thumbnail' AND "documentKey" = 'template')
    OR (slot IN ('material', 'option', 'question') AND "documentKey" IS NULL))
);
