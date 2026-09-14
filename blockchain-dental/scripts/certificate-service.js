/**
 * certificate-service.js
 * 보험증권 서류(PDF) 자동 발급 서비스 (USDC + KRW 양쪽 처리)
 *
 * 실행: node scripts/certificate-service.js
 *
 * 동작:
 *  - PolicyCreated 이벤트 감지 (+ 시작 시 아직 파일이 없는 기존 증권 스캔)
 *    ※ 청약 자동승인이든 관리자 수동승인(approveApplication)이든 관리자 직접
 *      생성(createPolicy)이든, 증권이 만들어지는 모든 경로가 이 이벤트 하나로
 *      귀결되므로 이것만 감지하면 빠짐없이 커버된다.
 *  - GPT-4o로 쉬운말 보장 요약 문구 생성 (선택, insurance_agent 챗봇과 동일한 OpenAI 사용)
 *  - 한글 폰트(Noto Sans KR, assets/fonts/)를 임베드한 PDF 증권 서류 생성 →
 *    frontend/certificates/ 에 저장. frontend 정적 서버(npx serve)가 그대로 서빙하므로
 *    별도 다운로드 서버 구축 없이 URL로 바로 다운로드 가능.
 *  - Slack에 발급 완료 알림 + AI 요약 + 다운로드 링크 전송.
 *
 * ⚠️ 이 서비스는 온체인 상태를 바꾸는 어떤 함수도 호출하지 않는다 (읽기 전용).
 *    AI 요약 문구는 이해를 돕는 참고 자료일 뿐이며, 증권의 법적 근거는 항상
 *    온체인 기록(표에 나열된 증권 정보)에 있다.
 *
 * 환경변수 (.env):
 *  RPC_URL           : JSON-RPC 엔드포인트 (기본: http://127.0.0.1:8545)
 *  CERT_BASE_URL     : 증권 다운로드 링크 베이스 URL (기본: http://localhost:3000/certificates)
 *  OPENAI_API_KEY    : AI 요약 문구용 (없으면 요약 없이 증권만 발급)
 *  SLACK_WEBHOOK_URL : 발급 알림용 (없으면 콘솔에만 출력)
 */

require("dotenv").config();
const { ethers }   = require("ethers");
const fs           = require("fs");
const path         = require("path");
const PDFDocument  = require("pdfkit");

const { reviewWithAI, hasApiKey } = require("./lib/openai-client");
const { postToSlack } = require("./lib/slack");

// ethers v6 이벤트 필터 폴링이 드물게 내부 오류를 던져 처리되지 않은 Promise
// 거부로 전체 프로세스가 종료되는 것을 방지 (발급 서비스는 계속 실행돼야 함)
process.on("unhandledRejection", (reason) => {
  console.error("⚠️  처리되지 않은 오류(무시하고 계속 실행):", reason?.message || reason);
});

// ── 설정 ──────────────────────────────────────────────────────────
const RPC_URL       = process.env.RPC_URL || "http://127.0.0.1:8545";
const CERT_BASE_URL = (process.env.CERT_BASE_URL || "http://localhost:3000/certificates").replace(/\/+$/, "");
const CONFIG_PATH   = path.join(__dirname, "..", "frontend", "config.json");
const CERT_DIR      = path.join(__dirname, "..", "frontend", "certificates");
const FONT_REGULAR  = path.join(__dirname, "..", "assets", "fonts", "NotoSansKR-Regular.ttf");
const FONT_BOLD     = path.join(__dirname, "..", "assets", "fonts", "NotoSansKR-Bold.ttf");

// ── ABI (읽기 전용) ──────────────────────────────────────────────
const ABI = [
  "function getAllPolicyIds() view returns (uint256[])",
  "function getPolicy(uint256) view returns (tuple(uint256 id, address patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 totalPaid, uint256 totalClaimed, uint256 lastPaymentTime, uint256 nextDueTime, bool active, uint256 createdAt, uint256 maturityDate, uint256 maturityRefundRate, bool maturityPaid))",
  "event PolicyCreated(uint256 indexed policyId, address indexed patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 timestamp)",
];

// ── 유틸 ──────────────────────────────────────────────────────────
function log(msg)  { console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toLocaleTimeString("ko-KR")}] ⚠️  ${msg}`); }

function fmtAmount(raw, decimals) {
  if (decimals === 0) return "₩" + Number(raw).toLocaleString("ko-KR");
  return "$" + (Number(raw) / 1e6).toFixed(2);
}
function fmtDate(unixSeconds) {
  return new Date(Number(unixSeconds) * 1000).toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric",
  });
}
function shortAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
function certFileName(currency, policyId) {
  return `${currency.toLowerCase()}-policy-${policyId}.pdf`;
}

// ── AI 쉬운말 보장 요약 문구 생성 (참고용, 증권의 법적 근거는 아님) ───
async function generateSummary(policy, decimals) {
  if (!hasApiKey()) return null;

  const systemPrompt =
    "당신은 보험 상품 설명을 쉬운 말로 풀어 쓰는 보조원입니다. " +
    "아래 보험증권 정보를 바탕으로, 가입자가 한눈에 이해할 수 있는 쉬운말 요약을 " +
    "한국어 2~3문장으로 작성하세요. 전문 용어 대신 일상적인 표현을 쓰고, " +
    "월 납입액·보장한도·만기 시 혜택을 자연스럽게 포함하세요. 다른 설명 없이 요약 문장만 답하세요.";

  const userPrompt =
    `피보험자: ${policy.patientName}\n` +
    `월 보험료: ${fmtAmount(policy.monthlyPremium, decimals)}\n` +
    `보장 한도: ${fmtAmount(policy.coverageLimit, decimals)}\n` +
    `만기일: ${fmtDate(policy.maturityDate)}\n` +
    `만기환급율: ${policy.maturityRefundRate}%`;

  return await reviewWithAI(systemPrompt, userPrompt, 300);
}

// ── PDF 증권 서류 생성 ────────────────────────────────────────────
function generateCertificatePdf(outPath, policy, currency, decimals, summary) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);

    doc.registerFont("KR-Regular", FONT_REGULAR);
    doc.registerFont("KR-Bold", FONT_BOLD);

    const PAGE_RIGHT = 539; // A4(595pt) - margin(56)

    function sectionTitle(title) {
      doc.font("KR-Bold").fontSize(13).fillColor("#0f172a").text(title);
      doc.moveTo(doc.x, doc.y + 4).lineTo(PAGE_RIGHT, doc.y + 4).strokeColor("#e2e8f0").stroke();
      doc.moveDown(0.6);
    }
    function row(label, value) {
      doc.font("KR-Regular").fontSize(11).fillColor("#64748b").text(`${label} : `, { continued: true });
      doc.font("KR-Bold").fillColor("#0f172a").text(value);
    }

    // 헤더
    doc.font("KR-Bold").fontSize(22).fillColor("#0f172a")
      .text("🦷 덴탈보험 보험증권", { align: "center" });
    doc.moveDown(0.3);
    doc.font("KR-Regular").fontSize(10).fillColor("#64748b")
      .text(`Dental Insurance Policy Certificate — ${currency}`, { align: "center" });
    doc.moveDown(1.5);

    // 증권 기본 정보
    sectionTitle("증권 정보");
    row("증권 번호", `#${policy.id}`);
    row("피보험자", `${policy.patientName} (${shortAddr(policy.patient)})`);
    row("월 보험료", fmtAmount(policy.monthlyPremium, decimals));
    row("보장 한도", fmtAmount(policy.coverageLimit, decimals));
    row("가입일", fmtDate(policy.createdAt));
    row("만기일", fmtDate(policy.maturityDate));
    row("만기환급율", `${policy.maturityRefundRate}%`);
    row("발급일", fmtDate(Math.floor(Date.now() / 1000)));
    doc.moveDown(1.2);

    // AI 쉬운말 요약 (선택)
    if (summary) {
      sectionTitle("💡 쉬운말 요약 (AI 생성 · 참고용)");
      const boxTop = doc.y;
      doc.font("KR-Regular").fontSize(11).fillColor("#334155")
        .text(summary, 56 + 12, boxTop + 10, { width: PAGE_RIGHT - 56 - 24 });
      const boxBottom = doc.y + 10;
      doc.roundedRect(56, boxTop, PAGE_RIGHT - 56, boxBottom - boxTop, 6)
        .strokeColor("#cbd5e1").stroke();
      doc.y = boxBottom + 16;
    }

    // 안내 사항
    sectionTitle("안내 사항");
    doc.font("KR-Regular").fontSize(9.5).fillColor("#64748b").list([
      "이 증권은 이더리움 호환 스마트컨트랙트(Hardhat 테스트넷)에 기록된 내용을 근거로 자동 발급되었습니다.",
      "실제 보장 내용·잔액·납입/청구 이력의 원본은 항상 온체인 데이터이며, 이 문서는 참고용 사본입니다.",
      "AI 생성 요약은 이해를 돕기 위한 참고 자료일 뿐, 법적 근거는 위 증권 정보(표)와 온체인 기록에 있습니다.",
    ], { bulletRadius: 1.5, textIndent: 6 });

    doc.moveDown(1);
    doc.fontSize(8).fillColor("#94a3b8")
      .text(`Contract-backed certificate · generated at ${new Date().toISOString()}`, { align: "center" });

    doc.end();
  });
}

// ── 증권 발급 (파일 생성 + AI 요약 + Slack 알림) ───────────────────
async function issueCertificate(contract, policyId, decimals, currency) {
  const fileName = certFileName(currency, policyId);
  const outPath = path.join(CERT_DIR, fileName);

  if (fs.existsSync(outPath)) return; // 이미 발급됨 — 재발급하지 않음

  const policy = await contract.getPolicy(policyId);
  log(`📄 [${currency}] 증권 #${policyId} 서류 생성 중...`);

  let summary = null;
  if (hasApiKey()) {
    summary = await generateSummary(policy, decimals);
  } else {
    warn(`  OPENAI_API_KEY 미설정 — AI 요약 없이 증권만 발급`);
  }

  await generateCertificatePdf(outPath, policy, currency, decimals, summary);

  const downloadUrl = `${CERT_BASE_URL}/${fileName}`;
  const text =
    `📄 *[${currency} 덴탈보험] 보험증권 발급 완료 — 증권 #${policyId}*\n` +
    `피보험자: ${policy.patientName} | 월보험료: ${fmtAmount(policy.monthlyPremium, decimals)} | ` +
    `보장한도: ${fmtAmount(policy.coverageLimit, decimals)} | 만기: ${fmtDate(policy.maturityDate)}\n` +
    (summary ? `💡 ${summary}\n` : "") +
    `📥 증권 다운로드: ${downloadUrl}`;

  await postToSlack(text);
  log(`  ✅ 증권 #${policyId} 발급 완료 → ${fileName}`);
}

async function scanExistingPolicies(contract, decimals, currency) {
  log(`🔍 [${currency}] 미발급 증권 스캔 중...`);
  try {
    const ids = await contract.getAllPolicyIds();
    let issued = 0;
    for (const id of ids) {
      const alreadyExists = fs.existsSync(path.join(CERT_DIR, certFileName(currency, Number(id))));
      try {
        await issueCertificate(contract, Number(id), decimals, currency);
      } catch (e) {
        warn(`[${currency}] 증권 #${id} 발급 실패: ${e.message}`);
        continue;
      }
      if (!alreadyExists) issued++;
    }
    log(`🔍 [${currency}] 스캔 완료 — 신규 발급 ${issued}건`);
  } catch (e) {
    warn(`[${currency}] 초기 스캔 오류: ${e.message}`);
  }
}

function attachListener(contract, decimals, currency) {
  log(`👂 [${currency}] PolicyCreated 이벤트 리스닝 시작...`);
  contract.on("PolicyCreated", async (policyId) => {
    log(`\n📥 [${currency}] PolicyCreated — 증권 #${policyId}`);
    try {
      await issueCertificate(contract, Number(policyId), decimals, currency);
    } catch (e) {
      warn(`[${currency}] 증권 #${policyId} 발급 실패: ${e.message}`);
    }
  });
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error("❌ frontend/config.json 없음 — 먼저 배포를 실행하세요.");
    process.exit(1);
  }
  if (!fs.existsSync(FONT_REGULAR) || !fs.existsSync(FONT_BOLD)) {
    console.error("❌ 한글 폰트 파일이 없습니다: assets/fonts/NotoSansKR-Regular.ttf / NotoSansKR-Bold.ttf");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log("=".repeat(65));
  console.log("  📄 보험증권 자동 발급 서비스 시작 (USDC + KRW)");
  console.log("=".repeat(65));

  if (!hasApiKey()) {
    warn("OPENAI_API_KEY 미설정 — AI 요약 문구 없이 증권만 발급합니다.");
  }

  fs.mkdirSync(CERT_DIR, { recursive: true });

  const usdcAddr = config.contracts?.DentalInsurance;
  const krwAddr  = config.contracts?.DentalInsuranceKRW;

  const usdcContract = usdcAddr ? new ethers.Contract(usdcAddr, ABI, provider) : null;
  const krwContract  = krwAddr  ? new ethers.Contract(krwAddr,  ABI, provider) : null;

  log(`USDC Insurance : ${usdcAddr || "없음"}`);
  log(`KRW  Insurance : ${krwAddr  || "없음"}`);
  log(`증권 저장 경로 : ${CERT_DIR}`);
  log(`다운로드 링크  : ${CERT_BASE_URL}/...`);
  console.log("-".repeat(65));

  if (!usdcContract && !krwContract) {
    console.error("❌ 리스닝할 컨트랙트가 없습니다. config.json을 확인하세요.");
    process.exit(1);
  }

  if (usdcContract) await scanExistingPolicies(usdcContract, 6, "USDC");
  if (krwContract)  await scanExistingPolicies(krwContract, 0, "KRW");

  if (usdcContract) attachListener(usdcContract, 6, "USDC");
  if (krwContract)  attachListener(krwContract, 0, "KRW");

  console.log("-".repeat(65));
  log("✅ 보험증권 자동 발급 서비스 실행 중 (Ctrl+C 로 종료)");
}

main().catch(e => {
  console.error("치명적 오류:", e.message);
  process.exit(1);
});
