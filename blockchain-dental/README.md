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

## 🌐 Sepolia 테스트넷 배포 (선택)

1. `.env.example` → `.env` 복사 후 키 입력
2. Sepolia ETH 확보: https://sepoliafaucet.com
3. `npm run deploy:sepolia`
