export type AuditEventKind = "all" | "service" | "info" | "marketing" | "customer" | "member" | "authority" | "external" | "access" | "mail";
export type AuditEventRecord = {
  id: string; createdAt: string; action: string; resource: string; resourceId: string | null;
  serviceId: string | null; serviceName: string | null; actorName: string | null;
};
export type AuditEventList = { items: AuditEventRecord[]; total: number; page: number; pageSize: number };
