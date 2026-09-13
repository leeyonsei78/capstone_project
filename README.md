# 캡스톤 프로젝트: 보험상담 AI 어시스턴트 + 블록체인 덴탈보험 연동

## 구조

```
test_capstone_project/
├── start.bat                    # 전체 실행 진입점 (insurance_agent\run.bat 호출, AI 어시스턴트 창이 먼저 뜸)
├── insurance_agent/            # 보험상담 AI 어시스턴트 (Flask, http://localhost:5000)
│   ├── web_app.py               # 챗봇 UI + API (블록체인 연동 라우트 포함)
│   └── blockchain_bridge.py     # 블록체인 스택 자동 기동 브릿지 (신규 추가)
└── blockchain-dental/          # 블록체인 덴탈보험 dApp (Hardhat, http://localhost:3000)
    ├── contracts/, scripts/, frontend/
    └── run.bat                  # 수동 실행용 원본 스크립트 (참고용, 그대로 유지)
```

## 연동 흐름

1. `start.bat` 실행 → 보험상담 AI 어시스턴트(`insurance_agent`) 콘솔 창이 먼저 뜨고 `http://localhost:5000`이 자동으로 열립니다.
2. 챗봇에서 "블록체인 덴탈보험"(라이나생명 블록체인치아보험, `dental_005`)을 추천받으면,
   상품 비교표의 **⛓️ 블록체인 가입 시작 →** 버튼이 표시됩니다.
3. 버튼 클릭 시 `web_app.py`의 `/api/blockchain/dental/enroll` API가 `blockchain_bridge.py`를 통해
   `blockchain-dental/run.bat`과 동일한 순서로 아래 프로세스를 자동 기동합니다.
   - [1] Hardhat 로컬 노드 (`npx hardhat node`)
   - [2] 스마트 컨트랙트 배포 (`scripts/deploy.js`)
   - [3] 만기환급 워처 / 오라클 서비스 / 자동납부 스케줄러
   - [4] 프론트엔드 UI 서버 (`npx serve -l 3000 .`)
4. 준비가 끝나면 관련 화면 2개를 자동으로 엽니다: **Chrome = 관리자**, **Edge = 고객**
   (브라우저별로 서로 다른 MetaMask 계정을 유지하기 위함 — 원본 `run.bat`과 동일한 방식).
5. 이미 떠 있는 프로세스/포트(8545, 3000)는 재사용하며, 화면 2개만 다시 엽니다(idempotent).

## 참고

- 블록체인 관련 프로세스가 로컬에서 실제로 지갑 서명(MetaMask)까지 필요하므로,
  두 브라우저에 MetaMask가 설치되어 있어야 실제 가입까지 진행할 수 있습니다.
- `insurance_agent/.env`에 `OPENAI_API_KEY`가 설정되어 있어야 AI 상담 기능이 정상 동작합니다.
- `blockchain-dental`는 로컬 테스트 전용 설정이라 별도 `.env` 없이도 기본값으로 동작합니다.

## 새 PC에서 시작하기 (git clone 이후)

**Q. 다른 PC에서 clone하면 지금과 똑같이 되는지?**

정직하게 답하면 **완전히 그대로는 아니고, 1회성 준비가 필요**합니다.
이유: `.env`(API 키)와 `node_modules`/`artifacts`/`cache`는 의도적으로 git에서
제외했기 때문입니다 (공개 리포에 비밀키·대용량 빌드산출물을 올릴 수 없어서).
아래 1회성 준비 과정을 거치면 이 PC에서 한 것과 동일하게 동작합니다.

1. `git clone` → `insurance_agent`에서 `.env.example`을 `.env`로 복사 후 `OPENAI_API_KEY` 입력 → `pip install -r requirements.txt`
2. `blockchain-dental`에서 `npm install` (최초 1회, 인터넷 필요)
3. `start.bat` 실행

**Q. insurance_agent 폴더, blockchain-dental 폴더에 각각 들어가서 PowerShell/cmd로
따로 실행해야 하는 건가?**

아닙니다. 위 1~2번(설치)만 각 폴더에서 **딱 한 번** 하면 되고, 그 이후 **평소 실행은
루트의 `start.bat` 하나면 끝**입니다. `blockchain-dental` 쪽 프로세스들은 사람이
그 폴더에 들어가서 실행하는 게 아니라, 채팅에서 **⛓️ 블록체인 가입 시작 →** 버튼을
누르면 `blockchain_bridge.py`가 대신 백그라운드로 실행해 줍니다.
(`blockchain-dental/run.bat`은 AI 어시스턴트 없이 블록체인 dApp만 단독 테스트할 때 쓰는
수동/참고용 스크립트이며, 통합 시나리오에서는 사용하지 않습니다.)

**프로그램 설치 · MetaMask 네트워크/계정 설정을 포함한 전체 단계별 가이드는
→ [SETUP.md](./SETUP.md) 참고.**

요약 명령어:

```bat
git clone https://github.com/leeyonsei78/capstone_project.git
cd capstone_project

:: 1) AI 어시스턴트 — Python 의존성 + API 키 (1회성)
cd insurance_agent
copy .env.example .env
:: .env 파일을 열어 OPENAI_API_KEY=sk-... 입력 (필수)
pip install -r requirements.txt
cd ..

:: 2) 블록체인 dApp — Node 의존성 설치 (1회성, 인터넷 필요)
cd blockchain-dental
npm install
cd ..

:: 3) 이후 평소 실행은 이것 하나만
start.bat
```

- `OPENAI_API_KEY`를 넣지 않으면 AI 상담은 자동으로 Mock 모드(로컬 규칙 기반 응답)로 동작합니다 —
  실행은 되지만 GPT-4o 기반 자유 대화는 되지 않습니다.
- Hardhat 컨트랙트 컴파일(`artifacts/`, `cache/`)은 `블록체인 가입 시작 →` 버튼을
  처음 누를 때 자동으로 수행됩니다.
- Chrome/Edge에 MetaMask 확장 설치 + 네트워크/계정 설정을 해야 실제 가입(트랜잭션 서명)까지
  테스트할 수 있습니다 (자세한 값은 [SETUP.md](./SETUP.md) 4장 참고).
- 사전 요구사항: Node.js 18+ / npm, Python 3.11+, Windows + Chrome + Edge.
