/**
 * lib/injection-guard.js
 * 프롬프트 인젝션/탈옥 시도를 정규식 기반으로 탐지하는 오프라인 가드.
 *
 * oracle-service.js(청구 설명), application-review-service.js(청약자 정보) 등
 * 사용자가 입력한 자유 텍스트를 OpenAI 프롬프트에 넣기 *전에* 이 모듈로 먼저
 * 검사한다. LLM을 전혀 호출하지 않는 순수 규칙 기반이라 비용/지연이 없고,
 * "인젝션 탐지용으로 또 다른 LLM을 쓰는" 순환 리스크도 없다.
 *
 * ⚠️ 이 가드는 입력을 차단하지 않는다 — 이 프로젝트의 AI 결과물은 전부
 * 참고용(어드바이저)이므로, 의심 패턴이 발견되면 Slack 메시지에 경고만
 * 덧붙여 관리자가 AI 의견을 더 신중하게 판단하도록 돕는다.
 *
 * 참고: 별도 보안 도구 프로젝트(ai-security-suite)의
 * injection_offline_engine.py 규칙 세트를 Node.js로 이식.
 */

const INSTRUCTION_OVERRIDE_RE = new RegExp(
  "ignore (all |any )?(previous|prior|above|earlier) instructions" +
  "|disregard (the |all )?(above|previous|prior)" +
  "|지금까지의?\\s*(모든\\s*)?지시\\s*(사항)?\\s*.{0,6}\\s*무시" +
  "|이전\\s*(모든\\s*)?지시.{0,10}무시" +
  "|기존\\s*(규칙|지시).{0,10}무시",
  "i"
);
const LEAK_RE = new RegExp(
  "system prompt.{0,20}(verbatim|exactly|그대로)" +
  "|reveal your (system )?(prompt|instructions)" +
  "|output (your )?(system )?instructions" +
  "|시스템\\s*프롬프트.{0,10}(그대로|원문).{0,10}(출력|보여)" +
  "|지시사항.{0,10}(그대로|전부).{0,10}출력",
  "i"
);
const DEV_MODE_RE = new RegExp(
  "developer mode|debug mode|개발자\\s*모드|디버그\\s*모드|제한\\s*없.{0,4}(모드|답변)|no restrictions",
  "i"
);
const JAILBREAK_RE = new RegExp(
  "\\bDAN\\b|do anything now|act as if you have no (rules|restrictions|limits)" +
  "|무엇이든\\s*(제한\\s*없이|할\\s*수\\s*있)|규칙.{0,8}(따르지\\s*않|무시하고)\\s*행동" +
  "|어떤\\s*(규칙|제한)(도|이나)\\s*(따르지|없)",
  "i"
);
const DELIM_SPOOF_RE = new RegExp(
  "----+\\s*end of (user )?input\\s*----+|<\\|.*?\\|>|<system>|###\\s*system|SYSTEM:\\s*\\S",
  "i"
);
const ENCODING_RE = /base ?64/i;
const HIDDEN_DIRECTIVE_RE = new RegExp(
  "<!--.*?(AI|assistant|어시스턴트).{0,60}(방문|입력|안내|수행|하세요|해줘|해라).*?-->",
  "is"
);
const ZERO_WIDTH_RE = /[​‌‍﻿]{3,}/;

const TIER_BASE = { INJECTION: 85, JAILBREAK: 66, SUSPICIOUS: 40 };
const TIER_RANK = { INJECTION: 0, JAILBREAK: 1, SUSPICIOUS: 2 };

const RECOMMENDATION_BY_VERDICT = {
  INJECTION: "이 입력을 AI 프롬프트에 그대로 신뢰하지 말고, AI 의견은 참고만 하세요. 반복되면 해당 사용자를 별도 확인하세요.",
  JAILBREAK: "페르소나 주입으로 안전 정책을 우회하려는 패턴입니다. AI 의견의 어조/내용이 평소와 다르면 무시하세요.",
  SUSPICIOUS: "구분자·인코딩 조작 패턴이 발견됐습니다. AI 검토 의견을 그대로 받아들이지 말고 원문을 직접 확인하세요.",
  SAFE: "특이 패턴 없음.",
};

/**
 * @param {string} text 검사할 사용자 입력 원문 (청구 설명, 청약자 정보 등)
 * @param {"prompt"|"document"} inputType "document"일 때만 은닉 HTML 주석 지시문(간접 인젝션) 탐지
 * @returns {{verdict: "INJECTION"|"JAILBREAK"|"SUSPICIOUS"|"SAFE", score: number, techniques: string[], recommendation: string}}
 */
function scanForInjection(text, inputType = "prompt") {
  const content = text || "";
  const techniques = [];
  const matchedTiers = [];

  const hasEncoding = ENCODING_RE.test(content) &&
    (INSTRUCTION_OVERRIDE_RE.test(content) || DELIM_SPOOF_RE.test(content));
  const hasHidden = inputType === "document" && HIDDEN_DIRECTIVE_RE.test(content);
  const hasZeroWidth = ZERO_WIDTH_RE.test(content);

  const checks = [
    [INSTRUCTION_OVERRIDE_RE.test(content), "직접 명령 재정의 (Instruction Override)", "INJECTION"],
    [LEAK_RE.test(content), "시스템 프롬프트 추출 시도 (Prompt Leaking)", "INJECTION"],
    [hasHidden, "간접 인젝션 (문서 내 은닉 지시문)", "INJECTION"],
    [DEV_MODE_RE.test(content), "개발자 모드 사칭 (Fake Developer/Debug Mode)", "JAILBREAK"],
    [JAILBREAK_RE.test(content), "역할극 탈옥 (DAN/Role-play Jailbreak)", "JAILBREAK"],
    [DELIM_SPOOF_RE.test(content), "구분자 조작 (Fake Delimiter/System Tag)", "SUSPICIOUS"],
    [hasEncoding, "인코딩 난독화 시도 (Encoding Obfuscation)", "SUSPICIOUS"],
    [hasZeroWidth, "제로폭 문자 은닉 (Zero-width Steganography)", "SUSPICIOUS"],
  ];

  for (const [matched, label, tier] of checks) {
    if (matched) {
      techniques.push(label);
      matchedTiers.push(tier);
    }
  }

  if (matchedTiers.length === 0) {
    return { verdict: "SAFE", score: 4, techniques: [], recommendation: RECOMMENDATION_BY_VERDICT.SAFE };
  }

  const verdict = matchedTiers.reduce((best, t) => (TIER_RANK[t] < TIER_RANK[best] ? t : best));
  const base = TIER_BASE[verdict];
  const bonus = Math.min(99 - base, (matchedTiers.length - 1) * 4);
  const score = base + bonus;

  return { verdict, score, techniques, recommendation: RECOMMENDATION_BY_VERDICT[verdict] };
}

/**
 * Slack 메시지에 덧붙일 경고 줄. SAFE면 빈 문자열을 반환한다.
 */
function formatWarning(scanResult) {
  if (scanResult.verdict === "SAFE") return "";
  return (
    `⚠️ *입력 검증 경고 (${scanResult.verdict}, 위험도 ${scanResult.score}/100)* — ` +
    `${scanResult.techniques.join(", ")} 패턴 발견. ${scanResult.recommendation}`
  );
}

module.exports = { scanForInjection, formatWarning };
