"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { AuthorAssetInfo, AuthorAssetManifest } from "@/contracts/author-assets";
import { useResource } from "@/lib/api";
import { authorAssetDownloadPath, authorAssetManifestPath, authorAssetUploadDownloadPath, type AuthorAssetViewScope } from "@/lib/author-assets";

type ResolvedAsset = { info: AuthorAssetInfo; url: string };
const Context = createContext<{ find: (id: string) => ResolvedAsset | undefined; loading: boolean; error?: string }>({ find: () => undefined, loading: false });
export function AuthorAssetProvider({ scope, enabled, uploads = [], children }: {
  scope: AuthorAssetViewScope | null; enabled: boolean; uploads?: AuthorAssetInfo[]; children?: ReactNode;
}) {
  const resource = useResource<AuthorAssetManifest>(enabled && scope ? authorAssetManifestPath(scope) : null);
  const find = (id: string): ResolvedAsset | undefined => {
    const saved = resource.data?.items.find(item => item.id === id && item.status === "ready");
    if (saved && scope) return { info: saved, url: authorAssetDownloadPath(scope, id) };
    const pending = uploads.find(item => item.id === id && item.status === "ready");
    return pending ? { info: pending, url: authorAssetUploadDownloadPath(id) } : undefined;
  };
  return <Context.Provider value={{ find, loading: resource.loading, error: resource.error?.message }}>{children}</Context.Provider>;
}
export function useAuthorAsset(id: string | null | undefined) {
  const context = useContext(Context);
  return { asset: id ? context.find(id) : undefined, loading: context.loading, error: context.error };
}
export function useAuthorAssetResolver() {
  return useContext(Context);
}
