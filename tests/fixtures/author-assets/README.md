# 작성자 자산 시험 자료

모두 이 저장소에서 작성한 합성 자료다. 고객 파일·쿠키·원본 사이트 자료를 사용하지 않는다.

- `content-types.xml`, `relationships.xml`, `document.xml`: 최소 DOCX package 부품. 시험의 ZIP builder가 store/deflate 및 두 descriptor 형태로 조립한다.
- `minimal.ps.ai`: 실행하지 않는 PostScript 기반 AI 계열 최소 경계 fixture. 실제 Illustrator 편집 가능성이나 완전한 AI parser 시험을 대신하지 않는다.
- PDF/JPEG/PNG는 전용 시험에서 메모리에만 생성한다. JPEG는 EXIF orientation을 포함하는 사례도 만든다.
- 손상 자료는 정상 생성 자료의 특정 헤더·CRC·구조를 시험에서 변경한다. payload를 실행하거나 외부 URL에 접근하지 않는다.

작성자는 시험을 실행하지 않았다. root가 테스트 로그와 실제 ClamAV/브라우저/Office 작성 파일 호환성을 별도 보존한다.
