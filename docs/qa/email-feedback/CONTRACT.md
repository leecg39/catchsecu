# 이메일 결과·수신거부 계약

2026-10-03. 원본 화면에서 공급자 webhook 형식을 관찰하지 못했으므로 독립 구현 계약으로 기록한다.

## 결과 릴레이

`POST /api/v1/email-feedback`는 서버 운영자가 관리하는 릴레이 전용이다. 일반 사용자의 세션·쿠키·요청 Origin을 인증 수단으로 사용하지 않는다. `EMAIL_FEEDBACK_SECRET`이 없으면 503이다. 키는 32~128글자이고 다른 용도의 비밀값과 분리한다.

JSON 필드는 `eventId`, `jobId`, `type`, `occurredAt`만 허용한다. `type`은 `delivered`, `soft_bounce`, `hard_bounce`, `complaint`다. 이메일 주소나 회사/서비스 ID를 요청에서 받지 않는다. `jobId`는 보낸 메일의 Message-ID에 포함된 내부 Job UUID와 대응해야 한다. 실제 공급자의 ID·이벤트 변환과 공급자 서명 검증은 이 릴레이를 호출하기 전에 수행해야 하며 아직 연결되지 않았다.

- 본문 최대 16KB. `X-Email-Timestamp`는 10자리 Unix 초이며 서버 시각과 차이가 300초 이하여야 한다.
- `X-Email-Signature`는 `v1=` 뒤에 HMAC-SHA256의 64자리 소문자 hex다. 서명 입력은 **timestamp + 점 + 수신한 원시 본문 바이트**다. 상수 시간 비교를 사용한다.
- 인증 후 분당 600건으로 제한한다. 같은 eventId와 같은 본문은 202/duplicate, 다른 본문은 409다. 한 작업에 최대 100개 릴레이 이벤트를 보존한다.
- 실제 Job→수신자→캠페인의 회사·서비스·이메일 HMAC 해시를 사용한다. SMTP 접수/로컬 전달 완료 또는 결과 불확실 상태의 실제 시도에만 연결한다. 아직 전달하지 않은 작업은 409다.
- 작업 생성 후 90일 이내, 이벤트 시각은 작업 생성 5분 전부터 서버 현재 5분 후까지 허용한다. 원문·인증 토큰·공급자 자유 텍스트를 DB 이력에 저장하지 않는다.

## 수신거부

이메일 캠페인 본문에는 작업에 바인딩된 수신거부 링크를 자동으로 추가한다. 토큰은 UUID와 용도를 분리한 서버 HMAC이다. `/email/unsubscribe/:token`은 공개 확인 화면이고 API는 `/api/v1/email-unsubscribe/:token`이다.

GET은 회사·서비스와 확인 상태만 읽는다. one-click 헤더는 `?confirmPage=1`을 붙인 API URL을 사용한다. 이 URL의 GET만 확인 화면으로 302 이동하고, POST는 API에서 직접 처리하여 리디렉션하지 않는다. JSON `{confirm:true}`, form-urlencoded 또는 multipart의 단일 `List-Unsubscribe=One-Click` POST로 확인한다. 쿠키·로그인 없이 토큰으로만 범위를 결정한다. 확인을 반복해도 하나의 수신거부 이력과 차단 기록만 생성한다. 작업 생성 후 90일이 지나면 410이다. 링크는 감사/증거 문서에 저장하지 않고 no-referrer·noindex·no-store를 적용한다.

[RFC 8058](https://www.rfc-editor.org/rfc/rfc8058)은 자동 GET과 구별되는 확인 POST 및 one-click의 HTTPS·DKIM 조건을 정의한다. 이 구현은 form POST를 지원한다. `List-Unsubscribe-Post` 광고는 HTTPS URL과 `SMTP_LIST_UNSUBSCRIBE_DKIM_SIGNED=true`가 함께 있는 경우만 한다. 설정 값은 운영자가 공급자의 실제 DKIM 서명 범위를 확인한 뒤 켜야 한다. 로컬 HTTP 검증에서는 꺼두었다. [Nodemailer 헤더 문서](https://nodemailer.com/message/list-headers).

## 차단과 상태

- `EmailFeedback`는 불변 원천 이력, `EmailSuppression`은 원천 이력과 같은 회사·서비스·이메일 해시에 연결된 불변 차단이다. 복합 FK와 DB 트리거로 범위·상태·시간·수정/삭제를 검사한다.
- 수신거부·영구 반송·신고는 즉시 차단 근거가 된다. 일시 반송은 최근 7일의 서로 다른 3개 작업을 세며, 전달 확인 이력이 있는 작업은 빼고 센다. 중복 이벤트로 횟수가 늘지 않는다.
- 뒤늦은 전달 이벤트나 재동의는 이미 생긴 차단을 해제하지 않는다. 운영 정책을 정하지 않은 임의 해제 버튼은 제공하지 않는다.
- 원래의 SMTP 접수/로컬 전달/불확실 상태를 보존하고 이후 수신 결과를 별도로 표시한다. 화면의 대표 결과는 신고→영구 반송→수신거부→전달→일시 반송 순이다. 같은 종류는 최근 발생 시각을 사용한다.
- 원문 동의/응답 삭제 후에도 HMAC 해시와 최소 이벤트는 재발송 방지용으로 남긴다. 관리자 차단 목록의 원문은 현재 동의 보유 기한과 권한을 재검사한 경우에만 표시한다.
- 마케팅 메일과 일반 서비스 업무 메일의 생성/전송, 캠페인 미리보기·요청·전송 직전에 차단을 확인한다. 인증·암호 복구 메일은 기존 별도 경로를 유지한다. 작업에 로그인이나 보안 계정 유지 메일을 마케팅 동의로 종속시키지 않는다.
- 신규 캠페인은 `mail.campaign.v3`이다. 기존 v1/v2 작업도 새 worker가 처리하지만, 새 작업은 이전 worker가 보내지 못한다. 적용할 때 동일 프로젝트의 앱/worker를 중지하고 migration 38 및 동일 코드로 재시작했다.

## 검증 경계

합성 릴레이의 실제 HTTP·HMAC·PostgreSQL·로컬 메일·Ego 검증과 외부 공급자의 결과 확인은 다른 단계다. 실제 외부 SMTP 수신함, 공급자 서명 어댑터, DKIM/HTTPS, 반송·신고 재현은 미검증이다. 저수준 `enqueueMarketingMail`의 기존 내부 경로에는 새 공개 링크가 붙지 않으며, 현재 메뉴의 캠페인 발송 경로에는 붙는다. 이 내부 경로의 통합 및 차단 해제/보존 정책도 전체 Task의 후속 범위다.
