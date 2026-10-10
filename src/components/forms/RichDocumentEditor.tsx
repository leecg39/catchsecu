"use client";
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import { parseRichDocumentHtml, RichHtmlError, serializeRichDocumentHtml } from "@/contracts/rich-content-html";
import {
  plainTextRichDocument, richDocumentSchema, richDocumentText,
  type RichBlock, type RichDocumentV1, type RichImage,
} from "@/contracts/rich-content";
import type { AuthorAssetPurpose, AuthorAssetUploadInfo } from "@/contracts/author-assets";
import { AuthorAssetUpload, type AuthorAssetEditContext } from "./AuthorAssetUpload";
import { useAuthorAssetResolver } from "./AuthorAssetProvider";
import { findRichImage, insertRichBlock, updateRichImage } from "./rich-editor-state";

type Props = {
  label: string;
  value?: RichDocumentV1 | null;
  fallbackText: string;
  purpose: AuthorAssetPurpose;
  disabled: boolean;
  context?: AuthorAssetEditContext;
  onChange: (document: RichDocumentV1, plainText: string) => void;
};

const sizes = [12, 14, 15, 16, 20, 24, 32] as const;
const htmlSizes: Record<string, number> = { "1": 12, "2": 14, "3": 15, "4": 16, "5": 20, "6": 24, "7": 32 };
const clone = (value: RichDocumentV1) => structuredClone(value);
const keyOf = (value: RichDocumentV1) => JSON.stringify(value);
const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeText = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function cleanEditorHtml(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[data-editor-index]").forEach(node => node.removeAttribute("data-editor-index"));
  copy.querySelectorAll("[contenteditable]").forEach(node => node.removeAttribute("contenteditable"));
  copy.querySelectorAll("figure.is-selected").forEach(node => node.classList.remove("is-selected"));
  copy.querySelectorAll("img[data-rich-asset-id]").forEach(node => {
    node.removeAttribute("src"); node.removeAttribute("draggable");
  });
  return copy.innerHTML;
}

function selectedBlock(root: HTMLElement, range?: Range): HTMLElement | undefined {
  const node = range?.startContainer;
  const element = node instanceof Element ? node : node?.parentElement;
  const block = element?.closest("p,h2,h3,h4") as HTMLElement | null;
  return block && root.contains(block) ? block : undefined;
}

function captionText(image: RichImage): string {
  return (image.caption ?? []).map(node => node.type === "text" ? node.text : node.type === "break" ? "\n"
    : node.children.map(child => child.type === "text" ? child.text : "\n").join("")).join("");
}

export function RichDocumentEditor({ label, value, fallbackText, purpose, disabled, context, onChange }: Props) {
  const initial = richDocumentSchema.parse(value ?? plainTextRichDocument(fallbackText));
  const current = useRef(initial), rootRef = useRef<HTMLDivElement>(null), selection = useRef<Range | undefined>(undefined), activeIndex = useRef<number | undefined>(undefined);
  const past = useRef<RichDocumentV1[]>([]), future = useRef<RichDocumentV1[]>([]);
  const resolver = useAuthorAssetResolver();
  const [snapshot, setSnapshot] = useState(initial), [history, setHistory] = useState({ undo: false, redo: false });
  const [error, setError] = useState(""), [activeImageId, setActiveImageId] = useState<string>();
  const [link, setLink] = useState("https://"), [media, setMedia] = useState(""), [fontSize, setFontSize] = useState<(typeof sizes)[number]>(14);
  const [fontColor, setFontColor] = useState("#000000"), [tableRows, setTableRows] = useState(2), [tableColumns, setTableColumns] = useState(2);
  const activeImage = activeImageId ? findRichImage(snapshot, activeImageId) : undefined;

  function decorate(root: HTMLElement) {
    Array.from(root.children).forEach((element, index) => element.setAttribute("data-editor-index", String(index)));
    root.querySelectorAll<HTMLImageElement>("img[data-rich-asset-id]").forEach(image => {
      const asset = resolver.find(image.dataset.richAssetId ?? "");
      if (asset) image.src = asset.url; else image.removeAttribute("src");
      image.draggable = false;
      const figure = image.closest("figure.image");
      figure?.setAttribute("contenteditable", "false");
      figure?.classList.toggle("is-selected", image.dataset.richNodeId === activeImageId);
    });
    root.querySelectorAll("figure.media").forEach(figure => figure.setAttribute("contenteditable", "false"));
  }

  function writeDom(document: RichDocumentV1) {
    const root = rootRef.current;
    if (!root) return;
    root.innerHTML = serializeRichDocumentHtml(document);
    decorate(root);
  }

  function notify(next: RichDocumentV1, record = true, rewrite = true) {
    const parsed = richDocumentSchema.parse(next);
    if (keyOf(parsed) === keyOf(current.current)) return;
    if (record) {
      past.current.push(clone(current.current));
      if (past.current.length > 100) past.current.shift();
      future.current = [];
    }
    current.current = parsed;
    if (rewrite) writeDom(parsed);
    setSnapshot(parsed); setHistory({ undo: past.current.length > 0, redo: false }); setError("");
    onChange(clone(parsed), richDocumentText(parsed));
  }

  function readDom(record = true) {
    const root = rootRef.current;
    if (!root) return;
    try {
      const parsed = parseRichDocumentHtml(cleanEditorHtml(root));
      notify(parsed, record, false); decorate(root); captureSelection();
    } catch (cause) {
      writeDom(current.current);
      setError(cause instanceof RichHtmlError ? cause.message : "본문 서식을 적용할 수 없습니다.");
    }
  }

  useEffect(() => { writeDom(current.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const incoming = richDocumentSchema.parse(value ?? plainTextRichDocument(fallbackText));
    if (keyOf(incoming) !== keyOf(current.current)) {
      current.current = incoming; past.current = []; future.current = []; setSnapshot(incoming); setHistory({ undo: false, redo: false }); setActiveImageId(undefined); writeDom(incoming);
    }
  }, [fallbackText, value]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rootRef.current) decorate(rootRef.current); });

  function captureSelection() {
    const root = rootRef.current, selected = globalThis.getSelection?.();
    if (!root || !selected?.rangeCount) return;
    const range = selected.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    selection.current = range.cloneRange();
    const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const indexed = element?.closest("[data-editor-index]") as HTMLElement | null;
    if (indexed?.dataset.editorIndex !== undefined) activeIndex.current = Number(indexed.dataset.editorIndex);
  }

  function restoreSelection() {
    const root = rootRef.current, selected = globalThis.getSelection?.();
    if (!root || !selected || !selection.current || !root.contains(selection.current.commonAncestorContainer)) return false;
    selected.removeAllRanges(); selected.addRange(selection.current); return true;
  }

  function command(name: string, argument?: string, normalize?: { size?: number; color?: string }) {
    const root = rootRef.current;
    if (disabled || !root) return;
    root.focus(); restoreSelection();
    globalThis.document.execCommand("styleWithCSS", false, "false");
    globalThis.document.execCommand(name, false, argument);
    root.querySelectorAll("font").forEach(font => {
      const span = globalThis.document.createElement("span"), size = font.getAttribute("size"), color = font.getAttribute("color");
      if (size) span.style.fontSize = `${normalize?.size ?? htmlSizes[size] ?? 14}px`;
      if (color) span.style.color = (normalize?.color ?? color).toLowerCase();
      while (font.firstChild) span.append(font.firstChild);
      font.replaceWith(span);
    });
    readDom();
  }

  function changeLayout(patch: { direction?: "ltr" | "rtl"; indent?: number }) {
    const root = rootRef.current;
    if (disabled || !root) return;
    restoreSelection();
    const block = selectedBlock(root, selection.current);
    if (!block) { setError("방향이나 들여쓰기를 바꿀 문단에 커서를 놓아주세요."); return; }
    if (patch.direction) block.dir = patch.direction;
    if (patch.indent !== undefined) block.dataset.richIndent = String(Math.max(0, Math.min(8, patch.indent)));
    readDom();
  }

  function indent(delta: number) {
    const root = rootRef.current; restoreSelection();
    const block = root ? selectedBlock(root, selection.current) : undefined;
    changeLayout({ indent: Number(block?.dataset.richIndent ?? 0) + delta });
  }

  function insertBlock(block: RichBlock) {
    if (disabled) return;
    notify(insertRichBlock(current.current, block, activeIndex.current));
  }

  function applyLink() {
    if (disabled) return;
    restoreSelection(); const selected = globalThis.getSelection?.();
    if (!link.trim()) { command("unlink"); return; }
    if (!selected || selected.isCollapsed) command("insertHTML", `<a href="${escapeAttribute(link.trim())}">${escapeText(link.trim())}</a>`);
    else command("createLink", link.trim());
  }

  function insertMedia() {
    if (!media.trim()) return;
    try {
      const block = parseRichDocumentHtml(`<oembed url="${escapeAttribute(media.trim())}"></oembed>`).blocks[0];
      if (block) { insertBlock(block); setMedia(""); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "미디어 주소를 확인해주세요."); }
  }

  function insertTable() {
    const paragraph = (): RichBlock => ({ type: "paragraph", children: [] });
    insertBlock({ type: "table", rows: Array.from({ length: tableRows }, (_, row) => Array.from({ length: tableColumns }, () => ({
      ...(row === 0 ? { header: true as const } : {}), children: [paragraph()],
    }))) });
  }

  function undo() {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(clone(current.current));
    current.current = previous; writeDom(previous); setSnapshot(previous); setHistory({ undo: past.current.length > 0, redo: true }); setError("");
    onChange(clone(previous), richDocumentText(previous));
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(clone(current.current));
    current.current = next; writeDom(next); setSnapshot(next); setHistory({ undo: true, redo: future.current.length > 0 }); setError("");
    onChange(clone(next), richDocumentText(next));
  }

  function editImage(update: (image: RichImage) => RichImage | null) {
    if (!activeImageId || disabled) return;
    const next = updateRichImage(current.current, activeImageId, update);
    notify(next);
    if (!findRichImage(next, activeImageId)) setActiveImageId(undefined);
  }

  function addImage(upload: AuthorAssetUploadInfo) {
    const image: RichImage = { type: "image", nodeId: crypto.randomUUID(), assetId: upload.id, alt: "", alignment: "center", width: { unit: "percent", value: 100 } };
    insertBlock(image); setActiveImageId(image.nodeId); return true;
  }

  function replaceImage(upload: AuthorAssetUploadInfo) {
    if (!activeImageId) return false;
    editImage(image => ({ ...image, assetId: upload.id })); return true;
  }

  function remember(event: MouseEvent<HTMLElement>) { event.preventDefault(); captureSelection(); }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") { event.preventDefault(); command("bold"); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") { event.preventDefault(); command("italic"); }
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = escapeText(event.clipboardData.getData("text/plain").replaceAll("\r\n", "\n").replaceAll("\r", "\n")).replaceAll("\n", "<br>");
    command("insertHTML", html);
  }

  function ensureParagraph() {
    const root = rootRef.current;
    if (!root || root.childNodes.length) return;
    root.innerHTML = "<p><br></p>"; decorate(root);
    const paragraph = root.firstElementChild;
    if (paragraph) {
      const range = globalThis.document.createRange(); range.selectNodeContents(paragraph); range.collapse(true);
      const selected = globalThis.getSelection?.(); selected?.removeAllRanges(); selected?.addRange(range); captureSelection();
    }
  }

  const imageTarget = activeImage ? `${activeImage.nodeId}:${activeImage.assetId}` : "none";
  return <div className="rich-editor" aria-disabled={disabled}>
    <div className="rich-editor-toolbar" role="toolbar" aria-label={`${label} 서식 도구`}>
      <select aria-label="문단 종류" disabled={disabled} defaultValue="p" onChange={event => command("formatBlock", event.target.value)}>
        <option value="p">본문</option><option value="h2">제목 2</option><option value="h3">제목 3</option><option value="h4">제목 4</option><option value="blockquote">인용</option>
      </select>
      <button type="button" disabled={disabled} aria-label="굵게" onMouseDown={remember} onClick={() => command("bold")}><strong>B</strong></button>
      <button type="button" disabled={disabled} aria-label="기울임" onMouseDown={remember} onClick={() => command("italic")}><em>I</em></button>
      <select aria-label="글자 크기" disabled={disabled} value={fontSize} onChange={event => { const size = Number(event.target.value) as (typeof sizes)[number]; setFontSize(size); command("fontSize", "7", { size }); }}>
        {sizes.map(size => <option key={size} value={size}>{size}px</option>)}</select>
      <label className="rich-editor-color">글자색<input aria-label="글자색" type="color" disabled={disabled} value={fontColor} onChange={event => { const color = event.target.value.toLowerCase(); setFontColor(color); command("foreColor", color, { color }); }} /></label>
      <button type="button" disabled={disabled} aria-label="글머리 목록" onMouseDown={remember} onClick={() => command("insertUnorderedList")}>• 목록</button>
      <button type="button" disabled={disabled} aria-label="번호 목록" onMouseDown={remember} onClick={() => command("insertOrderedList")}>1. 목록</button>
      <button type="button" disabled={disabled} aria-label="내어쓰기" onMouseDown={remember} onClick={() => indent(-1)}>내어쓰기</button>
      <button type="button" disabled={disabled} aria-label="들여쓰기" onMouseDown={remember} onClick={() => indent(1)}>들여쓰기</button>
      <button type="button" disabled={disabled} aria-label="왼쪽 정렬" onMouseDown={remember} onClick={() => command("justifyLeft")}>왼쪽</button>
      <button type="button" disabled={disabled} aria-label="가운데 정렬" onMouseDown={remember} onClick={() => command("justifyCenter")}>가운데</button>
      <button type="button" disabled={disabled} aria-label="오른쪽 정렬" onMouseDown={remember} onClick={() => command("justifyRight")}>오른쪽</button>
      <button type="button" disabled={disabled} aria-label="왼쪽에서 오른쪽" onMouseDown={remember} onClick={() => changeLayout({ direction: "ltr" })}>LTR</button>
      <button type="button" disabled={disabled} aria-label="오른쪽에서 왼쪽" onMouseDown={remember} onClick={() => changeLayout({ direction: "rtl" })}>RTL</button>
      <button type="button" disabled={disabled || !history.undo} aria-label="실행 취소" onMouseDown={remember} onClick={undo}>실행 취소</button>
      <button type="button" disabled={disabled || !history.redo} aria-label="다시 실행" onMouseDown={remember} onClick={redo}>다시 실행</button>
    </div>
    <div className="rich-editor-insert">
      <label>링크<input className="cs-input" aria-label="링크 주소" disabled={disabled} value={link} onChange={event => setLink(event.target.value)} /></label>
      <button type="button" disabled={disabled} onMouseDown={remember} onClick={applyLink}>링크 적용</button>
      <label>미디어<input className="cs-input" aria-label="YouTube 또는 Vimeo 주소" placeholder="https://…" disabled={disabled} value={media} onChange={event => setMedia(event.target.value)} /></label>
      <button type="button" disabled={disabled || !media.trim()} onClick={insertMedia}>미디어 삽입</button>
      <label>표 행<select aria-label="표 행 수" disabled={disabled} value={tableRows} onChange={event => setTableRows(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>열<select aria-label="표 열 수" disabled={disabled} value={tableColumns} onChange={event => setTableColumns(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map(value => <option key={value}>{value}</option>)}</select></label>
      <button type="button" disabled={disabled} onClick={insertTable}>표 삽입</button>
    </div>
    <div ref={rootRef} className="rich-editor-surface rich-document" role="textbox" aria-label={label} aria-multiline="true" aria-invalid={!!error}
      contentEditable={!disabled} suppressContentEditableWarning spellCheck onFocus={() => { globalThis.document.execCommand("defaultParagraphSeparator", false, "p"); ensureParagraph(); captureSelection(); }}
      onInput={() => readDom()} onKeyDown={keyDown} onKeyUp={captureSelection} onMouseUp={captureSelection} onSelect={captureSelection} onPaste={paste}
      onClick={event => {
        const target = event.target as Element, indexed = target.closest("[data-editor-index]") as HTMLElement | null;
        if (indexed?.dataset.editorIndex !== undefined) activeIndex.current = Number(indexed.dataset.editorIndex);
        const figure = target.closest("figure.image"), nodeId = figure?.querySelector("img")?.getAttribute("data-rich-node-id");
        if (nodeId) setActiveImageId(nodeId);
      }} />
    {error && <p className="rich-editor-error" role="alert">{error}</p>}
    <section className="rich-editor-assets" aria-label={`${label} 이미지`}>
      <h3>본문 이미지</h3>
      <AuthorAssetUpload purpose={purpose} label="이미지 추가" targetKey="new" context={context} disabled={disabled} onComplete={addImage} />
      {activeImage && <div className="rich-editor-image-settings">
        <h4>선택한 이미지 설정</h4>
        <label>대체 텍스트<input className="cs-input" aria-label="이미지 대체 텍스트" maxLength={1000} disabled={disabled} value={activeImage.alt} onChange={event => editImage(image => ({ ...image, alt: event.target.value }))} /></label>
        <label>캡션<input className="cs-input" aria-label="이미지 캡션" maxLength={1000} disabled={disabled} value={captionText(activeImage)} onChange={event => editImage(image => ({ ...image, caption: event.target.value ? [{ type: "text", text: event.target.value }] : undefined }))} /></label>
        <label>정렬<select aria-label="이미지 정렬" disabled={disabled} value={activeImage.alignment ?? "center"} onChange={event => editImage(image => ({ ...image, alignment: event.target.value as RichImage["alignment"] }))}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label>
        <label>폭<select aria-label="이미지 폭" disabled={disabled} value={activeImage.width?.unit === "percent" ? String(activeImage.width.value) : "original"} onChange={event => editImage(image => ({ ...image, width: event.target.value === "original" ? undefined : { unit: "percent", value: Number(event.target.value) } }))}><option value="original">원본 폭</option><option value="25">25%</option><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option></select></label>
        <AuthorAssetUpload purpose={purpose} label="이미지 교체" targetKey={imageTarget} context={context} disabled={disabled} onComplete={replaceImage} />
        <button type="button" disabled={disabled} onClick={() => editImage(() => null)}>이미지 삭제</button>
      </div>}
    </section>
  </div>;
}
