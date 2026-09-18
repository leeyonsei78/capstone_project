#!/usr/bin/env node
/**
 * query-policy.js
 * 챗봇(insurance_agent)이 subprocess로 호출해, 특정 지갑주소의 실시간
 * 블록체인 덴탈보험 현황(증권/청구/대출/만기)을 JSON으로 출력하는 읽기 전용
 * 조회 스크립트. USDC 계약만 조회한다 — KRW는 별개 계약이라 챗봇 답변에
 * 혼재시키지 않기로 함 (2026-09-18 사용자 결정, CLAUDE.md 참고).
 *
 * 사용법: node scripts/query-policy.js <지갑주소>
 *
 * 어떤 상황에서도(잘못된 주소, 미배포, 노드 다운 등) 항상 유효한 JSON 한 줄을
 * stdout에 출력하고 exit code 0으로 끝난다 — 호출하는 Python 쪽이 예외 처리를
 * 단순하게(성공/실패 모두 JSON 파싱만 하면 되도록) 할 수 있게 하기 위함.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC_URL     = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

const INSURANCE_ABI = [
  "function getPatientPolicies(address) view returns (uint256[])",
  "function getPatientClaims(address) view returns (uint256[])",
  "function getPolicy(uint256) view returns (tuple(uint256 id, address patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 totalPaid, uint256 totalClaimed, uint256 lastPaymentTime, uint256 nextDueTime, bool active, uint256 createdAt, uint256 maturityDate, uint256 maturityRefundRate, bool maturityPaid, uint256 premiumInterval))",
  "function getClaim(uint256) view returns (tuple(uint256 id, uint256 policyId, address patient, uint256 amount, string treatmentCode, string description, uint8 status, uint256 submittedAt, uint256 processedAt, string rejectReason))",
  "function getPolicyLoan(uint256) view returns (tuple(uint256 policyId, uint256 loanAmount, uint256 borrowedAt, uint256 interestRate, bool active))",
];

const CLAIM_STATUS = ["대기중", "승인됨", "거절됨", "지급완료"];

function fmtAmount(raw, decimals) {
  const n = Number(ethers.formatUnits(raw, decimals));
  return decimals === 0 ? `₩${Math.round(n).toLocaleString("ko-KR")}` : `$${n.toFixed(2)}`;
}
// frontend(app.js)의 tsToDate()와 동일하게 한국 시간(KST)으로 포맷 — 예전엔
// toISOString()(UTC, 타임존 표시 없음)을 그대로 썼다가, 프론트엔드 화면(KST)과
// 챗봇 답변(암묵적 UTC)의 만기 시각이 서로 다르게 보이는 버그가 있었음
// (2026-09-18 수정).
function tsToDate(ts) {
  const n = Number(ts);
  if (n === 0) return null;
  return new Date(n * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " (KST)";
}
function output(obj) {
  console.log(JSON.stringify(obj));
}

async function main() {
  const wallet = process.argv[2];
  if (!wallet || !ethers.isAddress(wallet)) {
    output({ ok: false, error: "유효한 지갑 주소가 아닙니다 (0x로 시작하는 42자 주소여야 합니다).", wallet: wallet || null });
    return;
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    output({ ok: false, error: "블록체인 덴탈보험 앱이 아직 배포되지 않았습니다. 먼저 블록체인 가입을 시작해 앱을 켜주세요." });
    return;
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  try {
    await provider.getBlockNumber();
  } catch (e) {
    output({ ok: false, error: "블록체인 노드에 연결할 수 없습니다. 블록체인 앱이 실행 중인지 확인해주세요." });
    return;
  }

  const block = await provider.getBlock("latest");
  const nowTs = Number(block.timestamp);

  // USDC 계약만 조회한다. USDC·KRW는 서로 독립된 별개 계약이라(동기화 없음),
  // 챗봇이 둘을 섞어 답하면 사용자가 "같은 증권인데 왜 다르게 나오냐"고
  // 혼란스러워함 — 챗봇 답변은 USDC 계약 기준으로 통일 (2026-09-18 결정).
  const currencies = [
    { ccy: "USDC", addr: config.contracts?.DentalInsurance, decimals: 6 },
  ];

  const policies = [];
  const claims = [];

  for (const { ccy, addr, decimals } of currencies) {
    if (!addr) continue;
    const contract = new ethers.Contract(addr, INSURANCE_ABI, provider);
    try {
      const policyIds = await contract.getPatientPolicies(wallet);
      for (const id of policyIds) {
        const p = await contract.getPolicy(id);
        const loan = await contract.getPolicyLoan(id).catch(() => null);
        const remainingSec = Number(p.maturityDate) - nowTs;
        // 프론트엔드(app.js)의 만기 카운트다운과 동일한 방식(Math.floor)으로 계산한
        // 사람이 읽는 문자열. 예전엔 daysUntilMaturity를 Math.ceil(remainingSec/86400)로만
        // 줘서, 만기가 단 몇 분 뒤(=오늘)인데도 값이 1이 되어 챗봇이 "내일 만기"라고
        // 잘못 답하는 버그가 있었음 (2026-09-18 발견) — GPT가 초 단위 숫자를 직접
        // day-단위로 환산하며 날짜 계산을 틀리지 않도록, 아예 "오늘/며칠 후" 문자열을
        // 미리 계산해서 넘긴다.
        let timeUntilMaturity;
        if (p.maturityPaid) {
          timeUntilMaturity = "지급완료";
        } else if (remainingSec <= 0) {
          timeUntilMaturity = "만기 도달(오늘 이전)";
        } else {
          const days  = Math.floor(remainingSec / 86400);
          const hours = Math.floor((remainingSec % 86400) / 3600);
          const mins  = Math.floor((remainingSec % 3600) / 60);
          timeUntilMaturity = days > 0 ? `${days}일 ${hours}시간 후`
            : hours > 0 ? `오늘, ${hours}시간 ${mins}분 후`
            : `오늘, ${mins}분 후`;
        }
        policies.push({
          currency:          ccy,
          policyId:          Number(id),
          patientName:       p.patientName,
          active:            p.active,
          monthlyPremium:    fmtAmount(p.monthlyPremium, decimals),
          coverageLimit:     fmtAmount(p.coverageLimit, decimals),
          totalPaid:         fmtAmount(p.totalPaid, decimals),
          totalClaimed:      fmtAmount(p.totalClaimed, decimals),
          lastPaymentDate:   tsToDate(p.lastPaymentTime),
          nextDueDate:       tsToDate(p.nextDueTime),
          isPremiumDue:      p.active && nowTs >= Number(p.nextDueTime),
          maturityDate:      tsToDate(p.maturityDate),
          maturityPaid:      p.maturityPaid,
          isMatured:         !p.maturityPaid && p.active && p.totalPaid > 0n && nowTs >= Number(p.maturityDate),
          timeUntilMaturity,
          daysUntilMaturity: remainingSec > 0 ? Math.floor(remainingSec / 86400) : 0,
          activeLoan: (loan && loan.active) ? {
            loanAmount: fmtAmount(loan.loanAmount, decimals),
            borrowedAt: tsToDate(loan.borrowedAt),
          } : null,
        });
      }

      const claimIds = await contract.getPatientClaims(wallet);
      for (const id of claimIds) {
        const c = await contract.getClaim(id);
        claims.push({
          currency:      ccy,
          claimId:       Number(id),
          policyId:      Number(c.policyId),
          amount:        fmtAmount(c.amount, decimals),
          treatmentCode: c.treatmentCode,
          description:   c.description || null,
          status:        CLAIM_STATUS[Number(c.status)],
          submittedAt:   tsToDate(c.submittedAt),
          processedAt:   tsToDate(c.processedAt),
          rejectReason:  c.rejectReason || null,
        });
      }
    } catch (e) {
      // 그 통화 컨트랙트가 없거나(미배포) 조회 실패해도 나머지 통화는 계속 진행
    }
  }

  output({
    ok: true,
    wallet,
    queriedAt: tsToDate(nowTs),
    policyCount: policies.length,
    claimCount: claims.length,
    policies,
    claims,
  });
}

main().catch(e => output({ ok: false, error: e.message || String(e) }));
