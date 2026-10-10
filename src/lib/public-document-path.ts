// The source prefixes do not imply an internal document type.
// The server resolves the published document and its access state solely from the opaque token.
export function publicDocumentToken(path: string): string | undefined {
  return /^\/document\/(?:view|P|C|OC)\/([A-Za-z0-9_-]{43})$/.exec(path)?.[1];
}
