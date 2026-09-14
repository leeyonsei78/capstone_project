/**
 * application-review-service.js
 * 청약 심사(Application) AI 사전검토 서비스 (USDC + KRW 양쪽 처리)
 *
 * 실행: node scripts/application-review-service.js
 *
 * 동작:
 *  - ApplicationSubmitted 이벤트 감지 (+ 시작 시 기존 Pending 청약 스캔)
 *  - 보장한도/월보험료 비율이 10~100배 사이라 컨트랙트가 자동승인/거절하지 못하고
 *    Pending 상태로 남긴(=관리자 수동 심사 대상) 청약에 한해 GPT-4o로 승인/거절
 *    권고 의견을 생성해 Slack으로 전송한다. (insurance_agent 챗봇과 동일한 OpenAI 사용)
 *
 * ⚠️ 이 서비스는 어떤 컨트랙트 함수도 호출하지 않는다 (읽기 전용).
 *    실제 승인/거절은 반드시 관리자가 UI에서 approveApplication/rejectApplicationAdmin으로
 *    직접 처리해야 한다 — 여기서 만드는 의견은 참고용 권고일 뿐이다.
 *
 * 환경변수 (.env):
 *  RPC_URL        : JSON-RPC 엔드포인트 (기본: http://127.0.0.1:8545)
 *  OPENAI_API_KEY : OpenAI API 키 (insurance_agent/.env와 동일한 키 재사용 가능. 없으면 AI 검토 없이 대기만 함)
 *  SLACK_WEBHOOK_URL : Slack Incoming Webhook URL (없으면 콘솔에만 출력)
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");

const { reviewWithAI, hasApiKey } = require("./lib/openai-client");
const { postToSlack } = require("./lib/slack");

// ethers v6 이벤트 필터 폴링이 드물게 내부 오류를 던져 처리되지 않은 Promise
// 거부로 전체 프로세스가 종료되는 것을 방지 (검토 서비스는 계속 실행돼야 함)
process.on("unhandledRejection", (reason) => {
  console.error("⚠️  처리되지 않은 오류(무시하고 계속 실행):", reason?.message || reason);
});

// ── 설정 ──────────────────────────────────────────────────────────
const RPC_URL     = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

// ── ABI (읽기 전용) ──────────────────────────────────────────────
const ABI = [
  "function getAllApplicationIds() view returns (uint256[])",
  "function getApplication(uint256) view returns (tuple(uint256 id, address applicant, string applicantName, uint256 age, uint256 monthlyPremium, uint256 coverageLimit, uint256 maturityDays, uint256 maturityRefundRate, uint8 status, uint256 submittedAt, uint256 processedAt, string rejectReason, uint256 policyId, uint8 riskScore))",
  "event ApplicationSubmitted(uint256 indexed appId, address indexed applicant, string applicantName, uint256 riskScore, uint256 timestamp)",
];

// ── 유틸 ──────────────────────────────────────────────────────────
function log(msg)  { console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toLocaleTimeString("ko-KR")}] ⚠️  ${msg}`); }

function fmtAmount(raw, decimals) {
  if (decimals === 0) return "₩" + Number(raw).toLocaleString("ko-KR");
  return "$" + (Number(raw) / 1e6).toFixed(2);
}

const STATUS_LABEL = ["Pending", "Approved", "Rejected"];

// ── AI 사전검토 (Pending 청약만 대상) ────────────────────────────
async function reviewApplicationWithAI(app, decimals, currency) {
  if (!hasApiKey()) {
    warn(`OPENAI_API_KEY 미설정 — 청약 #${app.id} AI 검토 건너뜀`);
    return;
  }

  const ratio = Number(app.coverageLimit) / Number(app.monthlyPremium);

  const systemPrompt =
    "당신은 치과보험 청약 심사를 보조하는 AI 언더라이터입니다. " +
    "청약자 정보를 보고 승인/거절 권고와 그 이유를 짧게 제시하세요. " +
    "당신의 의견은 참고용이며 최종 승인/거절은 관리자가 반드시 UI에서 직접 처리합니다. " +
    "한국어로 3문장 이내, '권고: (승인/거절/보류) - 이유' 형식으로만 답하세요.";

  const userPrompt =
    `청약 ID: ${app.id}\n` +
    `청약자: ${app.applicantName} (${app.age}세)\n` +
    `월 보험료: ${fmtAmount(app.monthlyPremium, decimals)}\n` +
    `보장 한도: ${fmtAmount(app.coverageLimit, decimals)} (월보험료 대비 ${ratio.toFixed(1)}배)\n` +
    `만기: ${app.maturityDays}일 / 만기환급율: ${app.maturityRefundRate}%\n` +
    `컨트랙트 자동심사 위험점수: ${app.riskScore}/100 (참고용, 승인 여부에 직접 영향 없음)\n` +
    `이 청약은 보장한도/월보험료 비율이 자동승인(10배)과 자동거절(100배) 구간 사이라 ` +
    `관리자 수동 심사 대기 중입니다. 승인 여부에 대한 의견을 주세요.`;

  const opinion = await reviewWithAI(systemPrompt, userPrompt, 300);
  if (!opinion) return;

  const text =
    `🤖 *[${currency} 청약심사] AI 사전검토 — 청약 #${app.id} (관리자 수동 심사 필요)*\n` +
    `청약자: ${app.applicantName} (${app.age}세) | 월보험료: ${fmtAmount(app.monthlyPremium, decimals)} | ` +
    `보장한도: ${fmtAmount(app.coverageLimit, decimals)} (${ratio.toFixed(1)}배) | 위험점수: ${app.riskScore}\n` +
    `${opinion}`;

  await postToSlack(text);
  log(`  🤖 청약 #${app.id} AI 사전검토 완료 → Slack 전송`);
}

async function scanPendingApplications(contract, decimals, currency) {
  log(`🔍 [${currency}] 기존 Pending 청약 스캔 중...`);
  try {
    const ids = await contract.getAllApplicationIds();
    let count = 0;
    for (const id of ids) {
      const app = await contract.getApplication(id);
      if (Number(app.status) === 0) { // Pending
        count++;
        await reviewApplicationWithAI(app, decimals, currency);
      }
    }
    log(`🔍 [${currency}] 스캔 완료 — Pending 청약 ${count}건 검토`);
  } catch (e) {
    warn(`[${currency}] 초기 스캔 오류: ${e.message}`);
  }
}

function attachListener(contract, decimals, currency) {
  log(`👂 [${currency}] ApplicationSubmitted 이벤트 리스닝 시작...`);
  contract.on("ApplicationSubmitted", async (appId) => {
    let app;
    try {
      app = await contract.getApplication(appId);
    } catch (e) {
      warn(`[${currency}] 청약 #${appId} 조회 실패: ${e.message}`);
      return;
    }
    if (Number(app.status) === 0) {
      log(`\n📥 [${currency}] ApplicationSubmitted — 청약 #${appId} (Pending, 관리자 심사 필요)`);
      await reviewApplicationWithAI(app, decimals, currency);
    } else {
      log(`📥 [${currency}] ApplicationSubmitted — 청약 #${appId} (자동 ${STATUS_LABEL[Number(app.status)]}됨, AI 검토 불필요)`);
    }
  });
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
  console.log("  📝 청약 심사 AI 사전검토 서비스 시작 (USDC + KRW)");
  console.log("=".repeat(65));

  if (!hasApiKey()) {
    warn("OPENAI_API_KEY 미설정 — AI 검토 없이 대기만 합니다.");
    warn(".env에 OPENAI_API_KEY=sk-... 를 추가하세요.");
  }

  const usdcAddr = config.contracts?.DentalInsurance;
  const krwAddr  = config.contracts?.DentalInsuranceKRW;

  const usdcContract = usdcAddr ? new ethers.Contract(usdcAddr, ABI, provider) : null;
  const krwContract  = krwAddr  ? new ethers.Contract(krwAddr,  ABI, provider) : null;

  log(`USDC Insurance : ${usdcAddr || "없음"}`);
  log(`KRW  Insurance : ${krwAddr  || "없음"}`);
  console.log("-".repeat(65));

  if (!usdcContract && !krwContract) {
    console.error("❌ 리스닝할 컨트랙트가 없습니다. config.json을 확인하세요.");
    process.exit(1);
  }

  if (usdcContract) await scanPendingApplications(usdcContract, 6, "USDC");
  if (krwContract)  await scanPendingApplications(krwContract, 0, "KRW");

  if (usdcContract) attachListener(usdcContract, 6, "USDC");
  if (krwContract)  attachListener(krwContract, 0, "KRW");

  console.log("-".repeat(65));
  log("✅ 청약 심사 AI 사전검토 서비스 실행 중 (Ctrl+C 로 종료)");
}

main().catch(e => {
  console.error("치명적 오류:", e.message);
  process.exit(1);
});
