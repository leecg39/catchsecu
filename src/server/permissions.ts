import { Role } from "@/generated/prisma/client";
export const capabilities = [
  "company.manage", "member.manage", "service.read", "service.manage",
  "form.read", "form.write", "form.publish", "form.approve", "document.read", "document.write",
  "submission.read", "submission.write", "submission.destroy",
  "share.manage", "marketing.read", "marketing.write", "sender.read", "sender.manage",
  "import.read", "import.write", "integration.read", "integration.manage",
  "file.read", "file.write", "message.read", "message.send", "message.manage",
  "billing.read", "billing.write", "security.read", "security.write", "audit.read",
] as const;
export type Capability = typeof capabilities[number];
const permissionMap: Record<Role, readonly Capability[]> = {
  owner: capabilities,
  admin: capabilities.filter(value => !value.startsWith("billing.")),
  editor: ["service.read", "form.read", "form.write", "form.publish", "document.read", "document.write", "file.write", "import.read", "import.write"],
  viewer: ["service.read", "form.read", "document.read"],
  privacy: ["service.read", "form.read", "submission.read", "submission.write", "submission.destroy", "share.manage", "marketing.read", "marketing.write", "file.read", "audit.read", "import.read", "import.write"],
  sender: ["sender.read", "sender.manage", "marketing.read", "service.read", "message.read", "message.send", "message.manage"],
  billing: ["service.read", "billing.read", "billing.write"],
  security: ["service.read", "form.read", "form.approve", "security.read", "security.write", "audit.read"],
  auditor: ["service.read", "audit.read"],
};
export function roleCapabilities(role: Role): readonly Capability[] { return permissionMap[role]; }
export function roleCan(role: Role, capability: Capability) { return permissionMap[role].includes(capability); }
