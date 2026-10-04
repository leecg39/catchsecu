-- 게시된 폼 버전은 불변이다. 보유 기간 사후 지정은 폼에 저장하고 이후 접수부터 적용한다.
ALTER TABLE "Form" ADD COLUMN "designatedRetentionDays" INTEGER;
ALTER TABLE "Form" ADD CONSTRAINT "Form_designated_retention" CHECK ("designatedRetentionDays" IS NULL OR "designatedRetentionDays" BETWEEN 1 AND 36500);
