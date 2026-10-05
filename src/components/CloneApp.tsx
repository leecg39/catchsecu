"use client";

import { type AccessDenialReason } from "@/lib/access-denial";
import { ApplicationProvider } from "./ApplicationContext";
import { AccessDeniedPage } from "./AccessDeniedPage";
import { NoticePages } from "./NoticePages";
import { GuidePages } from "./GuidePages";
import { SupportPages } from "./SupportPages";
import { CompanyOnboarding } from "./management/live";
import { ExpertAssignmentsAdmin } from "./ExpertAssignmentsAdmin";
import AppShell from "./AppShell";
import Dashboard from "./Dashboard";
import { FormsPages, matchForms } from "./forms";
import { ManagementPages, matchManagement } from "./management";
import { ServicesPages, matchServices } from "./services";
import { AuthPages, matchAuth } from "./auth/AuthPages";
import { PublicPages, isExternal } from "./PublicPages";
import { LegalPages } from "./LegalPages";
import { ToastProvider } from "./ux/toast";

type CloneAppProps = { path: string; accessReason?: AccessDenialReason };
export default function CloneApp(props: CloneAppProps) {
  return <ToastProvider><CloneRoutes {...props} /></ToastProvider>;
}

function CloneRoutes({ path, accessReason = "general" }: CloneAppProps) {
  if (matchAuth(path)) return <AuthPages key={path} path={path} />;
  if (path.startsWith("/legal/")) return <LegalPages key={path} path={path} />;
  if (path === "/admin/expert-assignments") return <ExpertAssignmentsAdmin />;
  if (path === "/company-info") return <ApplicationProvider><AppShell><CompanyOnboarding /></AppShell></ApplicationProvider>;
  if (isExternal(path)) return <PublicPages key={path} path={path} />;

  let page;
  if (path === "/access-not-allow") page = <AccessDeniedPage reason={accessReason} />;
  else if (path.startsWith("/admin/notices")) page = <NoticePages path={path} />;
  else if (path.startsWith("/admin/guides")) page = <GuidePages path={path} />;
  else if (path.startsWith("/admin/support") || path.startsWith("/my-page/support")) page = <SupportPages path={path} />;
  else if (path === "/" || path.startsWith("/dashboard") || ["/company-info", "/IE"].includes(path)) page = <Dashboard path={path} />;
  else if (path === "/my-page") page = <ManagementPages path="/my-page/info" />;
  else if (matchForms(path)) page = <FormsPages key={path} path={path} />;
  else if (matchManagement(path)) page = <ManagementPages key={path} path={path} />;
  else if (matchServices(path)) page = <ServicesPages key={path} path={path} />;
  else page = <PublicPages key={path} path={path} />;
  return <ApplicationProvider><AppShell>{page}</AppShell></ApplicationProvider>;
}
