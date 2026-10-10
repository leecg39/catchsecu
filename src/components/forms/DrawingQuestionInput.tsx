"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Question } from "@/contracts/forms";

type Point = { x: number; y: number };
const HEIGHT = 120;

/** A drawn image is an attachment; it is not an identity-verification signature. */
export function DrawingQuestionInput({ question, file, savedPreview, hasSaved, disabled = false, onFileChange }: {
  question: Question; file?: File; savedPreview?: string; hasSaved?: boolean; disabled?: boolean;
  onFileChange: (file?: File) => void;
}) {
  const [editing, setEditing] = useState(!file && !hasSaved);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), applyButton = useRef<HTMLButtonElement>(null);
  const preview = useRef<HTMLImageElement>(null);
  const strokes = useRef<Point[][]>([]), pointer = useRef<number | null>(null);
  const applied = !!file || !!hasSaved;
  useEffect(() => {
    if (!file || !preview.current) return;
    const url = URL.createObjectURL(file);
    preview.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, editing]);
  function paint() {
    const element = canvas.current, ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const width = element.getBoundingClientRect().width, ratio = window.devicePixelRatio || 1;
    if (width <= 0) return;
    element.width = Math.round(width * ratio); element.height = Math.round(HEIGHT * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, HEIGHT);
    ctx.strokeStyle = "#000"; ctx.fillStyle = "#000"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const stroke of strokes.current) {
      const first = stroke[0]; if (!first) continue;
      ctx.beginPath(); ctx.arc(first.x * width, first.y * HEIGHT, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(first.x * width, first.y * HEIGHT);
      for (const point of stroke.slice(1)) ctx.lineTo(point.x * width, point.y * HEIGHT);
      ctx.stroke();
    }
  }
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    paint(); const observer = new ResizeObserver(paint); observer.observe(element);
    return () => observer.disconnect();
  }, [editing]);
  useEffect(() => {
    const form = root.current?.closest("form");
    const validate = (event: SubmitEvent) => {
      if (disabled || root.current?.closest("fieldset:disabled")) return;
      if (applied || !question.required && !strokes.current.length) return;
      event.preventDefault(); event.stopImmediatePropagation();
      setError(strokes.current.length ? "그림을 적용한 뒤 제출해주세요." : "그림을 입력하고 적용해주세요.");
      applyButton.current?.focus();
    };
    form?.addEventListener("submit", validate, true);
    return () => form?.removeEventListener("submit", validate, true);
  }, [applied, disabled, question.required]);
  function locked() { return disabled || !!root.current?.closest("fieldset:disabled"); }
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function clear() { if (locked()) return; strokes.current = []; pointer.current = null; onFileChange(); setError(""); paint(); }
  function apply() {
    if (locked()) return;
    if (!strokes.current.length || !canvas.current) { setError("빈 그림은 적용할 수 없습니다. 그림을 입력해주세요."); return; }
    // Synchronous export keeps an old asynchronous callback from changing a submitting form.
    try {
      const data = atob(canvas.current.toDataURL("image/png").split(",")[1]);
      const bytes = Uint8Array.from(data, char => char.charCodeAt(0));
      onFileChange(new File([bytes], "userSignImage.png", { type: "image/png" }));
      setEditing(false); setError(""); pointer.current = null;
    } catch { setError("그림을 저장하지 못했습니다. 다시 적용해주세요."); }
  }
  return <div ref={root} className="forms-drawing" data-question-id={question.id}>
    {editing ? <>
      <p className="cs-muted" id={question.id + "-drawing-hint"}>아래 영역에 그린 뒤 적용하기를 눌러주세요.</p>
      <canvas ref={canvas} aria-label={question.label + " 그리기 영역"} aria-describedby={question.id + "-drawing-hint"}
        data-disabled={disabled} role="img" style={{ height: HEIGHT }}
        onPointerDown={event => {
          if (locked() || pointer.current !== null || event.button !== 0) return;
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pointer.current = event.pointerId;
          strokes.current.push([point(event)]); setError(""); paint();
        }} onPointerMove={event => {
          if (locked() || pointer.current !== event.pointerId) return;
          strokes.current.at(-1)?.push(point(event)); paint();
        }} onPointerUp={event => { if (pointer.current === event.pointerId) pointer.current = null; }}
        onPointerCancel={() => { pointer.current = null; }} onLostPointerCapture={() => { pointer.current = null; }} />
      <div className="forms-actions"><button type="button" className="cs-button secondary" disabled={disabled} onClick={clear}>지우기</button>
        <button ref={applyButton} type="button" className="cs-button" disabled={disabled} onClick={apply}>적용하기</button>
        {applied && <button type="button" className="cs-button secondary" disabled={disabled} onClick={() => { if (!locked()) { strokes.current = []; setEditing(false); setError(""); } }}>이전</button>}</div>
    </> : <>
      {/* Blob previews and authenticated downloads must stay in the user's browser. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {file || savedPreview ? <img ref={preview} className="forms-drawing-preview" src={file ? undefined : savedPreview} alt={question.label + " 적용된 그림"} /> : <p>저장된 그림이 있습니다.</p>}
      <div className="forms-actions"><button type="button" className="cs-button secondary" disabled={disabled} onClick={() => { if (!locked()) { strokes.current = []; setEditing(true); setError(""); } }}>다시 입력하기</button>
        {!question.required && <button type="button" className="cs-button secondary" disabled={disabled} onClick={() => { if (!locked()) { onFileChange(); strokes.current = []; setEditing(true); setError(""); } }}>그림 비우기</button>}</div>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
