import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import type { Profile } from "@node-saml/node-saml";
import { fail } from "./http";

const protocol = "urn:oasis:names:tc:SAML:2.0:protocol";
const assertion = "urn:oasis:names:tc:SAML:2.0:assertion";
const bearer = "urn:oasis:names:tc:SAML:2.0:cm:bearer";
const maxBodyBytes = 1000000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function invalid(): never { fail(401, "SAML_STRUCTURE_INVALID", "SAML 인증 응답의 필수 정보를 확인할 수 없습니다."); }

function parse(xml: string) {
  if (!xml || Buffer.byteLength(xml) > maxBodyBytes || /<!DOCTYPE|<!ENTITY/i.test(xml)) invalid();
  try {
    const doc = new DOMParser({ errorHandler: { warning: invalid, error: invalid, fatalError: invalid } }).parseFromString(xml, "text/xml");
    if (!doc.documentElement || doc.doctype) invalid();
    return doc.documentElement;
  } catch { invalid(); }
}
function children(element: Element, namespace: string, name: string) {
  return Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1
    && (node as Element).namespaceURI === namespace && (node as Element).localName === name);
}
function one(element: Element, namespace: string, name: string) {
  const found = children(element, namespace, name);
  if (found.length !== 1) invalid();
  return found[0];
}
function text(element: Element) {
  if (Array.from(element.childNodes).some(node => node.nodeType === 1)) invalid();
  return element.textContent ?? "";
}

export async function readSamlPost(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded")
    fail(415, "CONTENT_TYPE", "SAML POST 형식을 확인해주세요.");
  if (Number(request.headers.get("content-length") || 0) > maxBodyBytes) fail(413, "BODY_TOO_LARGE", "인증 요청이 너무 큽니다.");
  const reader = request.body?.getReader();
  if (!reader) fail(422, "INVALID_CALLBACK", "SAML 응답이 없습니다.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBodyBytes) { await reader.cancel(); fail(413, "BODY_TOO_LARGE", "인증 요청이 너무 큽니다."); }
    chunks.push(next.value);
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  if (form.getAll("SAMLResponse").length !== 1 || form.getAll("RelayState").length !== 1)
    fail(422, "INVALID_CALLBACK", "인증 응답과 요청 식별자는 각각 하나만 전달해주세요.");
  return { SAMLResponse: form.get("SAMLResponse")!, RelayState: form.get("RelayState")! };
}

// Envelope fields can reject a response, but never establish an identity.
// Identity and bearer confirmation below come only from verified assertion XML.
export function validateSamlEnvelope(encoded: string, acs: string, requestHash: string) {
  const compact = encoded.replace(/\s/g, "");
  if (compact.length > maxBodyBytes || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) invalid();
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(compact, "base64")); }
  catch { invalid(); }
  const response = parse(xml);
  if (response.namespaceURI !== protocol || response.localName !== "Response" || response.getAttribute("Version") !== "2.0") invalid();
  if (hash(response.getAttribute("InResponseTo") ?? "") !== requestHash) invalid();
  if (response.hasAttribute("Destination") && response.getAttribute("Destination") !== acs)
    fail(401, "DESTINATION_MISMATCH", "SAML 응답 수신 주소가 일치하지 않습니다.");
  const status = one(one(response, protocol, "Status"), protocol, "StatusCode");
  if (status.getAttribute("Value") !== "urn:oasis:names:tc:SAML:2.0:status:Success")
    fail(401, "SAML_DENIED", "인증 제공자가 로그인을 승인하지 않았습니다.");
}

export function validatedSamlSubject(profile: Profile, issuer: string, acs: string, requestHash: string) {
  if (typeof profile.getAssertionXml !== "function") invalid();
  const root = parse(profile.getAssertionXml());
  if (root.namespaceURI !== assertion || root.localName !== "Assertion" || root.getAttribute("Version") !== "2.0") invalid();
  if (text(one(root, assertion, "Issuer")) !== issuer || profile.issuer !== issuer)
    fail(401, "ISSUER_MISMATCH", "SAML 발급자가 설정된 IdP와 일치하지 않습니다.");
  if (!children(root, assertion, "AuthnStatement").length) invalid();
  const subject = one(root, assertion, "Subject");
  const nameId = text(one(subject, assertion, "NameID"));
  if (!nameId.trim() || nameId.length > 300 || nameId !== profile.nameID) invalid();
  const confirmed = children(subject, assertion, "SubjectConfirmation").some(confirmation => {
    if (confirmation.getAttribute("Method") !== bearer) return false;
    const items = children(confirmation, assertion, "SubjectConfirmationData");
    if (items.length !== 1) return false;
    const data = items[0], expiry = Date.parse(data.getAttribute("NotOnOrAfter") ?? "");
    return data.getAttribute("Recipient") === acs && !data.hasAttribute("NotBefore")
      && hash(data.getAttribute("InResponseTo") ?? "") === requestHash
      && Number.isFinite(expiry) && expiry > Date.now() - 60000;
  });
  if (!confirmed) fail(401, "SUBJECT_CONFIRMATION_INVALID", "SAML 사용자 확인의 수신 주소·요청·유효기간이 올바르지 않습니다.");
  return nameId;
}
