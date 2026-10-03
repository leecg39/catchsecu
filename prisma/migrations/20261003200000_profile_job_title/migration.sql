ALTER TABLE "User" ADD COLUMN "jobTitle" text;
ALTER TABLE "User" ADD CONSTRAINT "User_jobTitle_length_check"
  CHECK ("jobTitle" IS NULL OR char_length("jobTitle") <= 100);
