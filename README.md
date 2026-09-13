# 캡스톤 프로젝트: 보험상담 AI 어시스턴트 + 블록체인 덴탈보험 연동

## 구조

```
test_capstone_project/
├── run.bat                     # 전체 실행 진입점 (insurance_agent\run.bat 호출)
├── insurance_agent/            # 보험상담 AI 어시스턴트 (Flask, http://localhost:5000)
│   ├── web_app.py               # 챗봇 UI + API (블록체인 연동 라우트 포함)
│   └── blockchain_bridge.py     # 블록체인 스택 자동 기동 브릿지 (신규 추가)
└── blockchain-dental/          # 블록체인 덴탈보험 dApp (Hardhat, http://localhost:3000)
    ├── contracts/, scripts/, frontend/
    └── run.bat                  # 수동 실행용 원본 스크립트 (참고용, 그대로 유지)
```

## 연동 흐름

1. `run.bat` 실행 → 보험상담 AI 어시스턴트(`insurance_agent`)가 `http://localhost:5000`에서 기동됩니다.
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
