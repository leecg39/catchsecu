"use client";
import { usePathname } from "next/navigation";
import { navEntries } from "./nav-index";

export function Breadcrumb() {
  const path = usePathname();
  const entry = navEntries.find(item => item.path === path);
  if (!entry || entry.group === entry.label) return null;
  return <nav aria-label="이동 경로" className="ux-breadcrumb">
    <ol><li>{entry.group}</li><li aria-current="page">{entry.label}</li></ol>
  </nav>;
}
