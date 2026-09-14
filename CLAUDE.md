# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 프로젝트 개요입니다.
하위 `insurance_agent/CLAUDE.md`는 AI 어시스턴트 자체의 상세 아키텍처를 다루고,
이 파일은 **두 프로젝트의 통합 지점**을 다룹니다.

## 프로젝트 개요

`C:\test_agent\insurance_agent`(보험상담 AI 어시스턴트)와
`C:\test_blockchain-dental`(블록체인 덴탈보험 dApp) 두 개의 별도 프로젝트를 결합한
캡스톤 프로젝트. 목표: AI 챗봇에서 "블록체인 덴탈보험"을 추천받고 가입 버튼을
누르면, 별도 폴더의 Hardhat/Node 블록체인 dApp이 자동으로 기동되어 실제 가입까지
이어지도록 연동하는 것.

- GitHub: https://github.com/leeyonsei78/capstone_project (public repo, owner: `leeyonsei78`)
- 새 PC 설치: [SETUP.md](./SETUP.md), 실행/아키텍처 요약: [README.md](./README.md)

## 구조

```
insurance_agent/        Flask 챗봇 (:5000) — 원본 test_agent/insurance_agent 복사본
blockchain-dental/       Hardhat + dApp (:8545 노드, :3000 프론트엔드) — 원본 test_blockchain-dental 복사본
start.bat                루트 실행 진입점 (insurance_agent\run.bat 호출)
SETUP.md                 새 PC 1회성 설치 가이드 (프로그램, MetaMask 네트워크/계정)
```

## 통합 메커니즘 (직접 추가한 부분)

- `insurance_agent/blockchain_bridge.py` — `blockchain-dental/run.bat`과 동일한 순서로
  Hardhat 노드 → 컨트랙트 배포 → 만기환급/오라클/자동납부 서비스 → 프론트엔드 서버를
  기동하고, 마지막에 Chrome(관리자)/Edge(고객) 두 창을 자동으로 엽니다.
  포트(8545, 3000)로 idempotent 체크를 하므로 이미 떠 있으면 재사용합니다.
  백그라운드 서비스 7종은 psutil로 **실제 살아있는 node 프로세스**를 확인해 죽은 것만
  다시 띄웁니다. 노드를 새로 띄운 경우에는 옛 컨트랙트 주소를 바라보는 이전 세션 서비스를
  종료하고 7개 전부 재기동합니다. (예전 `.services_started` 마커 파일 방식은 재부팅 후에도
  마커가 남아 서비스를 영영 skip하는 버그가 있어 제거됨.)
- `web_app.py`의 `/api/blockchain/dental/enroll`, `/api/blockchain/dental/status` —
  위 브릿지를 백그라운드 스레드로 실행하고 상태를 폴링하게 해주는 라우트.
- `web_app.py`의 `addLinksToTables()` (JS) — 상품 비교표 행 텍스트에 "블록체인"이
  포함되면 일반 보험사 링크 대신 **⛓️ 블록체인 가입 시작 →** 버튼을 렌더링.
- `dental_005`(라이나생명 블록체인치아보험)는 `data/dental_products.py`의 로컬
  정적 상품이며, `web_app.py`의 mock `dental` 분기와 `agents/orchestrator.py`의
  시스템 프롬프트(상담 원칙 7번) 양쪽에서 "블록체인"을 명시하지 않은 일반 덴탈보험
  질문에도 항상 포함되도록 강제하고 있음.

## 알아두면 좋은 것들

- **`insurance_agent/run.bat`은 반드시 ANSI(CP949) 인코딩으로 저장** — UTF-8로 저장하면
  한글이 깨짐 (원본 프로젝트의 기존 제약, `insurance_agent/CLAUDE.md`에도 명시됨).
  루트 `start.bat`/`SETUP.md`는 한글 대신 순수 ASCII 위주로 작성해 이 문제를 회피함.
- **블록체인 계정**: Hardhat 기본 테스트 계정 사용. Account #0(관리자, Chrome) /
  Account #1(고객 "김덴탈", Edge). 개인키는 [SETUP.md](./SETUP.md) 4장 참고 —
  Hardhat이 항상 동일하게 생성하는 공개적으로 알려진 테스트 키라 저장소에 남겨도 안전.
- **gh CLI 다중 계정 주의**: 이 머신에는 GitHub 계정이 2개 로그인되어 있음
  (`leeyonsei78` = 이 저장소 소유자, `Sdapaul` = 다른 프로젝트용 기본 계정).
  `git push` 전에 반드시 `gh auth status`로 활성 계정이 `leeyonsei78`인지 확인할 것
  (기본값은 `Sdapaul`로 되어 있어서 그대로 두면 push 권한 문제가 생기거나 커밋 작성자가
  잘못 표기될 수 있음). 필요 시 `gh auth switch --hostname github.com --user leeyonsei78`.
  단, Claude Code(bash 도구, Git Bash 환경)에서는 `gh`가 PATH에 없어 이 확인 자체가
  안 될 수 있음 — 그런 경우 아래 `git push` 항목 참고.
- **Claude Code에서 `git push`는 bash 도구가 아니라 PowerShell 도구로 실행할 것**:
  Git Bash(`bash` 도구)에서 `git push`를 실행하면 Git Credential Manager가 tty를
  못 찾아 `fatal: User cancelled dialog` / `could not read Username`로 실패함.
  `PowerShell` 도구로 같은 명령을 실행하면 Windows Credential Manager에 저장된
  자격증명(`cmdkey /list`의 `git:https://github.com`, 계정 `leeyonsei78`)을 그대로
  사용해 정상 push됨 (stderr로 나오는 `To https://github.com/... main -> main` 같은
  정상 출력을 PowerShell이 에러처럼 표시할 수 있으니 무시하고 실제 결과로 판단할 것).
- **.gitignore로 제외된 것들** (재생성 필요): `insurance_agent/.env`(API 키),
  `insurance_agent/chroma_db/`, `*.xls`/`*.xlsx`, `blockchain-dental/node_modules/`,
  `artifacts/`, `cache/`, `frontend/config.json`.
- **2026-09-13 히스토리 재작성됨**: 원본 `insurance_agent` 폴더에서 그대로 복사되어 온
  개인정보 포함 파일 5개(실명+학번 조합 `.html`/`.zip`, 실제 건강검진 `.pdf`,
  `.ipynb`, 경진대회 신청서 `.hwp`)가 최초 커밋에 실려 공개 저장소에 올라간 것을
  발견 → `git filter-repo`로 전체 히스토리에서 제거 후 `git push --force`. 이 시점
  이전에 이 저장소를 clone한 적이 있다면 커밋 SHA가 전부 바뀌었으므로 pull이 아니라
  재-clone이 필요함. (강제 push 직후에도 GitHub가 예전 dangling 커밋을 즉시 GC하지
  않아 정확한 옛 SHA로는 잠시 더 접근 가능할 수 있음 — 사용자 확인 후 현재 상태 유지
  중.)
- **UI 문구는 "대회/경진대회" 표현 배제**: 챗봇 UI(탭 라벨, 데모 시나리오 프롬프트 등)에서
  "대회"라는 단어는 의도적으로 뺐음 (예: "🏆 대회 데모" → "🎬 가상 시나리오",
  `web_app.py`의 `DEMO_QUERIES` 16개 + `agents/orchestrator.py`의 대응 tool
  description/주석 27개에서 "대회 시나리오" → "시나리오"). 새 UI 카피를 추가할 때도
  이 톤을 유지할 것. 단, `경진대회_제안서_초안.md`·`CARELINK_README.md` 등 실제 과거
  경진대회 제출 이력을 기록한 문서는 의도적으로 그대로 둠 — 라이브 UI가 아니라
  아카이브 기록이라 고치면 역사 왜곡이 되므로, 이 문서들까지 손대려면 먼저 확인할 것.
