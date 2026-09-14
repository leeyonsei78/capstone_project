/**
 * reserve-monitor.js
 * 준비금(보험사 잔액) 부족 사전 경고 워처 (USDC + KRW 양쪽 처리)
 *
 * 실행: node scripts/reserve-monitor.js
 *
 * 왜 필요한가:
 *  청구 지급(payClaim/oracleVerifyAndProcess)·만기환급(processMaturityRefund)·
 *  약관대출 실행(requestPolicyLoan) 전부 컨트랙트 내부적으로 잔액 검사
 *  (_requireBalance)를 통과해야 하고, 잔액이 모자라면 그 트랜잭션 자체가
 *  실패(revert)한다. 지금까지는 이걸 사전에 알 방법이 없어서, 관리자가
 *  준비금을 제때 안 채우면 실제 지급 시도가 실패하고 나서야 알게 됐다.
 *
 * 동작:
 *  - 30초마다 getContractBalance()(현재 잔액)와 "곧 나가야 할 돈"
 *    (승인됐지만 아직 미지급인 청구 합계 + 만기 도달했지만 아직 미지급인
 *    증권의 예상 환급액 합계, 약관대출 미차감 — 보수적으로 넉넉하게 계산)을 비교.
 *  - 잔액 < 필요액으로 전환되는 순간(=새로 부족해진 시점)에만 Slack 경고,
 *    다시 충분해지면 회복 알림 — 매 폴링마다 반복 알림하지 않음.
 *
 * ⚠️ 이 서비스는 어떤 컨트랙트 함수도 호출하지 않는다 (읽기 전용, 경고만 생성).
 *
 * 환경변수 (.env):
 *  RPC_URL           : JSON-RPC 엔드포인트 (기본: http://127.0.0.1:8545)
 *  POLL_SEC          : 폴링 간격 초 (기본: 30)
 *  SLACK_WEBHOOK_URL : 경고/회복 알림용 (없으면 콘솔에만 출력)
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");

const { postToSlack } = require("./lib/slack");

process.on("unhandledRejection", (reason) => {
  console.error("⚠️  처리되지 않은 오류(무시하고 계속 실행):", reason?.message || reason);
});

// ── 설정 ──────────────────────────────────────────────────────────
const RPC_URL     = process.env.RPC_URL || "http://127.0.0.1:8545";
const POLL_SEC    = parseInt(process.env.POLL_SEC || "30", 10);
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

// ── ABI (읽기 전용) ──────────────────────────────────────────────
const ABI = [
  "function getContractBalance() view returns (uint256)",
  "function getAllClaimIds() view returns (uint256[])",
  "function getClaim(uint256) view returns (tuple(uint256 id, uint256 policyId, address patient, uint256 amount, string treatmentCode, string description, uint8 status, uint256 submittedAt, uint256 processedAt, string rejectReason))",
  "function getAllPolicyIds() view returns (uint256[])",
  "function getPolicy(uint256) view returns (tuple(uint256 id, address patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 totalPaid, uint256 totalClaimed, uint256 lastPaymentTime, uint256 nextDueTime, bool active, uint256 createdAt, uint256 maturityDate, uint256 maturityRefundRate, bool maturityPaid))",
  "function isMatured(uint256) view returns (bool)",
];

const CLAIM_STATUS_APPROVED = 1;

// ── 유틸 ──────────────────────────────────────────────────────────
function log(msg)  { console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toLocaleTimeString("ko-KR")}] ⚠️  ${msg}`); }

function fmtAmount(raw, decimals) {
  if (decimals === 0) return "₩" + Number(raw).toLocaleString("ko-KR");
  return "$" + (Number(raw) / 1e6).toFixed(2);
}

// ── 곧 나가야 할 돈(승인된 미지급 청구 + 만기 도달 미지급 증권) 합산 ────
async function estimateUpcomingObligations(contract) {
  let claimsTotal = 0n;
  let claimsCount = 0;
  try {
    const claimIds = await contract.getAllClaimIds();
    for (const id of claimIds) {
      const claim = await contract.getClaim(id).catch(() => null);
      if (claim && Number(claim.status) === CLAIM_STATUS_APPROVED) {
        claimsTotal += BigInt(claim.amount);
        claimsCount++;
      }
    }
  } catch (_) { /* 조회 실패 시 이 항목은 0으로 취급 */ }

  let maturityTotal = 0n;
  let maturityCount = 0;
  try {
    const policyIds = await contract.getAllPolicyIds();
    for (const id of policyIds) {
      const policy = await contract.getPolicy(id).catch(() => null);
      if (!policy || policy.maturityPaid) continue;
      const matured = await contract.isMatured(id).catch(() => false);
      if (!matured) continue;
      // 약관대출 미차감 — 보수적으로(실제 필요액보다 크게) 추정해 안전 마진 확보
      maturityTotal += (BigInt(policy.totalPaid) * BigInt(policy.maturityRefundRate)) / 100n;
      maturityCount++;
    }
  } catch (_) { /* 조회 실패 시 이 항목은 0으로 취급 */ }

  return { claimsTotal, claimsCount, maturityTotal, maturityCount };
}

// ── 컨트랙트별 잔액 점검 ─────────────────────────────────────────
async function checkReserve(contract, decimals, currency, state) {
  let balance;
  try {
    balance = await contract.getContractBalance();
  } catch (e) {
    warn(`[${currency}] 잔액 조회 실패: ${e.message}`);
    return;
  }

  const { claimsTotal, claimsCount, maturityTotal, maturityCount } =
    await estimateUpcomingObligations(contract);
  const needed = claimsTotal + maturityTotal;
  const short = balance < needed;

  log(
    `💰 [${currency}] 잔액: ${fmtAmount(balance, decimals)} | ` +
    `필요 예상액: ${fmtAmount(needed, decimals)} ` +
    `(승인된 미지급 청구 ${claimsCount}건 ${fmtAmount(claimsTotal, decimals)} + ` +
    `만기 도달 미지급 ${maturityCount}건 ${fmtAmount(maturityTotal, decimals)}) ` +
    `→ ${short ? "🚨 부족" : "✅ 충분"}`
  );

  if (short && !state.short) {
    state.short = true;
    await postToSlack(
      `🚨 *[${currency} 덴탈보험] 준비금 부족 예상*\n` +
      `현재 잔액: ${fmtAmount(balance, decimals)} | 필요 예상액: ${fmtAmount(needed, decimals)}\n` +
      `승인된 미지급 청구 ${claimsCount}건 (${fmtAmount(claimsTotal, decimals)}), ` +
      `만기 도달 미지급 증권 ${maturityCount}건 (${fmtAmount(maturityTotal, decimals)})\n` +
      `이대로면 다음 지급/만기환급 트랜잭션이 실패할 수 있습니다. 관리자 패널에서 준비금 입금이 필요합니다.`
    );
  } else if (!short && state.short) {
    state.short = false;
    await postToSlack(
      `✅ *[${currency} 덴탈보험] 준비금 회복*\n` +
      `현재 잔액: ${fmtAmount(balance, decimals)} | 필요 예상액: ${fmtAmount(needed, decimals)}\n` +
      `준비금이 충분한 상태로 돌아왔습니다.`
    );
  }
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error("❌ frontend/config.json 없음 — 먼저 배포를 실행하세요.");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log("=".repeat(65));
  console.log("  💰 준비금 부족 사전 경고 워처 시작 (USDC + KRW)");
  console.log("=".repeat(65));

  const usdcAddr = config.contracts?.DentalInsurance;
  const krwAddr  = config.contracts?.DentalInsuranceKRW;

  const usdcContract = usdcAddr ? new ethers.Contract(usdcAddr, ABI, provider) : null;
  const krwContract  = krwAddr  ? new ethers.Contract(krwAddr,  ABI, provider) : null;

  log(`USDC Insurance : ${usdcAddr || "없음"}`);
  log(`KRW  Insurance : ${krwAddr  || "없음"}`);
  log(`폴링 간격      : ${POLL_SEC}초`);
  console.log("-".repeat(65));

  if (!usdcContract && !krwContract) {
    console.error("❌ 점검할 컨트랙트가 없습니다. config.json을 확인하세요.");
    process.exit(1);
  }

  const usdcState = { short: false };
  const krwState  = { short: false };

  async function checkAll() {
    if (usdcContract) await checkReserve(usdcContract, 6, "USDC", usdcState);
    if (krwContract)  await checkReserve(krwContract,  0, "KRW",  krwState);
  }

  await checkAll();
  setInterval(checkAll, POLL_SEC * 1000);
  log(`✅ 워처 실행 중 (매 ${POLL_SEC}초마다 검사, Ctrl+C 로 종료)`);
}

main().catch(e => {
  console.error("치명적 오류:", e.message);
  process.exit(1);
});
