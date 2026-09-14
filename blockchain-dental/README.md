# 🦷 덴탈보험 블록체인 시스템

스테이블코인(USDC)으로 처리하는 덴탈보험료 입금 및 보험금 지급 블록체인 테스트 프로그램입니다.

## 📁 파일 구조

```
C:\test_bl1\
├── contracts/
│   ├── MockUSDC.sol          # 테스트용 스테이블코인 (USDC 모방)
│   └── DentalInsurance.sol   # 덴탈보험 스마트 컨트랙트
├── scripts/
│   └── deploy.js             # 배포 스크립트
├── frontend/
│   ├── index.html            # 메인 UI
│   ├── app.js                # 프론트엔드 로직 (ethers.js v6)
│   └── styles.css            # 스타일
├── hardhat.config.js
├── package.json
└── .env.example
```

## 🚀 빠른 시작

### 1. 의존성 설치
```bash
npm install
```

### 2. 로컬 블록체인 노드 실행 (터미널 1)
```bash
npx hardhat node
```
> 로컬 계정 20개와 개인키가 출력됩니다 (각 10,000 ETH 보유)

### 3. 컨트랙트 배포 (터미널 2)
```bash
npm run deploy:local
```
> `frontend/config.json` 파일이 생성되며 컨트랙트 주소가 저장됩니다.

### 4. MetaMask 설정
1. MetaMask → 네트워크 추가 → 수동 입력:
   - 네트워크 이름: `Hardhat Local`
   - RPC URL: `http://127.0.0.1:8545`
   - 체인 ID: `31337`
   - 화폐 기호: `ETH`

2. MetaMask → 계정 가져오기 → hardhat node 출력의 개인키 입력
   - `Account #0` = 관리자 (컨트랙트 오너)
   - `Account #1` = 테스트 피보험자 1 (김덴탈)
   - `Account #2` = 테스트 피보험자 2 (이치과)

### 5. 웹 UI 실행
`frontend/index.html` 파일을 브라우저에서 직접 열기

> 또는 간단한 HTTP 서버 사용:
> ```bash
> cd frontend && npx serve .
> ```

## 🎯 테스트 시나리오

### 관리자 계정 (Account #0)으로 진행:
1. MetaMask 연결
2. 컨트랙트 주소 자동 로드 (config.json)
3. **보험증권 탭** → 새 증권 생성

### 피보험자 계정 (Account #1)으로 진행:
1. MetaMask 계정 전환
2. **USDC 파우셋 탭** → 1,000 USDC 수령
3. **보험료 납입 탭** → 증권 선택 후 납입
4. **보험금 청구 탭** → 치료코드 선택 후 청구

### 관리자로 돌아와:
5. **관리자 패널** → 청구 승인
6. **관리자 패널** → 보험금 지급
7. **블록체인 상태 탭** → 재무 현황 확인
8. **거래 로그 탭** → 모든 트랜잭션 확인

## 📊 스마트 컨트랙트 기능

### MockUSDC
| 함수 | 설명 |
|------|------|
| `faucet(amount)` | 테스트 USDC 수령 (최대 10,000/회) |
| `mint(to, amount)` | 관리자 민팅 (무제한) |
| `approve(spender, amount)` | 지출 승인 |

### DentalInsurance
| 함수 | 설명 | 권한 |
|------|------|------|
| `createPolicy(patient, name, premium, limit)` | 보험증권 생성 | 관리자 |
| `depositFunds(amount)` | 준비금 입금 | 관리자 |
| `payPremium(policyId)` | 보험료 납입 | 피보험자 |
| `submitClaim(policyId, amount, code, desc)` | 보험금 청구 | 피보험자 |
| `approveClaim(claimId)` | 청구 승인 | 관리자 |
| `rejectClaim(claimId, reason)` | 청구 거절 | 관리자 |
| `payClaim(claimId)` | 보험금 지급 | 관리자 |

## 🔔 슬랙 알림 서비스 (선택)

`scripts/slack-notifier.js`는 모든 메뉴(청약/보험증권/보험료/청구/대출/만기환급/
자동납부/준비금/파우셋)에서 발생하는 온체인 행위를 감지해 Slack으로 전송한다.
프론트엔드 UI, 오라클/워처/스케줄러 서비스 어느 쪽에서 트랜잭션을 일으켰든
컨트랙트 이벤트 기반으로 동작하므로 빠짐없이 포착된다.

```bash
# .env에 SLACK_WEBHOOK_URL 설정 후 실행 (없으면 콘솔에만 로그 출력)
node scripts/slack-notifier.js
```

## 🤖 AI 사전검토 (선택)

관리자 수동 심사가 필요한 두 지점에 GPT-4o 기반 참고 의견을 붙일 수 있다
(insurance_agent 챗봇과 동일한 OpenAI 사용, 같은 API 키 재사용 가능).
**AI는 절대 승인/거절/지급을 직접 결정하지 않는다** — 항상 참고 의견만 생성해
Slack으로 보내고, 실제 처리는 기존과 동일하게 관리자가 UI에서 수행한다.

- **청구 심사 보조** (`scripts/oracle-service.js`에 내장) — 보장한도 20% 초과로
  오라클이 자동처리할 수 없는(=항상 관리자 수동 심사) 청구가 들어오면, 치료
  상세 설명·치료코드·금액을 GPT-4o에 보내 이상 여부 의견을 생성해 Slack으로 전송.
- **청약 심사 보조** (`scripts/application-review-service.js`, 신규) — 보장한도/
  월보험료 비율이 10~100배 사이라 자동승인/거절되지 않고 Pending으로 남은 청약에
  대해 승인/거절 권고 의견을 생성해 Slack으로 전송.

```bash
# .env에 OPENAI_API_KEY 설정 후 실행 (없으면 AI 검토 없이 대기만 함)
node scripts/application-review-service.js
```

## 📄 보험증권 자동 발급 (선택)

`scripts/certificate-service.js`가 `PolicyCreated` 이벤트를 감지해 보험증권 PDF를
자동 발급한다. 청약 자동승인·관리자 수동승인(`approveApplication`)·관리자 직접
생성(`createPolicy`) 중 어느 경로로 증권이 만들어졌든 이 이벤트 하나로 통일되므로
빠짐없이 발급된다.

- 한글 폰트(Noto Sans KR, `assets/fonts/`, OFL 라이선스)를 임베드한 PDF로 증권번호·
  피보험자·월보험료·보장한도·가입일·만기일·만기환급율을 정리해 발급.
- GPT-4o로 쉬운말 보장 요약 문구를 생성해 함께 첨부 (선택, 없어도 필수 정보는 그대로 발급).
- PDF는 `frontend/certificates/`에 저장되며, 이미 떠 있는 frontend 정적 서버
  (`npx serve -l 3000 .`)가 별도 설정 없이 그대로 서빙한다.
- Slack에 발급 완료 알림 + AI 요약 + **다운로드 링크**를 전송한다.

```bash
# .env에 OPENAI_API_KEY, SLACK_WEBHOOK_URL 설정 후 실행 (없어도 PDF 자체는 발급됨)
node scripts/certificate-service.js
```

## ⏳ 사전 알림 & 준비금 부족 경고 (선택)

기존 워처/스케줄러가 "일이 이미 벌어진 뒤"에만 반응하던 것을, 일이 벌어지기 전에
미리 알려주도록 확장했다.

- **납입 기한 임박 알림** (`premium-scheduler.js`) — 납입 기한 3일 전(`REMINDER_SEC`)부터
  Slack 사전 알림. 기한이 지났는데 자동납부 미설정/잔액 부족으로 수납이 실패하면
  — 예전엔 콘솔 로그만 남기고 아무도 모르게 방치됐던 부분 — 이것도 Slack으로 알림.
- **만기 임박 알림** (`maturity-watcher.js`) — 만기 7일 전(`MATURITY_REMINDER_SEC`)부터
  예상 환급액과 함께 Slack 사전 알림.
- **준비금 부족 사전 경고** (`scripts/reserve-monitor.js`, 신규) — 청구 지급·만기환급·
  약관대출 실행은 컨트랙트 내부적으로 잔액 검사를 통과해야 하며, 잔액이 모자라면
  그 트랜잭션 자체가 실패(revert)한다. 현재 잔액과 "곧 나가야 할 돈"(승인된 미지급
  청구 + 만기 도달 미지급 증권 예상 환급액 합계)을 주기적으로 비교해, 부족해지는
  순간과 다시 회복되는 순간에만 Slack 알림(반복 스팸 없음). 컨트랙트 함수를 호출하지
  않는 읽기 전용 서비스.

```bash
node scripts/reserve-monitor.js
```

## 🌐 Sepolia 테스트넷 배포 (선택)

1. `.env.example` → `.env` 복사 후 키 입력
2. Sepolia ETH 확보: https://sepoliafaucet.com
3. `npm run deploy:sepolia`
