"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useResource } from "@/lib/api";
import type { Application } from "./ApplicationContext";
import { ActionButton, Panel } from "./shared";

export function LoadingTransition() {
  const router = useRouter();
  const context = useResource<Application>("/context");
  useEffect(() => {
    if (!context.data) return;
    if (!context.data.company) router.replace(context.data.expertAssignmentCount > 0 ? "/expert/select-company" : "/company-info");
    else if (!context.data.services.length && !["owner", "admin"].includes(context.data.company.role)) {
      const selected = context.data.memberships.find(item => item.tenantId === context.data?.company?.id);
      router.replace(selected?.accessKind === "expert" ? "/expert/select-company" : "/service/none");
    }
    else router.replace("/dashboard");
  }, [context.data, router]);
  return <div className="cs-gate"><Panel title="서비스를 불러오는 중입니다.">
    {context.error ? <><p role="alert">{context.error.message}</p><ActionButton onClick={context.reload}>다시 시도</ActionButton></> :
      <p role="status">회사와 서비스 권한을 확인하고 있습니다.</p>}
  </Panel></div>;
}
