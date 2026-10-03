# 공급자 구현 전 확인 사항

2026-10-04. 사용자에게 공급자 이름을 질문했으며 아직 확인되지 않았다. 아래는 공식 문서를 읽은 참고 조사다. 공급자 선정, 원본 Catchsecu의 내부 공급자 확인, 실제 자격증명 연결 또는 sandbox 성공 기록이 아니다.

## 본인인증 참고: PortOne V2

공식 문서에는 단건 조회 `GET /identity-verifications/{identityVerificationId}`, 전송 `/send`, 확인 `/confirm`, 재전송 `/resend`와 READY/VERIFIED/FAILED 상태가 있다. 채널 타입은 LIVE/TEST를 구분하고 조회 결과는 인증된 고객 정보를 제공한다. [PortOne 공식 REST V2 본인인증 문서](https://developers.portone.io/api/rest-v2/identityVerification)

이 공급자가 선택되면 구현 전에 실제 store/channel·자격증명·전체 요청/응답 스키마를 확인한다. 서버가 발급한 요청 참조를 조회하고 저장한 회사/서비스/환경/채널과 실제 결과를 대조한다. 클라이언트가 보낸 성공 URL·이름·요청 참조만으로 승인하지 않는다. VERIFIED 결과의 고객 정보와 폼 답변/서명 수신자 연결 정책을 정한 뒤 개인정보는 필요한 암호화 자료만 보관한다. 이것은 이번 코드에서 호출하거나 통과한 기능이 아니다.

## 전자서명 참고: DocuSign Connect

공식 개발자 글은 `X-Docusign-Signature-1`의 Base64 서명을 SHA256 HMAC으로 검증하고 가공하지 않은 전체 요청 body를 사용할 것을 설명한다. [DocuSign 공식 HMAC 검증 설명](https://www.docusign.com/blog/developers/manually-authenticating-hmac-signatures-docusign-connect-webhook-configurations)

이 공급자가 선택되면 서버에서 허용된 계정/환경·HMAC 비밀을 읽고 body 크기 상한을 검사한 뒤 정확한 raw bytes로 검증한다. JSON 재직렬화 결과를 서명 검사에 쓰지 않는다. 검증 뒤에도 저장된 envelope/수신자/정확한 PDF hash·서비스·게시 버전과 실제 완료 상태를 조회해 대조하고, 중복 이벤트가 접수·증거·과금을 다시 만들지 않게 한다. 비밀·raw payload·인증 개인정보는 일반 로그에 남기지 않는다. 이번의 합성 DB `signatureValid=true` fixture는 이 HMAC 검증을 수행한 증거가 아니다.

## 공급자와 무관하게 남은 작업

1. 비밀 자격증명은 브라우저 설정 CRUD에 넣지 않고 서버에서 관리한다. 실제 공급자가 확인되면 해당 공급자의 공식 문서·sandbox 계정·허용 callback 주소를 다시 대조한다.
2. challenge의 nonce와 답변/동의/첨부 HMAC·문서/PDF hash·게시 버전·설정 세대를 고정한다. 공급자 결과를 그 요청과 연결한다.
3. 미검증 callback/본문 변조/다른 환경/다른 수신자/중복/만료/회수 요청을 거부한다. 공급자 장애·timeout 시 성공 자료를 만들지 않는다.
4. 정확한 증거의 일회 소비와 Submission/동의 영수증 저장을 같은 transaction에서 처리한다. 응답 유실 재전송과 접수 실패 롤백을 확인한다.
5. 인증 원문·provider 참조·임시 PDF의 보유/파기 작업과 관리자 안전 DTO·공개 인증/전자서명 화면을 연결한다.
6. 실제 sandbox 성공·실패·위조/중복 결과 ID와 현재 Ego UI 검증 전까지 P06-T06 완료를 체크하지 않는다.
