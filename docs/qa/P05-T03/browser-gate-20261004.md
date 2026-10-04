# P05-T03 공개 문서·안내 경로 — live HTTP·브라우저 증거 (2026-10-04)

미인증 공개 경로를 curl + Chrome(DevTools MCP)으로 실검증. dev 서버(3100) + `catchsecu_dev`.

## 카탈로그 `GET /api/v1/public/services/{serviceId}/documents`
- `view` 필수: 미지정 → 422 + `fieldErrors.view` 허용값 열거(collection|recipients|overseas|resident)
- `view=collection` → "수집 동의 fixture" 1건, `view=overseas` → "국외이전 fixture" 1건, `view=recipients`·`resident` → 빈 목록 — 뷰 필터 동작
- `?agree=xx` → 422, `?bogus=1` → 422(미지원 키 거부), `view=everything` → 422
- 응답 필드: `serviceName`·`companyName`·items[{title,type,number,effectiveDate,contentHash,url}] — tokenHash·tokenCipher·tenantId 등 내부 필드 미노출

## 문서 상세 `GET /api/v1/public/documents/{token}`
- 활성 fixture 토큰 → 200, 게시 시점 스냅샷(snapshot+renderedText+contentHash) 반환
- 실제 발행 문서 토큰(`0dFO…yGQ`) → 200, 키 `[number,publishedAt,expiresAt,snapshot,renderedText,contentHash]`만 — 민감 필드 없음 확인
- 없는 토큰 → 404

## 만료·회수 → 410
- 만료 발행 토큰 2건(`B6Jj…Qr8`, `3-A_…Bzdc`, expiresAt 경과) → 410 `DOCUMENT_CLOSED` "공개가 종료되었거나 만료된 문서입니다."
- 과거 공개 URL 토큰(`uK3E…5KM`, 회수됨) → 410 — 회수 즉시성

## HTML 공개 페이지 `/document/view/{token}`
- 활성: 브라우저 렌더 — "게시 버전 v1 · 2026. 10. 3. 오후 12:14:32", 본문 텍스트, "PDF 다운로드" 버튼, "문서 해시 (SHA-256)" 펼침. 앱 셸·내비 없는 순수 공개 화면
- 만료: "문서를 열 수 없습니다." + "공개가 종료되었거나 만료된 문서입니다." 오류 화면

## PDF `GET …/pdf`
- 실제 발행 문서 → 200 `application/pdf` 46,350바이트, `%PDF-1` 헤더 + `%%EOF` 트레일러 실바이트
- 해시 불일치 fixture 문서 → 409 `DOCUMENT_INTEGRITY` "게시 문서의 검증 정보가 일치하지 않습니다." — canonical 해시 재계산 후 불일치 시 PDF 생성 거부하는 무결성 방어 동작(시드가 renderedText 해시를 쓴 데이터 불일치 케이스)

## 판정
- 정상·만료·회수 토큰 분기(200/410/404), agree·view·미지원 파라미터 422, 공개 필드만 반환이 live에서 확인됨.
- 브라우저에서 문서·오류 화면이 실제 렌더됨. Rate limit(분당 60회)은 서버 스위트 증거로 커버.
