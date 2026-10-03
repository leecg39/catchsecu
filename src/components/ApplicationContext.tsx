"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useResource } from "@/lib/api";
export type Application = {
  user: { id: string; name: string; email: string; twoFactorEnabled: boolean; platformAdmin: boolean };
  company: { id: string; name: string; role: string } | null;
  services: { id: string; name: string; externalName: string }[];
  serviceId: string | null;
  capabilities: string[];
  memberships: { tenantId: string; role: string; accessKind: string; tenant: { name: string } }[];
  expertCompanyCount: number;
  expertAssignmentCount: number;
  requireMfa?: boolean;
  requirePasswordChange?: boolean;
};
const Context = createContext<{ data?: Application; reload: () => void }>({ reload: () => {} });
export function ApplicationProvider({ children }: { children: ReactNode }) {
  const resource = useResource<Application>("/context");
  return <Context.Provider value={resource}>{children}</Context.Provider>;
}
export function useApplication() { return useContext(Context); }
