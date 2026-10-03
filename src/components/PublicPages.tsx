"use client";

import { useRouter } from "next/navigation";
import { MarketingStatistics } from "./forms/Marketing";
import { SubjectPortal } from "./forms/SubjectPortal";
import { SharedPrivacy } from "./forms/SharedPrivacy";
import { PublicDocument } from "./forms/Documents";
import { FileView } from "./forms/FileView";
import { PublicForm } from "./forms/PublicForm";
import { ServiceAccessPage } from "./ServiceAccessPage";
import { LoadingTransition } from "./LoadingTransition";
import { ExpertSelectPage } from "./ExpertSelectPage";
import { PrivacyStatistics, CompliancePage } from "./StatisticsPages";
import { NoticePages } from "./NoticePages";
import { GuidePages } from "./GuidePages";
import { ActionButton, Panel } from "./shared";
import "./public.css";

export function isExternal(path: string) {
  return /^\/(shared-privacy|infoOwner|projects?|url|test-projects|file-view|document|customer-use-case|services)(\/|$)/.test(path)
    || path === "/jap_intro" || path === "/service/none" || path === "/expert/select-company";
}

export function PublicPages({ path }: { path: string }) {
  const router = useRouter();
  if (path === "/notice" || path.startsWith("/notice/")) return <NoticePages path={path} />;
  if (path === "/help-center") return <GuidePages path={path} />;
  if (path === "/loading") return <LoadingTransition />;
  if (path === "/service/none") return <ServiceAccessPage />;
  if (path === "/expert/select-company") return <ExpertSelectPage />;
  if (path === "/marketing-detail" || /^\/marketing-detail\/[^/]+$/.test(path))
    return <MarketingStatistics serviceId={path.split("/")[2]} />;
  if (path === "/privacy-detail" || /^\/privacy-detail\/[^/]+$/.test(path))
    return <PrivacyStatistics path={path} />;
  if (path === "/compliance") return <CompliancePage />;
  if (path.startsWith("/shared-privacy")) return <SharedPrivacy path={path} />;
  if (path.startsWith("/infoOwner")) return <SubjectPortal path={path} />;
  if (isExternal(path)) return <ExternalForm path={path} />;
  return <div className="cs-gate"><Panel title="잘못된 접근입니다."><p>요청하신 화면을 표시할 데이터가 없습니다.</p>
    <div className="public-actions"><ActionButton onClick={() => router.push("/dashboard")}>홈으로</ActionButton></div>
  </Panel></div>;
}

function ExternalForm({ path }: { path: string }) {
  if (path.startsWith("/file-view")) return <FileView path={path} />;
  if (path.startsWith("/document")) return <PublicDocument path={path} />;
  return <PublicForm key={path} path={path} />;
}
