export type AccessDenialReason = "admin" | "role" | "service" | "expert" | "general";

export function accessDenialReason(value: string | null): AccessDenialReason {
  return value === "admin" || value === "role" || value === "service" || value === "expert" ? value : "general";
}

export function accessDenialFromCode(code: string): AccessDenialReason {
  if (code === "PLATFORM_ADMIN_REQUIRED") return "admin";
  if (code === "SERVICE_FORBIDDEN") return "service";
  if (code === "EXPERT_SCOPE") return "expert";
  return "role";
}
