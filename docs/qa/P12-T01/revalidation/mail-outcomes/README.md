# 발송 작업·캠페인 결과 감사

2026-10-04. Job/JobAttempt/수신자·전달 상태/캠페인 상태와 원장 기록을 같은 transaction에 두었다. local_delivered와 SMTP accepted, 실패·수신거부·receipt 저장 실패·lease 소진을 구분하고 고정 enum/횟수만 저장한다. 마지막 lease 기한도 검사한다. 회사 미지정 인증 메일을 포함해 tenantId와 정확한 jobId를 함께 지정하는 worker 범위를 추가했다.

[fixture 오류](baseline-fixture-attempt.log)와 [실제 이전 구현7실패](baseline.log)를 보존했다. [6파일239개](tests-attempt1.log)가 통과했고, 추가적인 마지막 lease/소진 롤백/null-tenant 정확 범위를 포함한 [2파일17개](tests-final.log)도 통과했다(신규 mail10 + 종류별 감사7). 캠페인에도 결과 감사 fault/2worker 검사를 추가했다.

[실제 로컬 전달](../../completion/mail-receipt.json)은 지정한 초대 작업1건만 처리했다. Job done·시도1건·원장1건·로컬 메일 파일을 독립 조회했다. 전역 worker와 외부 SMTP 발송은 실행하지 않았다. 외부 전송과 DB commit의 분산 원자성은 주장하지 않으며 불확실 상태의 무조건 재전송을 피한다. [최종 통합 검증](../../completion/README.md).
