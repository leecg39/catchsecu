"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel, ActionButton } from "./shared";
import "./public.css";

const privacySections: [string, string][] = [
  ["수집하는 개인정보 항목", "회사는 서비스 제공을 위해 다음 항목을 수집합니다. 회원가입·로그인: 이메일, 이름, 비밀번호(암호화 저장), 로그인 기록, 접속 IP. 회사 등록: 회사명, 공개 회사명, 주소, 연락처, 사업자 등록 정보, 세금계산서 담당자 정보. 서비스 이용: 구성원 권한, 서비스별 접근 권한, 감사·활동 로그."],
  ["개인정보의 처리 목적", "회원 식별과 인증, 서비스 제공·유지·개선, 동의서·수집 폼 발행과 응답 관리, 문자·이메일·알림 발송, 보안 정책 적용과 부정 이용 방지, 법령상 보존 의무 이행 목적으로만 사용합니다."],
  ["보유·이용 기간과 파기", "회원 탈퇴·회사 삭제 시 지체 없이 파기하되, 관계 법령 또는 서비스 정책상 보존이 필요한 정보는 해당 기간 동안 암호화하여 분리 보관합니다. 각 수집 폼에 지정된 보존 기간이 끝나면 파기 일정에 따라 자동 파기되고 파기 증명서가 발급됩니다."],
  ["제3자 제공과 처리 위탁", "원칙적으로 개인정보를 제3자에게 제공하지 않으며, 이용자가 동의하거나 법령에 근거가 있는 경우에 한합니다. 문자·이메일 발송 등 위탁이 필요한 업무는 위탁 계약과 수탁사 고지를 통해 관리합니다."],
  ["이용자의 권리", "이용자는 언제든지 본인 개인정보의 열람·정정·삭제·처리 정지를 요청할 수 있고, 회사는 지체 없이 조치합니다. 회원 탈퇴와 회사 삭제는 마이페이지와 회사 관리 화면에서 직접 실행할 수 있습니다."],
  ["안전성 확보 조치", "비밀번호와 민감 정보는 암호화하여 저장하고, 접근 권한은 역할·서비스 단위로 최소화하며, 모든 열람·변경은 감사 로그로 기록됩니다. IP 접근 제한·2단계 인증·세션 정책을 회사별로 적용할 수 있습니다."],
];

const termsSections: [string, string][] = [
  ["목적", "이 약관은 회사가 제공하는 개인정보 수집·동의 관리 서비스의 이용 조건과 절차, 회사와 이용자의 권리·의무 및 책임 사항을 규정합니다."],
  ["계정과 회사", "이용자는 실제 정보로 회원가입해야 하며 계정 관리 책임은 본인에게 있습니다. 회사는 생성한 워크스페이스의 최고 관리 권한을 가지며 구성원 역할·서비스 권한·보안 정책을 관리합니다."],
  ["서비스 이용", "회사는 수집 폼·동의서·발송·통계 기능을 약관과 관계 법령이 허용하는 범위에서 이용할 수 있습니다. 수집한 개인정보에 대한 관리 책임은 해당 회사에 있으며, 플랫폼은 처리 도구와 인프라를 제공합니다."],
  ["금지 행위", "타인의 정보 도용, 법령 위반 목적의 수집·발송, 서비스 방해, 허가되지 않은 접근 시도는 금지되며 위반 시 이용이 제한될 수 있습니다."],
  ["서비스 변경·중단", "회사는 서비스 개선을 위해 기능을 변경할 수 있고, 중대한 변경은 공지합니다. 천재지변·외부 사업자 장애 등 불가항력으로 인한 중단에는 책임이 제한됩니다."],
  ["책임과 분쟁", "회사는 법령과 약관을 위반하지 않는 범위에서 서비스를 제공하며, 분쟁은 관련 법령과 관할 법원에 따릅니다."],
];

function LegalDocument({ title, updated, sections }: { title: string; updated: string; sections: [string, string][] }) {
  const router = useRouter();
  return <div className="cs-gate"><Panel title={title}>
    <div className="cs-stack" style={{ maxWidth: 720, textAlign: "left" }}>
      <p style={{ margin: 0, color: "var(--cs-muted, #666)", fontSize: 13 }}>시행일: {updated}</p>
      {sections.map(([heading, body], index) => <section key={heading}>
        <h3 style={{ fontSize: 15, margin: "18px 0 6px" }}>제{index + 1}조 {heading}</h3>
        <p style={{ margin: 0, lineHeight: 1.7, whiteSpace: "pre-line" }}>{body}</p>
      </section>)}
      <div className="public-actions" style={{ marginTop: 24 }}>
        <ActionButton onClick={() => router.back()}>돌아가기</ActionButton>
        <Link className="cs-button secondary" href="/login">로그인</Link>
      </div>
    </div>
  </Panel></div>;
}

export function LegalPages({ path }: { path: string }) {
  if (path === "/legal/terms") return <LegalDocument title="서비스 이용약관" updated="2026-10-07" sections={termsSections} />;
  if (path === "/legal/privacy") return <LegalDocument title="개인정보 처리방침" updated="2026-10-07" sections={privacySections} />;
  return null;
}
