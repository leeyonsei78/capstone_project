/**
 * oracle-service.js
 * 병원 진료내역 오라클 서비스 (USDC + KRW 양쪽 처리)
 *
 * 실행: node scripts/oracle-service.js
 *
 * 동작:
 *  1. ClaimSubmitted 이벤트 감지 (USDC 컨트랙트 + KRW 컨트랙트)
 *  2. 병원 데이터 제공자(HospitalProvider)로 진료내역 검증
 *  3. oracleVerifyAndProcess() 컨트랙트 호출 → 자동 승인/거절 + 지급
 *
 * 제공자 전환 방법 (.env):
 *  HOSPITAL_PROVIDER=mock  (기본, 테스트용)
 *  HOSPITAL_PROVIDER=hira  (실제 HIRA API)
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");

const hospitalProvider = require("./hospital-provider/index");

// ethers v6 이벤트 필터 폴링(FilterIdEventSubscriber)이 드물게 내부 오류를 던져
// 처리되지 않은 Promise 거부로 전체 프로세스가 종료되는 것을 방지 (오라클은 계속 실행돼야 함)
process.on("unhandledRejection", (reason) => {
  console.error("⚠️  처리되지 않은 오류(무시하고 계속 실행):", reason?.message || reason);
});

// ── 설정 ──────────────────────────────────────────────────────────
const RPC_URL     = process.env.RPC_URL     || "http://127.0.0.1:8545";
const ORACLE_KEY  = process.env.ORACLE_KEY  || "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

// ── ABI ───────────────────────────────────────────────────────────
const ABI = [
  "function getAllClaimIds() view returns (uint256[])",
  "function getClaim(uint256) view returns (tuple(uint256 id, uint256 policyId, address patient, uint256 amount, string treatmentCode, string description, uint8 status, uint256 submittedAt, uint256 processedAt, string rejectReason))",
  "function oracleModeEnabled() view returns (bool)",
  "function oracleAddress() view returns (address)",
  "function oracleVerifyAndProcess(uint256 claimId, bool approved, bytes32 dataHash, string hospitalName, string verificationCode) external",
  "function getPolicy(uint256) view returns (tuple(uint256 id, address patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 totalPaid, uint256 totalClaimed, uint256 lastPaymentTime, uint256 nextDueTime, bool active, uint256 createdAt, uint256 maturityDate, uint256 maturityRefundRate, bool maturityPaid))",
  "function AUTO_CLAIM_APPROVAL_PERCENT() view returns (uint256)",
  "event ClaimSubmitted(uint256 indexed claimId, uint256 indexed policyId, address indexed patient, uint256 amount, string treatmentCode, uint256 timestamp)",
  "event ClaimOracleVerified(uint256 indexed claimId, bool approved, bytes32 dataHash, string hospitalName, uint256 timestamp)",
];

// ── 유틸 ──────────────────────────────────────────────────────────
function log(msg)  { console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toLocaleTimeString("ko-KR")}] ⚠️  ${msg}`); }
function err(msg)  { console.error(`[${new Date().toLocaleTimeString("ko-KR")}] ❌ ${msg}`); }

function fmtAmount(raw, decimals) {
  if (decimals === 0) return "₩" + Number(raw).toLocaleString("ko-KR");
  return "$" + (Number(raw) / 1e6).toFixed(2);
}

// ── 핵심 로직: 청구 검증 및 처리 ────────────────────────────────
async function processClaimWithOracle(contract, claimId, decimals, currency) {
  log(`📋 [${currency}] 청구 #${claimId} 검증 시작...`);

  let claim;
  try {
    claim = await contract.getClaim(claimId);
  } catch (e) {
    err(`청구 #${claimId} 조회 실패: ${e.message}`);
    return;
  }

  if (Number(claim.status) !== 0) {
    log(`  └─ 청구 #${claimId} 상태: ${["Pending","Approved","Rejected","Paid"][Number(claim.status)]} — 스킵`);
    return;
  }

  const modeEnabled = await contract.oracleModeEnabled().catch(() => true);
  if (!modeEnabled) {
    log(`  └─ 청구 #${claimId} — 오라클 모드 비활성화 상태, 관리자 수동 심사 대기 (스킵)`);
    return;
  }

  const policy = await contract.getPolicy(claim.policyId).catch(() => null);
  const autoPercent = await contract.AUTO_CLAIM_APPROVAL_PERCENT().catch(() => 20n);
  if (policy && claim.amount > (policy.coverageLimit * autoPercent) / 100n) {
    log(`  └─ 청구 #${claimId} — 보장한도의 ${autoPercent}% 초과, 오라클 처리 불가 → 관리자 수동 심사 대기 (스킵)`);
    return;
  }

  log(`  ├─ 피보험자  : ${claim.patient}`);
  log(`  ├─ 청구 금액 : ${fmtAmount(claim.amount, decimals)}`);
  log(`  ├─ 치료 코드 : ${claim.treatmentCode}`);
  log(`  └─ 병원 API 검증 중...`);

  let result;
  try {
    result = await hospitalProvider.verifyClaimAmount(claim.treatmentCode, claim.amount, decimals);
  } catch (e) {
    err(`병원 API 호출 실패: ${e.message}`);
    return;
  }

  log(`  [결과] ${result.approved ? "✅ 승인" : "❌ 거절"} | ${result.verificationCode} | ${result.message}`);

  const rawJson  = JSON.stringify(result.rawData || {}, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  const dataHash = ethers.keccak256(ethers.toUtf8Bytes(rawJson));

  try {
    log(`  oracleVerifyAndProcess(${claimId}, ${result.approved}, ...) 실행 중...`);
    const tx = await contract.oracleVerifyAndProcess(
      claimId, result.approved, dataHash,
      result.hospitalName || "", result.verificationCode
    );
    const receipt = await tx.wait();
    log(`  ✅ 처리 완료! TX: ${receipt.hash}`);
    if (result.approved) {
      log(`  💰 보험금 ${fmtAmount(claim.amount, decimals)} → ${claim.patient} 지급`);
    } else {
      log(`  🚫 거절 사유: ${result.message}`);
    }
  } catch (e) {
    err(`컨트랙트 호출 실패 (청구 #${claimId}): ${e.message}`);
  }
}

async function scanPendingClaims(contract, decimals, currency) {
  log(`🔍 [${currency}] 기존 미처리(Pending) 청구 스캔 중...`);
  try {
    const ids = await contract.getAllClaimIds();
    let count = 0;
    for (const id of ids) {
      const claim = await contract.getClaim(id);
      if (Number(claim.status) === 0) {
        count++;
        await processClaimWithOracle(contract, Number(id), decimals, currency);
      }
    }
    log(`🔍 [${currency}] 스캔 완료 — Pending 청구 ${count}건 처리`);
  } catch (e) {
    warn(`[${currency}] 초기 스캔 오류: ${e.message}`);
  }
}

async function setupContract(oracle, addr, decimals, currency) {
  if (!addr) { warn(`${currency} 컨트랙트 주소 없음 — 스킵`); return null; }

  const contract = new ethers.Contract(addr, ABI, oracle);
  try {
    const modeEnabled    = await contract.oracleModeEnabled();
    const contractOracle = await contract.oracleAddress();
    log(`[${currency}] Oracle 모드: ${modeEnabled ? "✅ 활성화" : "⚠️  비활성화"}`);
    if (contractOracle.toLowerCase() !== oracle.address.toLowerCase()) {
      warn(`[${currency}] 오라클 주소 불일치! 컨트랙트: ${contractOracle}`);
    }
  } catch (e) {
    warn(`[${currency}] 상태 확인 실패: ${e.message}`);
  }
  return contract;
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    err("frontend/config.json 없음 — 먼저 배포를 실행하세요.");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const oracle   = new ethers.Wallet(ORACLE_KEY, provider);

  console.log("=".repeat(65));
  console.log("  🏥 덴탈보험 진료내역 오라클 서비스 시작 (USDC + KRW)");
  console.log("=".repeat(65));
  log(`Oracle 주소      : ${oracle.address}`);
  log(`Hospital Provider: ${process.env.HOSPITAL_PROVIDER || "mock"}`);
  console.log("-".repeat(65));

  // USDC 컨트랙트 (6 decimals)
  const usdcInsAddr = config.contracts?.DentalInsurance;
  const usdcContract = await setupContract(oracle, usdcInsAddr, 6, "USDC");
  log(`USDC Insurance   : ${usdcInsAddr || "없음"}`);

  // KRW 컨트랙트 (0 decimals)
  const krwInsAddr = config.contracts?.DentalInsuranceKRW;
  const krwContract = await setupContract(oracle, krwInsAddr, 0, "KRW");
  log(`KRW Insurance    : ${krwInsAddr || "없음"}`);
  console.log("-".repeat(65));

  // ① 시작 시 기존 Pending 청구 처리
  if (usdcContract) await scanPendingClaims(usdcContract, 6, "USDC");
  if (krwContract)  await scanPendingClaims(krwContract,  0, "KRW");

  // ② 실시간 이벤트 리스닝
  if (usdcContract) {
    log("👂 [USDC] ClaimSubmitted 이벤트 리스닝 시작...");
    usdcContract.on("ClaimSubmitted", async (claimId, policyId, patient, amount, treatmentCode) => {
      log(`\n📥 [USDC] ClaimSubmitted — 청구 #${claimId} (증권 #${policyId})`);
      log(`  치료코드: ${treatmentCode} | 금액: ${fmtAmount(amount, 6)} | 환자: ${patient}`);
      await processClaimWithOracle(usdcContract, Number(claimId), 6, "USDC");
    });
    usdcContract.on("ClaimOracleVerified", (claimId, approved, dataHash, hospitalName) => {
      log(`📢 [USDC] OracleVerified — #${claimId} | ${approved ? "승인" : "거절"} | ${hospitalName}`);
    });
  }

  if (krwContract) {
    log("👂 [KRW] ClaimSubmitted 이벤트 리스닝 시작...");
    krwContract.on("ClaimSubmitted", async (claimId, policyId, patient, amount, treatmentCode) => {
      log(`\n📥 [KRW] ClaimSubmitted — 청구 #${claimId} (증권 #${policyId})`);
      log(`  치료코드: ${treatmentCode} | 금액: ${fmtAmount(amount, 0)} | 환자: ${patient}`);
      await processClaimWithOracle(krwContract, Number(claimId), 0, "KRW");
    });
    krwContract.on("ClaimOracleVerified", (claimId, approved, dataHash, hospitalName) => {
      log(`📢 [KRW] OracleVerified — #${claimId} | ${approved ? "승인" : "거절"} | ${hospitalName}`);
    });
  }

  log("✅ 오라클 서비스 실행 중 (Ctrl+C 로 종료)");
}

main().catch(e => {
  err(`치명적 오류: ${e.message}`);
  process.exit(1);
});
