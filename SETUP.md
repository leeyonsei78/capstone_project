# 설치 및 실행 가이드 (새 PC 기준)

이 문서는 `git clone` 직후, 처음부터 끝까지 그대로 따라 하면 이 프로젝트가
동작하도록 만드는 1회성 설치 가이드입니다. **한 번만** 하면 되고,
그 다음부터 일상적인 실행은 프로젝트 루트의 `start.bat` 하나면 됩니다.

> **자주 헷갈리는 부분**: `insurance_agent`와 `blockchain-dental` 두 폴더에
> 각각 들어가서 PowerShell/cmd로 매번 따로 실행해야 하는 게 아닙니다.
> 각 폴더에 들어가서 명령을 치는 건 **딱 한 번, 아래 설치 단계에서만** 필요합니다.
> 설치가 끝나면:
> - 평소 실행: 프로젝트 루트에서 `start.bat` 더블클릭 한 번 → AI 어시스턴트 창이 뜸
> - 블록체인 쪽은 채팅에서 **⛓️ 블록체인 가입 시작 →** 버튼을 누르면
>   `insurance_agent/blockchain_bridge.py`가 `blockchain-dental` 폴더의 명령들을
>   대신 백그라운드에서 실행해 줍니다 (사람이 그 폴더에 들어가서 칠 필요 없음).
> - `blockchain-dental/run.bat`은 AI 어시스턴트 없이 블록체인 dApp만 단독으로
>   테스트하고 싶을 때 쓰는 **수동/참고용** 스크립트입니다. 통합 시나리오에서는 안 써도 됩니다.

---

## 0. 사전 설치 프로그램 (한 번만 설치)

| 프로그램 | 용도 | 다운로드 |
|---|---|---|
| **Git** | 저장소 클론 | https://git-scm.com/downloads |
| **Node.js 18 이상 (LTS)** | 블록체인 dApp 실행 (npm, npx, hardhat) | https://nodejs.org |
| **Python 3.11 이상** | AI 어시스턴트(Flask) 실행 | https://www.python.org/downloads/ (설치 시 "Add python.exe to PATH" 체크) |
| **Google Chrome** | 관리자 화면용 브라우저 | https://www.google.com/chrome/ |
| **Microsoft Edge** | 고객 화면용 브라우저 | Windows에 기본 설치되어 있음 |
| **MetaMask 확장 프로그램** | 블록체인 지갑 (Chrome용, Edge용 **각각** 설치) | https://metamask.io/download/ |
| **Docker Desktop** (선택) | 증권/청구 알림 이메일 발송 기능용 로컬 SMTP 캐처(Mailpit) 실행 — 없어도 나머지 기능은 전부 정상 동작, 이메일만 안 나감 | https://www.docker.com/products/docker-desktop/ |

설치 확인 (PowerShell 또는 cmd에서):
```bat
git --version
node --version
npm --version
python --version
```

---

## 1. 저장소 클론

```bat
git clone https://github.com/leeyonsei78/capstone_project.git
cd capstone_project
```

---

## 2. AI 어시스턴트(insurance_agent) 설정 — 1회성

```bat
cd insurance_agent
copy .env.example .env
```

`.env` 파일을 메모장으로 열어 아래 값을 채웁니다.

```
OPENAI_API_KEY=sk-여기에_본인_OpenAI_API_키_입력
```

- OpenAI API 키 발급: https://platform.openai.com/api-keys
- `OPENAI_API_KEY`를 넣지 않으면 앱은 자동으로 **Mock 모드**(로컬 규칙 기반 응답)로
  동작합니다. 실행은 되지만 GPT-4o 자유 대화는 되지 않습니다.
- `FSS_API_KEY`는 선택 사항(연금저축보험 실시간 조회 전용)이라 비워둬도 됩니다.

Python 패키지 설치:

```bat
pip install -r requirements.txt
cd ..
```

> `start.bat`을 실행하면 flask 모듈이 없을 경우 이 단계를 자동으로 한 번 더
> 시도하지만, 미리 설치해 두면 첫 실행이 더 빠릅니다.

---

## 3. 블록체인 dApp(blockchain-dental) 설정 — 1회성

```bat
cd blockchain-dental
npm install
cd ..
```

- 최초 1회만 필요하며, 인터넷 연결이 있어야 합니다.
- 스마트 컨트랙트 컴파일(`artifacts/`, `cache/` 생성)은 이 단계에서 하지 않아도
  됩니다 — 채팅에서 **블록체인 가입 시작 →** 버튼을 처음 누를 때 자동으로 수행됩니다.
- 별도 `.env` 파일은 필요 없습니다 (로컬 테스트 전용 기본값 사용).

---

## 4. MetaMask 설정 (Chrome, Edge 각각 반복)

MetaMask는 브라우저별로 별도 저장소를 가지므로, **Chrome과 Edge에 각각**
아래 네트워크 추가 + 계정 가져오기를 해야 합니다.
(Chrome = 관리자 역할, Edge = 고객 역할로 쓸 것이므로 서로 다른 계정을 넣습니다.)

### 4-1. 네트워크 추가 (Chrome, Edge 동일하게)

MetaMask → 네트워크 선택 드롭다운 → **네트워크 추가** → **수동으로 네트워크 추가**

| 항목 | 값 |
|---|---|
| 네트워크 이름 | `Hardhat Local` |
| 새 RPC URL | `http://127.0.0.1:8545` |
| 체인 ID | `31337` |
| 통화 기호 | `ETH` |

> 참고: 로컬 Hardhat 노드가 켜져 있어야 이 네트워크로 정상 연결됩니다.
> 노드는 채팅의 "블록체인 가입 시작 →" 버튼을 누르면 자동으로 켜집니다.

### 4-2. 계정 가져오기 (Import Account)

Hardhat 로컬 노드는 매번 같은 20개의 테스트 계정을 생성하며, 그중 아래 두 개가
이 프로젝트에서 실제로 쓰이는 역할입니다 (테스트 전용 공개 키 — 실제 자산 없음).

**Chrome → 관리자 계정 (Account #0)**
```
개인키: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
주소:   0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

**Edge → 고객 계정 (Account #1, "김덴탈")**
```
개인키: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
주소:   0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

가져오는 방법: MetaMask → 계정 아이콘 → **계정 가져오기** → 위 개인키 붙여넣기 → 가져오기

> ⚠️ 이 개인키들은 Hardhat이 로컬 테스트용으로 항상 동일하게 생성하는
> **공개적으로 알려진 테스트 키**입니다. 실제 자금이 연결되지 않으므로 그대로
> 문서/저장소에 남겨도 안전하지만, 절대 실제 지갑이나 메인넷 계정에는
> 재사용하지 마세요.

---

## 5. 실행

```bat
start.bat
```

1. AI 어시스턴트 콘솔 창이 뜨고 `http://localhost:5000`이 자동으로 열립니다.
2. 챗봇에서 덴탈/치아/블록체인 관련 상담을 요청하면 라이나생명 블록체인치아보험이
   포함된 추천 표가 나오고, **⛓️ 블록체인 가입 시작 →** 버튼이 보입니다.
3. 버튼을 누르면 아래가 순서대로 자동 실행됩니다.
   - Mailpit(Docker, 이메일 발송용) / Hardhat 로컬 노드 / 스마트 컨트랙트 배포 /
     만기환급 워처 / 오라클 서비스 / 자동납부 스케줄러 / 증권 발급·이메일 발송
     서비스 / 프론트엔드 UI 서버
   - 완료되면 **Chrome(관리자)**, **Edge(고객)** 창이 자동으로 열립니다
     (`http://localhost:3000`).
4. 각 창에서 MetaMask 연결 → 4-2에서 가져온 계정으로 서명하며 테스트를 진행합니다.
5. 청약(가입 신청) 화면에서 이메일을 입력해두면, 증권이 발급되거나 청구가
   처리될 때마다 자동으로 메일이 발송됩니다 — 실제 이메일 계정 없이
   `http://localhost:8025` (Mailpit 웹 UI)에서 바로 확인할 수 있습니다.

---

## 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| `python: command not found` | Python 설치 시 PATH 등록을 안 했을 가능성. 재설치하며 "Add to PATH" 체크 |
| `npm install` 이 느리거나 실패 | 인터넷 연결 확인. 회사망이라면 프록시/방화벽 확인 |
| MetaMask가 "네트워크 연결 안 됨"이라고 뜸 | 블록체인 가입 버튼을 눌러 Hardhat 노드를 먼저 켜야 함 (자동 실행) |
| MetaMask 트랜잭션이 계속 실패(nonce 오류) | MetaMask → 설정 → 고급 → "계정 활동 재설정" (노드를 재시작한 경우 필요) |
| 포트 충돌 (5000/3000/8545 사용 중) | 해당 포트를 쓰는 다른 프로그램 종료 후 재시도 |
| 증권 발급/청구 처리 이메일이 안 옴 | Docker Desktop이 켜져 있는지 확인 (`docker compose up -d mailpit`을 `blockchain-dental` 폴더에서 수동 실행해도 됨). 청약 시 이메일 칸을 비워뒀다면 애초에 발송 대상이 없는 것이 정상입니다 |
