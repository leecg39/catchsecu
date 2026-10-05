"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { navEntries, searchNav, type NavEntry } from "./nav-index";
import { useDialogFocus } from "./focus";
import { useNavigationGuard } from "./navigation-guard";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setOpen(value => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <>
    <button type="button" className="ux-palette-trigger" onClick={() => setOpen(true)} aria-keyshortcuts="Control+K Meta+K">
      <Search size={15} aria-hidden="true" /><span>검색</span><kbd aria-hidden="true">Ctrl K</kbd>
    </button>
    {open && <PaletteDialog onClose={() => setOpen(false)} />}
  </>;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLElement>(null), listId = useId();
  const [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const router = useRouter(), guard = useNavigationGuard();
  useDialogFocus(ref, onClose, "input");
  const results = useMemo(() => searchNav(navEntries, query).slice(0, 12), [query]);
  const index = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [index, listId]);

  const go = (entry: NavEntry) => {
    onClose();
    if (!guard.blocked()) { router.push(entry.path); return; }
    void guard.confirmLeave().then(leave => { if (leave) router.push(entry.path); });
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!results.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index + 1) % results.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index + results.length - 1) % results.length); }
    else if (event.key === "Enter") { event.preventDefault(); go(results[index]); }
  };

  return <div className="cs-backdrop ux-palette-backdrop" onClick={onClose}>
    <section ref={ref} className="cs-modal ux-palette" role="dialog" aria-modal="true" aria-label="명령 팔레트" tabIndex={-1} onClick={event => event.stopPropagation()}>
      <div className="ux-palette-input">
        <Search size={17} aria-hidden="true" />
        <input role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={`${listId}-${index}`}
          aria-autocomplete="list" aria-label="메뉴 검색" placeholder="화면·메뉴 이름 검색 (초성 가능)" autoComplete="off"
          value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKeyDown} />
        <kbd aria-hidden="true">esc</kbd>
      </div>
      <ul className="ux-palette-list" role="listbox" id={listId} aria-label="검색 결과">
        {results.map((entry, i) => <li key={entry.path + entry.label} id={`${listId}-${i}`} role="option" aria-selected={i === index}
          className={i === index ? "active" : ""} onMouseEnter={() => setActive(i)} onClick={() => go(entry)}>
          <span className="ux-palette-label">{entry.label}</span>
          <span className="ux-palette-group">{entry.group}</span>
        </li>)}
        {!results.length && <li className="ux-palette-empty" role="option" aria-selected="false" aria-disabled="true">“{query}”와 일치하는 화면이 없습니다</li>}
      </ul>
      <footer className="ux-palette-hints">
        <span><kbd>↑</kbd><kbd>↓</kbd> 선택</span><span><kbd>↵</kbd> 이동</span><span><kbd>?</kbd> 단축키 안내</span>
      </footer>
    </section>
  </div>;
}
