# 업무 비서 (worklog)

메일플러그 받은편지함·카톡/메신저 캡처·웹 대화에서 **할 일을 자동으로 뽑아** 구글 시트에 쌓고, 메일(또는 네이버웍스 봇)로 **아침 브리핑 / 팀원 리마인드 / 일일업무보고 초안**을 보내는 개인 비서. Gemini·Claude 키를 넣으면 자연어 대화로 할 일·달력 일정을 처리하며(가벼운 건 Gemini, 어려운 건 Claude 자동 배분, 월 예산 상한), 키가 없으면 규칙 기반으로만 동작합니다.

설치는 **[SETUP.md](./SETUP.md)** 를 따라가세요 (비개발자용, 단계별).

## 구성

```
├─ api/            Vercel 서버리스 함수
│  ├─ chat.js      웹페이지 '대화' 탭 (봇과 같은 명령·대화형 정리, PIN 인증)
│  ├─ callback.js  네이버웍스 봇 Callback (선택; 서명 검증 → 명령/수집 → 답장)
│  ├─ tick.js      정기 작업 (메일 수집, 브리핑, 리마인드, 보고 요청/초안) — 매시간 호출
│  ├─ tasks.js     웹페이지용 조회/수정 (x-pin 헤더)
│  ├─ import.js    카카오톡 txt / 붙여넣기 → 후보
│  ├─ vision.js    캡처 이미지 → 텍스트 (Gemini)
│  ├─ events.js    달력 탭 CRUD
│  ├─ ical.js      폰 캘린더 구독용 iCal 피드 (?key=TICK_KEY)
│  └─ check.js     설정 점검
├─ lib/
│  ├─ extract.js   규칙 기반 할 일 추출 (요청/약속/완료 표현, 팀원 언급, 제목 다듬기)
│  ├─ dates.js     KST + 한국어 날짜 표현 ("내일", "금요일까지", "9/30", "다음 주 월요일", "월말")
│  ├─ kakao.js     카카오톡 대화 내보내기 파서 (PC/안드로이드/아이폰)
│  ├─ commands.js  봇 명령 + 대화형 '정리' 모드 + 팀원 등록/보고
│  ├─ brief.js     브리핑/보고 초안/리마인드 문구
│  ├─ jobs.js      정기 작업 로직 (중복 발송 방지)
│  ├─ works.js     네이버웍스 API 2.0 (서비스 계정 JWT, 메시지 전송, 콜백 서명 검증)
│  ├─ mail.js      IMAP (imapflow + mailparser, 읽음 표시 안 함)
│  ├─ mailer.js    SMTP 알림 메일 (nodemailer) + 답장 본문 추출
│  ├─ notify.js    알림 채널 선택 (네이버웍스 봇 / 이메일)
│  ├─ calendar.js  나만의 달력 (구글 시트 events 탭): 조회·등록·수정·삭제, iCal 구독 피드
│  └─ ai/
│     ├─ assistant.js  비서 본체: 시스템 프롬프트(오늘 날짜·팀·진행 업무·일정) + 도구 루프, AI 추출, 캡처 읽기
│     ├─ tools.js      공용 도구 정의/실행 (add_task, update_task, list_tasks, get_calendar, create_event, …)
│     ├─ router.js     Gemini/Claude 자동 배분 + 월 비용 추정·예산
│     ├─ gemini.js     Gemini REST (generateContent, function calling, JSON, vision)
│     └─ claude.js     Anthropic SDK (claude-opus-5, strict tools, manual loop)
│  └─ gas.js       구글 시트(Apps Script) 클라이언트 + 테스트용 메모리 구현
├─ apps-script/Code.gs   시트 백엔드 + 매시간 트리거
├─ public/               웹페이지 (빌드 없음; 캡처 이미지는 브라우저 안 tesseract.js 로 글자 인식)
└─ test/                 node --test
```

## 개발

```bash
npm install
npm test          # 단위 테스트
```

Vercel 에 이 저장소를 그대로 Import 하면 됩니다 (Framework Preset: Other, 빌드 없음). 환경변수는 `.env.example` 참고.
