# 덴탈보험 블록체인 테스트 진행 상황

## 서버 시작 방법 (매번 필요)

```bash
# 터미널 1 — Hardhat 로컬 블록체인
cd C:\test_bl1
npx hardhat node

# 터미널 2 — 컨트랙트 배포
cd C:\test_bl1
npx hardhat run scripts/deploy.js --network localhost

# 터미널 3 — 웹 UI 서버
cd C:\test_bl1\frontend
npx serve .

# 터미널 4 — 만기환급 자동 워처 (선택)
cd C:\test_bl1
node scripts/maturity-watcher.js

# 터미널 5 — 진료내역 오라클 서비스 (신규)
cd C:\test_bl1
node scripts/oracle-service.js
```

브라우저: http://localhost:3000

---

## 계정 정보

| 계정 | 역할 | 주소 | 개인키 |
|---|---|---|---|
| Account #0 | 관리자(오너) | 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 | 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 |
| Account #1 | 김덴탈 (피보험자) | 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 | 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d |
| Account #2 | 이치과 (피보험자) | 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC | 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a |

MetaMask 네트워크: **Localhost 8545** (RPC: http://127.0.0.1:8545, chainId: 31337)

---

## 컨트랙트 주소 (배포 후 자동 갱신됨)

배포 후 `frontend/config.json` 참고 (재배포 시 주소 변경됨):
- MockUSDC: 배포마다 다름
- DentalInsurance: 배포마다 다름

> ⚠️ 반드시 `--network localhost` 옵션 포함하여 배포할 것

---

## 완료된 기능 및 테스트 (2026-03-14)

### ✅ 기본 보험 플로우
- [x] 1단계 — 관리자 확인 (Account #0, 컨트랙트 잔액 $50,000)
- [x] 2단계 — USDC 파우셋 (Account #1 김덴탈, 1,000 USDC 자동 지급)
- [x] 3단계 — 보험료 납부 (증권 #1, 50 USDC)
- [x] 4단계 — 보험금 청구 (청구 #2, 500 USDC, D0120) ← 청구 #1은 거절됨
- [x] 5단계 — 청구 승인 및 지급 (관리자 Account #0)
- [x] 6단계 — 최종 잔액 확인 (Account #1, 예상 1,450 USDC)

### ✅ 만기환급금 자동 지급 기능 (신규 개발)
- [x] 스마트 컨트랙트 — Policy 구조체에 maturityDate, maturityRefundRate, maturityPaid 추가
- [x] 스마트 컨트랙트 — processMaturityRefund(), isMatured() 함수 추가
- [x] 스마트 컨트랙트 — MaturityRefundPaid 이벤트 추가
- [x] scripts/maturity-watcher.js — 10초마다 만기 감지 후 자동 지급
- [x] scripts/advance-time.js — 테스트용 블록체인 시간 앞당기기
- [x] 프론트엔드 — 💎 만기환급 탭 추가 (일정표, 수동 지급, 조회)
- [x] 만기환급 테스트 완료 (증권 #1, 50 USDC × 70% = 35 USDC 환급)
- [x] 환급금 USDC 잔액 반영 확인

---

## 만기환급 테스트 방법

```bash
# 1. 배포 (블록체인 현재 시간 기준 5분 후 만기 설정됨)
npx hardhat run scripts/deploy.js --network localhost

# 2. 보험료 납부 후 블록체인 시간 앞당기기
node scripts/advance-time.js 600   # 10분 앞당김

# 3-A. 자동 지급 (워처)
node scripts/maturity-watcher.js

# 3-B. 수동 지급 (UI)
# 브라우저 → 💎 만기환급 탭 → [💎 환급 지급] 버튼
```

---

## 다음 세션에서 이어하는 방법

```bash
cd C:\test_bl1
claude
```
> **"덴탈보험 테스트 이어서 해줘"**

---

## 주의사항

- `npx hardhat node` 재시작 → 블록체인 초기화 → **반드시 재배포 필요**
- 배포 시 `--network localhost` 필수 (없으면 임시 네트워크에 배포되어 사라짐)
- MetaMask 계정 전환 시 반드시 새로고침 → [MetaMask 연결] 재클릭
- Hardhat node 재시작 후 MetaMask 오류 시: 설정 → 고급 → **계정 활동 지우기(nonce 초기화)**
- `advance-time.js`로 시간 앞당긴 후 재배포 시 반드시 블록체인 현재 시간 기준으로 만기 계산됨 (deploy.js에 반영됨)
