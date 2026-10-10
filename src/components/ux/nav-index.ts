import groups from "@/data/menu.json";

export type NavEntry = { path: string; label: string; group: string; keywords?: string };

const extras: NavEntry[] = [
  { path: "/form/ai/create?new=1", label: "캐치폼 직접 생성", group: "개인정보 수집/관리", keywords: "새 폼 만들기 작성" },
  { path: "/log/destruction-schedule", label: "개인정보 파기 일정", group: "개인정보 모니터링", keywords: "파기 예정" },
  { path: "/log/destruction_certificate", label: "개인정보 파기 증명서", group: "개인정보 모니터링", keywords: "파기 증명" },
  { path: "/security", label: "회사 보안 현황", group: "관리", keywords: "보안 점검" },
  { path: "/security/ip", label: "IP 접근 관리", group: "관리", keywords: "아이피 접속 제한" },
  { path: "/security/sso", label: "SSO 로그인 정책", group: "관리", keywords: "통합 로그인 싱글사인온" },
  { path: "/security/two-factor", label: "2단계 인증 강제 정책", group: "관리", keywords: "otp mfa 이중 인증" },
  { path: "/shared-privacy/view", label: "공유받은 외부 개인정보 열람", group: "공유", keywords: "외부 열람" },
  { path: "/notice", label: "캐치시큐 업데이트 노트", group: "도움말", keywords: "공지" },
  { path: "/my-page/support", label: "내 문의·개선 제안", group: "MY", keywords: "문의하기" },
];

export const navEntries: NavEntry[] = [
  ...groups.flatMap(group => group.items.filter(item => item.path !== "/logout").map(item => ({ path: item.path, label: item.label, group: group.label }))),
  ...extras,
];

const initialsTable = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
export function initials(text: string) {
  return [...text].map(char => {
    const offset = char.charCodeAt(0) - 0xac00;
    return offset >= 0 && offset < 11172 ? initialsTable[Math.floor(offset / 588)] : char;
  }).join("");
}

const compact = (text: string) => text.toLowerCase().replace(/\s+/g, "");
export function searchNav(entries: NavEntry[], query: string) {
  const needle = compact(query);
  if (!needle) return entries;
  const initialsOnly = /^[ㄱ-ㅎ]+$/.test(needle);
  return entries.map((entry, index) => {
    const label = compact(entry.label);
    const rank = label.startsWith(needle) ? 0 : label.includes(needle) ? 1 : compact(entry.keywords ?? "").includes(needle) ? 2
      : compact(entry.group).includes(needle) ? 3 : initialsOnly && initials(label).includes(needle) ? 4 : -1;
    return { entry, index, rank };
  }).filter(item => item.rank >= 0).sort((a, b) => a.rank - b.rank || a.index - b.index).map(item => item.entry);
}
