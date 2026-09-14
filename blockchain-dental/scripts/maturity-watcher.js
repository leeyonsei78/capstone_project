/**
 * maturity-watcher.js
 * 만기환급금 자동 지급 워처 (USDC + KRW 양쪽 처리)
 *
 * 실행: node scripts/maturity-watcher.js
 *
 * 동작:
 *  - 10초마다 전체 보험증권 만기 여부 확인 (USDC / KRW 컨트랙트 모두)
 *  - 만기 도달 시 관리자 계정으로 processMaturityRefund() 자동 호출
 *    (지급 완료 알림은 scripts/slack-notifier.js가 MaturityRefundPaid 이벤트로 이미 전송함)
 *  - 만기가 임박(MATURITY_REMINDER_SEC 이내)했지만 아직 도래하지 않은 증권 →
 *    Slack 사전 알림 (증권당 1회만, 재알림 스팸 방지)
 *
 * 환경변수 (.env):
 *  MATURITY_REMINDER_SEC : 만기 사전 알림 기준 초 (기본: 604800 = 7일)
 *  SLACK_WEBHOOK_URL      : 사전 알림용 (없으면 콘솔에만 출력)
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

const { postToSlack } = require("./lib/slack");

// ethers v6 이벤트 필터 폴링(FilterIdEventSubscriber)이 드물게 내부 오류를 던져
// 처리되지 않은 Promise 거부로 전체 프로세스가 종료되는 것을 방지 (워처는 계속 실행돼야 함)
process.on("unhandledRejection", (reason) => {
  console.error("⚠️  처리되지 않은 오류(무시하고 계속 실행):", reason?.message || reason);
});

// ── 설정 ──────────────────────────────────────────────────────────
const RPC_URL     = "http://127.0.0.1:8545";
const ADMIN_KEY   = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const POLL_SEC    = 10;
const MATURITY_REMINDER_SEC = parseInt(process.env.MATURITY_REMINDER_SEC || "604800", 10); // 기본 7일
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

// ── ABI ───────────────────────────────────────────────────────────
const ABI = [
  "function getAllPolicyIds() view returns (uint256[])",
  "function getPolicy(uint256) view returns (tuple(uint256 id, address patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 totalPaid, uint256 totalClaimed, uint256 lastPaymentTime, uint256 nextDueTime, bool active, uint256 createdAt, uint256 maturityDate, uint256 maturityRefundRate, bool maturityPaid))",
  "function isMatured(uint256) view returns (bool)",
  "function processMaturityRefund(uint256) external",
  "function getPolicyLoan(uint256) view returns (tuple(uint256 policyId, uint256 loanAmount, uint256 borrowedAt, uint256 interestRate, bool active))",
  "function getCurrentInterest(uint256) view returns (uint256)",
  "event MaturityRefundPaid(uint256 indexed policyId, address indexed patient, uint256 refundAmount, uint256 timestamp)"
];

// ── 유틸 ──────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`);
}
function fmtAmount(raw, decimals) {
  if (decimals === 0) return "₩" + Number(raw).toLocaleString("ko-KR");
  return "$" + (Number(raw) / 1e6).toFixed(2);
}

// ── 컨트랙트별 워처 ───────────────────────────────────────────────
async function watchContract(contract, decimals, currency, processed, reminded, provider) {
  try {
    const policyIds = await contract.getAllPolicyIds();
    if (policyIds.length === 0) return;

    // 블록체인 시간 기준 — Date.now()(실제 시간)를 쓰면 Hardhat 블록 시간이
    // 뒤처져 있을 때 알림/카운트다운이 실제 만기 판정(block.timestamp 기준)과 어긋남
    const blockTs = Number((await provider.getBlock("latest")).timestamp);

    for (const id of policyIds) {
      const policyId = Number(id);
      const key = `${currency}-${policyId}`;
      if (processed.has(key)) continue;

      const matured = await contract.isMatured(policyId);
      if (!matured) {
        // 아직 만기는 아니지만 임박한 경우 — 사전 알림 1회
        if (!reminded.has(key)) {
          const policy = await contract.getPolicy(policyId).catch(() => null);
          if (policy && policy.active && !policy.maturityPaid) {
            const secLeft = Number(policy.maturityDate) - blockTs;
            if (secLeft > 0 && secLeft <= MATURITY_REMINDER_SEC) {
              reminded.add(key);
              const maturityDate = new Date(Number(policy.maturityDate) * 1000).toLocaleString("ko-KR");
              const grossRefund = (BigInt(policy.totalPaid) * BigInt(policy.maturityRefundRate)) / 100n;
              log(`⏳ [${currency}] 증권 #${policyId} [${policy.patientName}] 만기 임박 (${maturityDate})`);
              await postToSlack(
                `⏳ *[${currency} 덴탈보험] 만기 임박 — 증권 #${policyId}*\n` +
                `피보험자: ${policy.patientName} | 만기일: ${maturityDate} | ` +
                `예상 환급액: ${fmtAmount(grossRefund, decimals)} (환급율 ${policy.maturityRefundRate}%, 약관대출 미차감)`
              );
            }
          }
        }
        continue;
      }

      const policy      = await contract.getPolicy(policyId);
      const grossRefund = (BigInt(policy.totalPaid) * BigInt(policy.maturityRefundRate)) / 100n;
      const loan        = await contract.getPolicyLoan(policyId);

      log(`⏰ [${currency}] 증권 #${policyId} 만기 도달!`);
      log(`   피보험자: ${policy.patientName} (${policy.patient})`);
      log(`   납입 합계: ${fmtAmount(policy.totalPaid, decimals)}  환급율: ${policy.maturityRefundRate}%  총환급액: ${fmtAmount(grossRefund, decimals)}`);

      if (loan.active) {
        const interest  = await contract.getCurrentInterest(policyId);
        const loanTotal = BigInt(loan.loanAmount) + BigInt(interest);
        const netRefund = loanTotal >= grossRefund ? 0n : grossRefund - loanTotal;
        log(`   ⚠️  약관대출 활성 — 원리금 ${fmtAmount(loanTotal, decimals)}(원금 ${fmtAmount(loan.loanAmount, decimals)}+이자 ${fmtAmount(interest, decimals)}) 차감 예정 → 실지급 예상액: ${fmtAmount(netRefund, decimals)}`);
      }
      log(`   processMaturityRefund(${policyId}) 실행 중...`);

      try {
        const tx = await contract.processMaturityRefund(policyId);
        await tx.wait();
        processed.add(key);
        log(`✅ [${currency}] 증권 #${policyId} 만기환급금 지급 완료! TX: ${tx.hash}`);
      } catch (txErr) {
        log(`❌ [${currency}] 증권 #${policyId} 지급 실패: ${txErr.message}`);
      }
    }
  } catch (e) {
    log(`⚠️  [${currency}] 조회 오류: ${e.message}`);
  }
}

async function printSchedule(contract, decimals, currency, provider) {
  try {
    const ids = await contract.getAllPolicyIds();
    if (ids.length === 0) return;
    const blockTs = Number((await provider.getBlock("latest")).timestamp);
    console.log(`\n[ 만기 일정 — ${currency} ]`);
    for (const id of ids) {
      const p   = await contract.getPolicy(id);
      const mat = new Date(Number(p.maturityDate) * 1000).toLocaleString("ko-KR");
      const remaining = Number(p.maturityDate) - blockTs;
      const status = p.maturityPaid ? "✅ 지급완료" : (remaining <= 0 ? "⏰ 만기" : `⏳ ${remaining}초 후`);
      log(`증권 #${id}: ${p.patientName} | 만기: ${mat} | ${status}`);
    }
    console.log("-".repeat(60));
  } catch (_) {}
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error("❌ frontend/config.json 없음 — 먼저 배포를 실행하세요.");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const admin    = new ethers.Wallet(ADMIN_KEY, provider);

  const usdcInsAddr = config.contracts?.DentalInsurance;
  const krwInsAddr  = config.contracts?.DentalInsuranceKRW;

  const usdcContract = usdcInsAddr ? new ethers.Contract(usdcInsAddr, ABI, admin) : null;
  const krwContract  = krwInsAddr  ? new ethers.Contract(krwInsAddr,  ABI, admin) : null;

  console.log("=".repeat(60));
  console.log("  🦷 만기환급금 자동 지급 워처 시작 (USDC + KRW)");
  console.log("=".repeat(60));
  log(`USDC Insurance : ${usdcInsAddr || "없음"}`);
  log(`KRW  Insurance : ${krwInsAddr  || "없음"}`);
  log(`관리자 계정    : ${admin.address}`);
  log(`폴링 간격      : ${POLL_SEC}초`);
  console.log("-".repeat(60));

  const processed = new Set();
  const reminded  = new Set();

  async function checkAll() {
    if (usdcContract) await watchContract(usdcContract, 6, "USDC", processed, reminded, provider);
    if (krwContract)  await watchContract(krwContract,  0, "KRW",  processed, reminded, provider);
  }

  // 만기 일정 출력
  if (usdcContract) await printSchedule(usdcContract, 6, "USDC", provider);
  if (krwContract)  await printSchedule(krwContract,  0, "KRW",  provider);

  // 첫 번째 실행
  await checkAll();

  // 폴링 루프
  setInterval(checkAll, POLL_SEC * 1000);
  log(`✅ 워처 실행 중 (매 ${POLL_SEC}초마다 검사, Ctrl+C 로 종료)`);
}

main().catch(err => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
