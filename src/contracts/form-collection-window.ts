import { z } from "zod";

export const collectionWindowTime = z.iso.datetime({ offset: true }).nullable();

export type CollectionWindow = {
  collectionOpenAt?: string | null;
  collectionCloseAt?: string | null;
};

export function collectionWindowIssue(window: CollectionWindow) {
  const open = window.collectionOpenAt ? new Date(window.collectionOpenAt).getTime() : null;
  const close = window.collectionCloseAt ? new Date(window.collectionCloseAt).getTime() : null;
  if (open !== null && close !== null && close <= open) return "응답 종료 일시는 시작 일시보다 이후여야 합니다.";
  return null;
}

export function validateCollectionWindowForPublish(window: CollectionWindow, now = new Date()) {
  const issue = collectionWindowIssue(window);
  if (issue) throw new Error(issue);
  if (window.collectionOpenAt && new Date(window.collectionOpenAt) <= now)
    throw new Error("응답 시작 일시는 현재보다 이후로 설정하거나 자동 시작을 해제해주세요.");
  if (window.collectionCloseAt && new Date(window.collectionCloseAt) <= now)
    throw new Error("응답 종료 일시는 현재보다 이후로 설정해주세요.");
}

export function datetimeLocalValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function datetimeLocalIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
