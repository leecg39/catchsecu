"use client";
import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { Modal } from "../shared";

const editable = (target: EventTarget | null) => target instanceof HTMLElement &&
  (!!target.closest("input, textarea, select, [contenteditable='true']") || target.isContentEditable);

const shortcuts: { keys: string[]; action: string }[] = [
  { keys: ["Ctrl", "K"], action: "명령 팔레트 열기 — 화면 검색·바로 이동 (⌘K)" },
  { keys: ["?"], action: "이 단축키 안내 열기" },
  { keys: ["↑", "↓"], action: "목록·옵션 사이 이동" },
  { keys: ["↵"], action: "선택한 항목 실행·이동" },
  { keys: ["Tab", "Shift+Tab"], action: "다음·이전 요소로 포커스 이동" },
  { keys: ["Esc"], action: "대화상자·메뉴 닫기" },
];

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey || editable(event.target)) return;
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <>
    <button type="button" className="ux-shortcut-open" aria-label="키보드 단축키 안내" aria-keyshortcuts="?" title="키보드 단축키 (?)"
      onClick={() => setOpen(true)}><Keyboard size={20} aria-hidden="true" /></button>
    {open && <Modal title="키보드 단축키" onClose={() => setOpen(false)}>
      <dl className="ux-shortcuts">
        {shortcuts.map(shortcut => <div key={shortcut.action}>
          <dt>{shortcut.keys.map(key => <kbd key={key}>{key}</kbd>)}</dt>
          <dd>{shortcut.action}</dd>
        </div>)}
      </dl>
    </Modal>}
  </>;
}
