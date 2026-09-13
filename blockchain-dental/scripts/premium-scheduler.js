/**
 * premium-scheduler.js
 * 월 보험료 자동 수납 스케줄러 (USDC + KRW 양쪽 처리)
 *
 * 실행: node scripts/premium-scheduler.js
 *
 * 동작:
 *  - 30초마다 전체 보험증권 납입 기한(nextDueTime) 확인 (USDC / KRW 모두)
 *  - 기한 도달 + 피보험자 잔액/allowance 충분 → collectPremium() 자동 호출
 *
 * 환경변수 (.env):
 *  RPC_URL   : JSON-RPC 엔드포인트 (기본: http://127.0.0.1:8545)
 *  ADMIN_KEY : 관리자 개인키 (기본: Hardhat Account #0)
 *  POLL_SEC  : 폴링 간격 초 (기본: 30)
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");

// ethers v6 이벤트 필터 폴링(FilterIdEventSubscriber)이 드물게 내부 오류를 던져
// 처리되지 않은 Promise 거부로 전체 프로세스가 종료되는 것을 방지 (스케줄러는 계속 실행돼야 함)
process.on("unhandledRejection", (reason) => {
  console.error("⚠️  처리되지 않은 오류(무시하고 계속 실행):", reason?.message || reason);
});

// ── 설정 ──────────────────────────────────────────────────────────
const RPC_URL     = process.env.RPC_URL   || "http://127.0.0.1:8545";
const ADMIN_KEY   = process.env.ADMIN_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const POLL_SEC    = parseInt(process.env.POLL_SEC || "30", 10);
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

// ── ABI ───────────────────────────────────────────────────────────
const INSURANCE_ABI = [
  "function getAllPolicyIds() view returns (uint256[])",
  "function getPolicy(uint256) view returns (tuple(uint256 id, address patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 totalPaid, uint256 totalClaimed, uint256 lastPaymentTime, uint256 nextDueTime, bool active, uint256 createdAt, uint256 maturityDate, uint256 maturityRefundRate, bool maturityPaid))",
  "function isDue(uint256) view returns (bool)",
  "function collectPremium(uint256) external",
  "event PremiumAutoCollected(uint256 indexed policyId, address indexed patient, uint256 amount, uint256 totalPaid, uint256 timestamp)",
];
const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

// ── 유틸 ──────────────────────────────────────────────────────────
function log(msg)  { console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toLocaleTimeString("ko-KR")}] ⚠️  ${msg}`); }
function err(msg)  { console.error(`[${new Date().toLocaleTimeString("ko-KR")}] ❌ ${msg}`); }

function fmtAmount(raw, decimals) {
  if (decimals === 0) return "₩" + Number(raw).toLocaleString("ko-KR");
  return "$" + (Number(raw) / 1e6).toFixed(2);
}

// ── 컨트랙트별 수납 처리 ─────────────────────────────────────────
async function collectDuePremiums(contract, tokenContract, insAddr, decimals, currency) {
  let policyIds;
  try {
    policyIds = await contract.getAllPolicyIds();
  } catch (e) {
    warn(`[${currency}] 증권 목록 조회 실패: ${e.message}`);
    return;
  }
  if (policyIds.length === 0) return;

  for (const id of policyIds) {
    const policyId = Number(id);
    let due;
    try { due = await contract.isDue(policyId); } catch { continue; }
    if (!due) continue;

    let policy;
    try { policy = await contract.getPolicy(policyId); } catch { continue; }

    const amount  = policy.monthlyPremium;
    const patient = policy.patient;

    let balance, allowance;
    try {
      balance   = await tokenContract.balanceOf(patient);
      allowance = await tokenContract.allowance(patient, insAddr);
    } catch (e) {
      warn(`[${currency}] 증권 #${policyId} 잔액/허용량 조회 실패: ${e.message}`);
      continue;
    }

    log(`⏰ [${currency}] 증권 #${policyId} [${policy.patientName}] 납입 기한 도달`);
    log(`   월 보험료: ${fmtAmount(amount, decimals)}`);
    log(`   잔액: ${fmtAmount(balance, decimals)}  허용량: ${fmtAmount(allowance, decimals)}`);

    if (allowance < amount) {
      warn(`   ⛔ 자동납부 미설정 — 피보험자가 UI에서 [자동납부 ON] 버튼을 눌러야 합니다.`);
      continue;
    }
    if (balance < amount) {
      warn(`   ⛔ 잔액 부족 — ${fmtAmount(balance, decimals)} / 필요: ${fmtAmount(amount, decimals)}`);
      continue;
    }

    try {
      log(`   collectPremium(${policyId}) 실행 중...`);
      const tx = await contract.collectPremium(policyId);
      const receipt = await tx.wait();
      const newTotal = BigInt(policy.totalPaid) + BigInt(amount);
      log(`   ✅ 수납 완료! ${fmtAmount(amount, decimals)} → 컨트랙트  TX: ${receipt.hash}`);
      log(`   누적 납입: ${fmtAmount(newTotal, decimals)}`);
    } catch (txErr) {
      err(`   collectPremium(${policyId}) 실패: ${txErr.reason || txErr.message}`);
    }
  }
}

async function printSchedule(contract, tokenContract, insAddr, decimals, currency) {
  try {
    const ids = await contract.getAllPolicyIds();
    if (ids.length === 0) return;
    console.log(`\n[ 납입 일정 — ${currency} ]`);
    for (const id of ids) {
      const p = await contract.getPolicy(id);
      if (!p.active) continue;
      const due     = new Date(Number(p.nextDueTime) * 1000).toLocaleString("ko-KR");
      const secLeft = Number(p.nextDueTime) - Math.floor(Date.now() / 1000);
      const status  = secLeft <= 0 ? "⏰ 납입 기한 초과" : `⏳ ${secLeft}초 후`;
      const allow   = await tokenContract.allowance(p.patient, insAddr);
      const autoOn  = allow >= p.monthlyPremium ? "🟢 자동납부 ON" : "🔴 자동납부 OFF";
      log(`증권 #${id}: ${p.patientName} | 다음 납입: ${due} | ${status} | ${autoOn}`);
    }
    console.log("-".repeat(60));
  } catch (_) {}
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    err("frontend/config.json 없음 — 먼저 배포를 실행하세요.");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const admin    = new ethers.Wallet(ADMIN_KEY, provider);

  const usdcInsAddr = config.contracts?.DentalInsurance;
  const usdcTknAddr = config.contracts?.MockUSDC;
  const krwInsAddr  = config.contracts?.DentalInsuranceKRW;
  const krwTknAddr  = config.contracts?.MockKRW;

  const usdcContract = usdcInsAddr ? new ethers.Contract(usdcInsAddr, INSURANCE_ABI, admin) : null;
  const usdcToken    = usdcTknAddr ? new ethers.Contract(usdcTknAddr, TOKEN_ABI, provider)   : null;
  const krwContract  = krwInsAddr  ? new ethers.Contract(krwInsAddr,  INSURANCE_ABI, admin)  : null;
  const krwToken     = krwTknAddr  ? new ethers.Contract(krwTknAddr,  TOKEN_ABI, provider)   : null;

  console.log("=".repeat(60));
  console.log("  🔄 월 보험료 자동 수납 스케줄러 시작 (USDC + KRW)");
  console.log("=".repeat(60));
  log(`USDC Insurance : ${usdcInsAddr || "없음"}`);
  log(`KRW  Insurance : ${krwInsAddr  || "없음"}`);
  log(`관리자 계정    : ${admin.address}`);
  log(`폴링 간격      : ${POLL_SEC}초`);
  console.log("-".repeat(60));

  async function runAll() {
    if (usdcContract && usdcToken) await collectDuePremiums(usdcContract, usdcToken, usdcInsAddr, 6, "USDC");
    if (krwContract  && krwToken)  await collectDuePremiums(krwContract,  krwToken,  krwInsAddr,  0, "KRW");
  }

  // 초기 일정 출력
  if (usdcContract && usdcToken) await printSchedule(usdcContract, usdcToken, usdcInsAddr, 6, "USDC");
  if (krwContract  && krwToken)  await printSchedule(krwContract,  krwToken,  krwInsAddr,  0, "KRW");

  // 초기 실행
  await runAll();

  // 폴링 루프
  setInterval(runAll, POLL_SEC * 1000);
  log(`✅ 스케줄러 실행 중 (매 ${POLL_SEC}초마다 검사, Ctrl+C 로 종료)`);
}

main().catch(e => {
  console.error("치명적 오류:", e);
  process.exit(1);
});
