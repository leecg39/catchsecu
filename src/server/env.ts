import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url().refine(value => value.startsWith("postgresql://") || value.startsWith("postgres://")),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  DATA_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  MAIL_TRANSPORT: z.enum(["local", "smtp"]).default("local"),
  MAIL_FROM: z.email().default("catchsecu@localhost.test"),
  PRIVATE_STORAGE_DIR: z.string().default(".local/storage"),
  CLAMAV_SOCKET: z.string().optional(),
  CLAMAV_MAX_SIGNATURE_AGE_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  FILE_TENANT_QUOTA_BYTES: z.coerce.number().int().min(10485760).max(1099511627776).default(1073741824),
  LOCAL_MAIL_DIR: z.string().default(".local/mail"),
  SMS_TRANSPORT: z.enum(["unconfigured", "local", "solapi"]).default("unconfigured"),
  MESSAGE_UNIT_COST_KRW: z.coerce.number().int().min(0).max(1000000).default(0),
  LOCAL_SMS_DIR: z.string().default(".local/sms"),
  SMS_WEBHOOK_SECRET: z.string().min(32).max(128).optional(),
  KAKAO_REVIEW_SECRET: z.string().min(32).max(128).optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().min(32).max(128).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_SENDER_DOMAINS: z.string().default(""),
  EMAIL_FEEDBACK_SECRET: z.string().min(32).max(128).optional(),
  SMTP_LIST_UNSUBSCRIBE_DKIM_SIGNED: z.enum(["true", "false"]).default("false"),
  NOTIFICATION_TRANSPORT: z.enum(["local", "webhook"]).default("local"),
  LOCAL_NOTIFICATION_DIR: z.string().default(".local/notifications"),
  SENDER_DNS_SERVER: z.string().optional(),
  SOLAPI_TENANT_ID: z.uuid().optional(),
  SOLAPI_API_KEY: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  SOLAPI_API_SECRET: z.string().min(16).optional(),
  FILE_STORAGE: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).max(32).default("us-east-1"),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).optional(),
  S3_ACCESS_KEY_ID: z.string().min(16).max(128).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(16).max(128).optional(),
}).superRefine((value, context) => {
  if (value.FILE_STORAGE !== "s3") return;
  for (const field of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const)
    if (!value[field]) context.addIssue({ code: "custom", path: [field], message: "S3 저장소 설정이 필요합니다." });
});
const result = schema.safeParse(process.env);
if (!result.success) {
  // Field names only: never include values from a failed secret validation.
  throw new Error("서버 환경 설정 오류: " + result.error.issues.map(issue => issue.path.join(".")).join(", "));
}
export const env = result.data;
if (process.env.NODE_ENV === "production" && env.MAIL_TRANSPORT === "local" && !process.env.ALLOW_LOCAL_MAIL) {
  throw new Error("운영 환경은 SMTP 설정이 필요합니다. 로컬 미리보기만 ALLOW_LOCAL_MAIL=1을 사용하세요.");
}
