/**
 * slack-notifier.js
 * 블록체인 전(全) 메뉴 행위 슬랙 알림 서비스 (USDC + KRW 양쪽 처리)
 *
 * 실행: node scripts/slack-notifier.js
 *
 * 동작:
 *  - DentalInsurance / ReserveFund / MockUSDC 컨트랙트의 모든 이벤트를
 *    와일드카드("*")로 리스닝 — 프론트엔드 어느 메뉴(탭)에서 호출했든,
 *    스케줄러/오라클/워처가 자동으로 호출했든 상관없이 온체인에 이벤트가
 *    발생하는 모든 행위를 빠짐없이 포착한다.
 *  - 이벤트가 감지되면 사람이 읽기 쉬운 한국어 메시지로 가공해
 *    Slack Incoming Webhook으로 전송한다.
 *
 * 환경변수 (.env):
 *  SLACK_WEBHOOK_URL : Slack Incoming Webhook URL (필수 — 없으면 콘솔에만 출력)
 *  RPC_URL           : JSON-RPC 엔드포인트 (기본: http://127.0.0.1:8545)
 *
 * 참고: MockKRW.faucet()은 컨트랙트에 이벤트가 정의되어 있지 않아
 *       이벤트 기반으로는 감지할 수 없다 (KRW 파우셋 알림 제외).
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");

const { postToSlack: sendSlackWebhook, SLACK_WEBHOOK_URL } = require("./lib/slack");

// ethers v6 이벤트 필터 폴링이 드물게 내부 오류를 던져 처리되지 않은 Promise
// 거부로 전체 프로세스가 종료되는 것을 방지 (알림 서비스는 계속 실행돼야 함)
process.on("unhandledRejection", (reason) => {
  console.error("⚠️  처리되지 않은 오류(무시하고 계속 실행):", reason?.message || reason);
});

// ── 설정 ──────────────────────────────────────────────────────────
const RPC_URL          = process.env.RPC_URL          || "http://127.0.0.1:8545";
const CONFIG_PATH      = path.join(__dirname, "..", "frontend", "config.json");

// ── ABI (도메인 이벤트만 등록 — Transfer/Approval 등 잡음성 이벤트는 제외) ──
const INSURANCE_ABI = [
  "event PolicyCreated(uint256 indexed policyId, address indexed patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 timestamp)",
  "event PremiumPaid(uint256 indexed policyId, address indexed patient, uint256 amount, uint256 totalPaid, uint256 timestamp)",
  "event ClaimSubmitted(uint256 indexed claimId, uint256 indexed policyId, address indexed patient, uint256 amount, string treatmentCode, uint256 timestamp)",
  "event ClaimApproved(uint256 indexed claimId, uint256 indexed policyId, uint256 amount, uint256 timestamp)",
  "event ClaimRejected(uint256 indexed claimId, uint256 indexed policyId, string reason, uint256 timestamp)",
  "event ClaimPaid(uint256 indexed claimId, uint256 indexed policyId, address indexed patient, uint256 amount, uint256 timestamp)",
  "event PolicyDeactivated(uint256 indexed policyId, uint256 timestamp)",
  "event FundsDeposited(address indexed depositor, uint256 amount, uint256 timestamp)",
  "event ApplicationSubmitted(uint256 indexed appId, address indexed applicant, string applicantName, uint256 riskScore, uint256 timestamp)",
  "event ApplicationApproved(uint256 indexed appId, uint256 indexed policyId, uint256 timestamp)",
  "event ApplicationRejected(uint256 indexed appId, address indexed applicant, string reason, uint256 timestamp)",
  "event PolicyLoanTaken(uint256 indexed policyId, address indexed patient, uint256 loanAmount, uint256 timestamp)",
  "event PolicyLoanRepaid(uint256 indexed policyId, address indexed patient, uint256 principal, uint256 interest, uint256 timestamp)",
  "event MaturityRefundPaid(uint256 indexed policyId, address indexed patient, uint256 refundAmount, uint256 timestamp)",
  "event PremiumAutoCollected(uint256 indexed policyId, address indexed patient, uint256 amount, uint256 totalPaid, uint256 timestamp)",
  "event OracleAddressSet(address indexed oracle)",
  "event OracleModeSet(bool enabled)",
  "event ClaimOracleVerified(uint256 indexed claimId, bool approved, bytes32 dataHash, string hospitalName, uint256 timestamp)",
];
const RESERVE_ABI = [
  "event ReserveDeposited(address indexed patient, uint256 amount, uint256 newPrincipal, uint256 timestamp)",
  "event ReserveWithdrawn(address indexed patient, uint256 amount, uint256 newPrincipal, uint256 timestamp)",
  "event InterestAccrued(address indexed patient, uint256 interestAmount, uint256 newPrincipal, uint256 timestamp)",
];
const FAUCET_ABI = [
  "event FaucetUsed(address indexed user, uint256 amount)",
];

// ── 이벤트별 아이콘/제목 ──────────────────────────────────────────
const EVENT_META = {
  PolicyCreated:        { icon: "📋", title: "보험증권 생성" },
  PremiumPaid:          { icon: "💳", title: "보험료 납입" },
  ClaimSubmitted:       { icon: "🦷", title: "보험금 청구 접수" },
  ClaimApproved:        { icon: "✅", title: "보험금 청구 승인" },
  ClaimRejected:        { icon: "❌", title: "보험금 청구 거절" },
  ClaimPaid:            { icon: "💰", title: "보험금 지급" },
  PolicyDeactivated:    { icon: "🛑", title: "보험증권 해지" },
  FundsDeposited:       { icon: "🏦", title: "준비금 입금 (관리자)" },
  ApplicationSubmitted: { icon: "📝", title: "청약 신청" },
  ApplicationApproved:  { icon: "✅", title: "청약 승인" },
  ApplicationRejected:  { icon: "❌", title: "청약 거절" },
  PolicyLoanTaken:      { icon: "💵", title: "약관대출 실행" },
  PolicyLoanRepaid:     { icon: "🔁", title: "약관대출 상환" },
  MaturityRefundPaid:   { icon: "💎", title: "만기환급 지급" },
  PremiumAutoCollected: { icon: "🔄", title: "보험료 자동납부" },
  OracleAddressSet:     { icon: "🏥", title: "오라클 주소 설정" },
  OracleModeSet:        { icon: "⚙️", title: "오라클 모드 변경" },
  ClaimOracleVerified:  { icon: "🔍", title: "오라클 진료내역 검증" },
  ReserveDeposited:     { icon: "🏛️", title: "준비금 계좌 예치" },
  ReserveWithdrawn:     { icon: "🏛️", title: "준비금 계좌 출금" },
  InterestAccrued:      { icon: "📈", title: "준비금 이자 적립" },
  FaucetUsed:           { icon: "🚰", title: "테스트 USDC 파우셋" },
};

// ── 유틸 ──────────────────────────────────────────────────────────
function log(msg)  { console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toLocaleTimeString("ko-KR")}] ⚠️  ${msg}`); }
function err(msg)  { console.error(`[${new Date().toLocaleTimeString("ko-KR")}] ❌ ${msg}`); }

function fmtAmount(raw, decimals) {
  if (decimals === 0) return "₩" + Number(raw).toLocaleString("ko-KR");
  return "$" + (Number(raw) / 1e6).toFixed(2);
}
function shortAddr(addr) {
  if (!addr) return "-";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ── Slack 전송 ────────────────────────────────────────────────────
async function postToSlack(text) {
  log(text.replace(/\n/g, " | "));
  if (!SLACK_WEBHOOK_URL) return;
  const result = await sendSlackWebhook(text);
  if (!result.sent) {
    warn(`Slack 전송 실패 (${result.reason}): ${result.detail || ""}`);
  }
}

// ── 이벤트 → 메시지 본문 ──────────────────────────────────────────
function formatEventBody(eventName, args, decimals, currency) {
  const fa = (v) => fmtAmount(v, decimals);
  switch (eventName) {
    case "PolicyCreated":
      return `증권ID: #${args.policyId} | 피보험자: ${args.patientName} (${shortAddr(args.patient)}) | 월보험료: ${fa(args.monthlyPremium)} | 보장한도: ${fa(args.coverageLimit)}`;
    case "PremiumPaid":
      return `증권ID: #${args.policyId} | 납입자: ${shortAddr(args.patient)} | 납입액: ${fa(args.amount)} | 누적납입: ${fa(args.totalPaid)}`;
    case "ClaimSubmitted":
      return `청구ID: #${args.claimId} | 증권ID: #${args.policyId} | 청구자: ${shortAddr(args.patient)} | 청구액: ${fa(args.amount)} | 치료코드: ${args.treatmentCode}`;
    case "ClaimApproved":
      return `청구ID: #${args.claimId} | 증권ID: #${args.policyId} | 승인액: ${fa(args.amount)}`;
    case "ClaimRejected":
      return `청구ID: #${args.claimId} | 증권ID: #${args.policyId} | 사유: ${args.reason}`;
    case "ClaimPaid":
      return `청구ID: #${args.claimId} | 증권ID: #${args.policyId} | 수령자: ${shortAddr(args.patient)} | 지급액: ${fa(args.amount)}`;
    case "PolicyDeactivated":
      return `증권ID: #${args.policyId} 해지 처리됨`;
    case "FundsDeposited":
      return `입금자: ${shortAddr(args.depositor)} | 입금액: ${fa(args.amount)}`;
    case "ApplicationSubmitted":
      return `청약ID: #${args.appId} | 청약자: ${args.applicantName} (${shortAddr(args.applicant)}) | 위험점수: ${args.riskScore}`;
    case "ApplicationApproved":
      return `청약ID: #${args.appId} → 증권ID: #${args.policyId} 생성됨`;
    case "ApplicationRejected":
      return `청약ID: #${args.appId} | 신청자: ${shortAddr(args.applicant)} | 사유: ${args.reason}`;
    case "PolicyLoanTaken":
      return `증권ID: #${args.policyId} | 대출자: ${shortAddr(args.patient)} | 대출금: ${fa(args.loanAmount)}`;
    case "PolicyLoanRepaid":
      return `증권ID: #${args.policyId} | 상환자: ${shortAddr(args.patient)} | 원금: ${fa(args.principal)} | 이자: ${fa(args.interest)}`;
    case "MaturityRefundPaid":
      return `증권ID: #${args.policyId} | 수령자: ${shortAddr(args.patient)} | 환급액: ${fa(args.refundAmount)}`;
    case "PremiumAutoCollected":
      return `증권ID: #${args.policyId} | 피보험자: ${shortAddr(args.patient)} | 자동수납액: ${fa(args.amount)} | 누적납입: ${fa(args.totalPaid)}`;
    case "OracleAddressSet":
      return `오라클 주소: ${shortAddr(args.oracle)}`;
    case "OracleModeSet":
      return `오라클 모드: ${args.enabled ? "✅ 활성화" : "⏸ 비활성화"}`;
    case "ClaimOracleVerified":
      return `청구ID: #${args.claimId} | 결과: ${args.approved ? "승인" : "거절"} | 병원: ${args.hospitalName || "-"}`;
    case "ReserveDeposited":
      return `계좌주: ${shortAddr(args.patient)} | 예치액: ${fa(args.amount)} | 잔액: ${fa(args.newPrincipal)}`;
    case "ReserveWithdrawn":
      return `계좌주: ${shortAddr(args.patient)} | 출금액: ${fa(args.amount)} | 잔액: ${fa(args.newPrincipal)}`;
    case "InterestAccrued":
      return `계좌주: ${shortAddr(args.patient)} | 이자적립: ${fa(args.interestAmount)} | 잔액: ${fa(args.newPrincipal)}`;
    case "FaucetUsed":
      return `수령자: ${shortAddr(args.user)} | 수령액: ${fa(args.amount)}`;
    default:
      return JSON.stringify(args, (_, v) => typeof v === "bigint" ? v.toString() : v);
  }
}

// ── 컨트랙트에 와일드카드 리스너 연결 ────────────────────────────
function attachListener(contract, label, decimals, currency) {
  contract.on("*", async (event) => {
    try {
      const eventName = event.eventName || event.fragment?.name;
      if (!eventName || typeof event.args?.toObject !== "function") return;
      const args = event.args.toObject();
      const meta = EVENT_META[eventName] || { icon: "🔔", title: eventName };
      const body = formatEventBody(eventName, args, decimals, currency);
      const txHash = event.log?.transactionHash || "-";

      const text =
        `${meta.icon} *[${label}] ${meta.title}*\n` +
        `${body}\n` +
        `TxHash: \`${txHash}\``;

      await postToSlack(text);
    } catch (e) {
      err(`이벤트 처리 오류 (${label}): ${e.message}`);
    }
  });
  log(`👂 [${label}] 전체 이벤트 리스닝 시작...`);
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    err("frontend/config.json 없음 — 먼저 배포를 실행하세요.");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log("=".repeat(65));
  console.log("  🔔 블록체인 행위 슬랙 알림 서비스 시작 (USDC + KRW)");
  console.log("=".repeat(65));

  if (!SLACK_WEBHOOK_URL) {
    warn("SLACK_WEBHOOK_URL 미설정 — Slack 전송 없이 콘솔에만 기록합니다.");
    warn(".env에 SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... 를 추가하세요.");
  }

  const c = config.contracts || {};
  const targets = [
    { addr: c.DentalInsurance,    abi: INSURANCE_ABI, label: "USDC 덴탈보험",   decimals: 6 },
    { addr: c.DentalInsuranceKRW, abi: INSURANCE_ABI, label: "KRW 덴탈보험",    decimals: 0 },
    { addr: c.ReserveFund,        abi: RESERVE_ABI,   label: "USDC 준비금계좌", decimals: 6 },
    { addr: c.ReserveFundKRW,     abi: RESERVE_ABI,   label: "KRW 준비금계좌",  decimals: 0 },
    { addr: c.MockUSDC,           abi: FAUCET_ABI,    label: "USDC 파우셋",     decimals: 6 },
  ];

  let attached = 0;
  for (const t of targets) {
    if (!t.addr) { warn(`${t.label} 컨트랙트 주소 없음 — 스킵`); continue; }
    const contract = new ethers.Contract(t.addr, t.abi, provider);
    attachListener(contract, t.label, t.decimals);
    attached++;
  }

  if (attached === 0) {
    err("리스닝할 컨트랙트가 하나도 없습니다. config.json을 확인하세요.");
    process.exit(1);
  }

  console.log("-".repeat(65));
  log(`✅ 슬랙 알림 서비스 실행 중 (${attached}개 컨트랙트, Ctrl+C 로 종료)`);
  await postToSlack("🔔 *블록체인 슬랙 알림 서비스가 시작되었습니다.* 이제부터 모든 메뉴 행위 결과가 이 채널로 전송됩니다.");
}

main().catch(e => {
  err(`치명적 오류: ${e.message}`);
  process.exit(1);
});
