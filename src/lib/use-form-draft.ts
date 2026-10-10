"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { formInput } from "@/contracts/domains";
import { validateQuestionDefinitions } from "@/contracts/questions";
import type { FormRecord } from "@/contracts/forms";
import { api } from "./api";
import { FormDraftSession, type FormDraftValue } from "./form-draft";

function validate(value: FormDraftValue) {
  const result = formInput.safeParse(value);
  if (!result.success) throw new Error("제목·질문·선택 항목과 설정 범위를 확인해주세요.");
  const content = result.data.content;
  validateQuestionDefinitions(content.questions, false, content.marketing ? [content.marketing.nameQuestionId, content.marketing.emailQuestionId, content.marketing.smsQuestionId, content.marketing.kakaoQuestionId].filter((id): id is string => !!id) : []);
  return result.data;
}
export function useFormDraft(initial: FormRecord | undefined, seed: FormDraftValue, enabled = true, confirmNavigation?: () => Promise<boolean>) {
  const router = useRouter();
  const [session] = useState(() => new FormDraftSession({ initial, seed, validate,
    persist: (record, value, key) => api<FormRecord>(record ? "/forms/" + record.id + "/draft" : "/forms", {
      method: record ? "PATCH" : "POST", headers: { "Idempotency-Key": key },
      body: JSON.stringify(record ? { version: record.version, title: value.title, content: value.content } : value),
    }) }));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [navigationTarget, setNavigationTarget] = useState("");
  useEffect(() => { if (enabled) session.start(); return () => session.stop(); }, [session, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (session.getSnapshot().dirty) { event.preventDefault(); event.returnValue = ""; }
    };
    const navigate = (event: MouseEvent) => {
      if (!session.getSnapshot().dirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.download || (anchor.target && anchor.target !== "_self")) return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin || !["http:", "https:"].includes(url.protocol)) return;
      const target = url.pathname + url.search + url.hash;
      event.preventDefault(); event.stopPropagation(); setNavigationTarget(target);
      void session.save().then(async record => {
        if (!record || session.getSnapshot().dirty || confirmNavigation && !await confirmNavigation()) return;
        router.push(target);
      });
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [confirmNavigation, enabled, router, session]);
  return { ...snapshot, getSnapshot: session.getSnapshot, pauseSaving: session.pauseSaving, creationPending: session.hasPendingCreation(), saving: snapshot.phase === "saving", edit: (value: FormDraftValue | ((current: FormDraftValue) => FormDraftValue)) => session.edit(typeof value === "function" ? value(session.getSnapshot().value) : value),
    save: (force = false) => session.save(force), navigationTarget,
    discardNavigation: () => { session.stop(); router.push(navigationTarget); },
    cancelNavigation: () => setNavigationTarget(""),
    reload: async () => { if (snapshot.record) session.load(await api<FormRecord>("/forms/" + snapshot.record.id)); },
    accept: (record: FormRecord) => session.load(record) };
}
export type FormDraftState = ReturnType<typeof useFormDraft>;
