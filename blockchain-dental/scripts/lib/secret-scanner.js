/**
 * lib/secret-scanner.js
 * 정규식/엔트로피 기반 시크릿 스캐너 — check-secrets.js(pre-commit 훅)가 사용한다.
 *
 * ⚠️ 보안 설계: 매치된 값은 찾아내는 즉시 마스킹하고, 그 이후로는 원본 값이나
 * 원본 텍스트 조각을 절대 다시 노출하지 않는다. LLM을 전혀 쓰지 않는 결정론적
 * 패턴 매칭이라 실제 비밀값을 외부(API 등)로 전송할 필요 자체가 없다.
 *
 * 참고: 별도 보안 도구 프로젝트(ai-security-suite)의
 * secret_scanner_service.py 패턴 세트를 Node.js로 이식.
 */

const PLACEHOLDER_WORDS = new Set([
  "xxx", "yyy", "zzz", "changeme", "change_me", "your_api_key_here", "example",
  "test", "placeholder", "dummy", "sample", "todo", "fixme", "secret", "password",
]);

// CRITICAL/HIGH — 특정 서비스의 실제 키 형식과 정확히 일치할 때만 매치되므로
// 이 저장소의 공개된 Hardhat 테스트 개인키(0x + 64자리 hex) 등과 겹치지 않는다.
const PATTERNS = [
  { id: "aws_access_key", label: "AWS 액세스 키 ID", severity: "CRITICAL",
    regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "aws_secret_key", label: "AWS 시크릿 액세스 키", severity: "CRITICAL",
    regex: /aws_secret_access_key\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi, group: 1 },
  { id: "github_token", label: "GitHub 토큰", severity: "CRITICAL",
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { id: "gitlab_token", label: "GitLab Personal Access Token", severity: "CRITICAL",
    regex: /\bglpat-[A-Za-z0-9\-_]{20,}\b/g },
  { id: "slack_token", label: "Slack 토큰", severity: "HIGH",
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,48}\b/g },
  { id: "slack_webhook", label: "Slack Webhook URL", severity: "HIGH",
    regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]+\/B[A-Za-z0-9_]+\/[A-Za-z0-9_]+/g },
  { id: "google_api_key", label: "Google API 키", severity: "HIGH",
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { id: "stripe_live_secret", label: "Stripe 라이브 시크릿 키", severity: "CRITICAL",
    regex: /\bsk_live_[0-9a-zA-Z]{20,}\b/g },
  { id: "stripe_live_publishable", label: "Stripe 라이브 공개 키", severity: "MEDIUM",
    regex: /\bpk_live_[0-9a-zA-Z]{20,}\b/g },
  { id: "private_key_block", label: "개인키 블록", severity: "CRITICAL",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { id: "twilio_key", label: "Twilio API 키", severity: "HIGH",
    regex: /\bSK[0-9a-fA-F]{32}\b/g },
  { id: "db_connection_string", label: "DB 연결 문자열 (자격증명 포함)", severity: "HIGH",
    regex: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:@/\s]+:([^@/\s]+)@[^/\s]+/g, group: 1 },
  { id: "jwt_like", label: "JWT 형태 토큰", severity: "MEDIUM",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

// MEDIUM/LOW — 휴리스틱이라 오탐 가능성이 있음. check-secrets.js에서는
// 경고만 출력하고 커밋을 막지는 않는다 (이 저장소의 공개 Hardhat 테스트 키처럼
// 고엔트로피 hex 문자열이 정상적으로 존재하는 코드베이스이기 때문).
const GENERIC_ASSIGNMENT_RE = /\b(?:api[_-]?key|secret|token|passwd|password|pwd|access[_-]?key)\b\s*[:=]\s*['"]([A-Za-z0-9+/=_\-]{12,})['"]/gi;
const ENTROPY_CANDIDATE_RE = /['"]([A-Za-z0-9+/=_\-]{20,100})['"]/g;

function mask(value) {
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

function shannonEntropy(s) {
  if (!s) return 0;
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  const len = s.length;
  return -Object.values(freq).reduce((sum, c) => sum + (c / len) * Math.log2(c / len), 0);
}

function isPlaceholder(value) {
  const lowered = value.toLowerCase();
  if (PLACEHOLDER_WORDS.has(lowered)) return true;
  if (/^x+$/.test(lowered) || /^0+$/.test(lowered) || /^1+$/.test(lowered)) return true;
  if (["example", "placeholder", "changeme", "your_", "dummy", "sample_"].some(w => lowered.includes(w))) return true;
  // 값 "안"에 X000...처럼 6자 이상 같은 문자가 연속되는 자리표시자도 걸러냄
  // (예: .env.example의 Slack webhook URL 끝부분 XXXXXXXXXXXXXXXXXXXXXXXX).
  // 실제 무작위 시크릿은 이런 긴 반복 구간이 나타날 확률이 사실상 없다.
  if (/([A-Za-z0-9])\1{5,}/.test(value)) return true;
  return false;
}

/**
 * @param {string} content 검사할 텍스트 (파일 전체 또는 diff의 추가된 줄들)
 * @returns {{findings: Array, stats: object, overallRisk: string}}
 */
function scanText(content) {
  const lines = content.split("\n");
  const findings = [];
  const flaggedLines = new Set();

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    for (const pat of PATTERNS) {
      pat.regex.lastIndex = 0;
      let m;
      while ((m = pat.regex.exec(line)) !== null) {
        const value = pat.group ? m[pat.group] : m[0];
        if (!value || isPlaceholder(value)) continue;
        findings.push({
          patternId: pat.id,
          label: pat.label,
          severity: pat.severity,
          line: lineNo,
          masked: mask(value),
        });
        flaggedLines.add(lineNo);
      }
    }

    GENERIC_ASSIGNMENT_RE.lastIndex = 0;
    let gm;
    while ((gm = GENERIC_ASSIGNMENT_RE.exec(line)) !== null) {
      const value = gm[1];
      if (isPlaceholder(value)) continue;
      findings.push({
        patternId: "generic_credential_assignment",
        label: "일반 자격증명 할당 패턴",
        severity: "MEDIUM",
        line: lineNo,
        masked: mask(value),
      });
      flaggedLines.add(lineNo);
    }
  });

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    if (flaggedLines.has(lineNo)) return;
    ENTROPY_CANDIDATE_RE.lastIndex = 0;
    const m = ENTROPY_CANDIDATE_RE.exec(line);
    if (!m) return;
    const value = m[1];
    if (isPlaceholder(value) || shannonEntropy(value) < 4.2) return;
    findings.push({
      patternId: "high_entropy_string",
      label: "고엔트로피 문자열 (추정)",
      severity: "LOW",
      line: lineNo,
      masked: mask(value),
    });
  });

  const stats = { total: findings.length, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) stats[f.severity] = (stats[f.severity] || 0) + 1;

  const overallRisk =
    stats.CRITICAL > 0 ? "CRITICAL" :
    stats.HIGH > 0     ? "HIGH" :
    stats.MEDIUM > 0   ? "MEDIUM" :
    stats.LOW > 0      ? "LOW" : "INFO";

  return { findings, stats, overallRisk };
}

module.exports = { scanText, mask };
