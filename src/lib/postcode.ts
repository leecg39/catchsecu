export type PostcodeResult = { zonecode: string; address: string };
type PostcodeOptions = { oncomplete: (value: PostcodeResult) => void; onresize?: (size: { height: number }) => void; width: string; height: number; minWidth: number };
type PostcodeConstructor = new (options: PostcodeOptions) => { embed: (element: HTMLElement) => void };
let pending: Promise<PostcodeConstructor> | undefined;
const installed = () => (window as Window & { kakao?: { Postcode?: PostcodeConstructor } }).kakao?.Postcode;

/** Load the provider only after an explicit address-search action. */
export function loadPostcode(): Promise<PostcodeConstructor> {
  const existing = installed();
  if (existing) return Promise.resolve(existing);
  if (pending) return pending;
  pending = new Promise<PostcodeConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
    script.async = true; script.referrerPolicy = "no-referrer";
    const clear = () => { clearTimeout(timer); script.onload = null; script.onerror = null; };
    const failed = () => { clear(); script.remove(); reject(new Error("주소 검색을 불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요.")); };
    const timer = setTimeout(failed, 15000);
    script.onerror = failed;
    script.onload = () => { const constructor = installed(); if (!constructor) { failed(); return; } clear(); resolve(constructor); };
    document.head.appendChild(script);
  }).catch(error => { pending = undefined; throw error; });
  return pending;
}
