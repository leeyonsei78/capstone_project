#!/usr/bin/env node
/**
 * check-secrets.js
 * git pre-commit 훅에서 호출되는 시크릿 스캐너 CLI.
 *
 * 스테이징된(git add된) 변경 파일 중 "새로 추가되는 줄"만 검사한다 —
 * 파일 전체가 아니라 diff의 +줄만 보는 이유는, 이 저장소가 이미 공개적으로
 * 알려진 Hardhat 테스트 개인키 등 고엔트로피 문자열을 의도적으로 포함하고
 * 있어서, 기존 코드까지 매번 다시 검사하면 무관한 커밋까지 막히기 때문.
 *
 * CRITICAL/HIGH(AWS·GitHub·GitLab·Slack·Stripe·PEM 등 구체적 서비스 키 형식과
 * 정확히 일치하는 경우)만 커밋을 막는다. MEDIUM/LOW(일반 자격증명 할당 패턴,
 * 고엔트로피 문자열 추정)는 오탐 가능성이 있는 휴리스틱이라 경고만 출력한다.
 *
 * 사용법: node scripts/check-secrets.js
 *   (scripts/git-hooks/pre-commit이 커밋 시 자동으로 이 스크립트를 호출한다 —
 *    설치는 `npm install` 시 scripts/install-git-hooks.js가 자동으로 해줌)
 */

const { execSync } = require("child_process");
const { scanText, mask } = require("./lib/secret-scanner");

function getStagedDiff() {
  try {
    // -U0: 컨텍스트 줄 없이 변경된 줄만. 바이너리 파일은 diff에 안 나오므로 자동 제외됨.
    return execSync("git diff --cached -U0 --no-color", { encoding: "utf8", maxBuffer: 1024 * 1024 * 50 });
  } catch (e) {
    // 스캐너 도구 자체의 문제로 커밋이 영영 막히면 안 되므로 fail-open —
    // 실제 시크릿을 찾았을 때만(hasBlocking) 커밋을 막는다.
    console.warn(`⚠️  git diff --cached 실행 실패, 시크릿 스캔을 건너뜁니다: ${e.message}`);
    return null;
  }
}

// unified diff를 "파일별 + 추가된 줄" 목록으로 분해
function parseAddedLines(diffText) {
  const files = [];
  let current = null;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).replace(/^b\//, "");
      current = { path, lines: [] };
      if (path !== "/dev/null") files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      current.lines.push(line.slice(1));
    }
  }
  return files;
}

function main() {
  const diff = getStagedDiff();
  if (diff === null) {
    process.exit(0); // diff 조회 자체가 실패 — 스캐너 문제로 커밋을 막지 않음(fail-open)
  }
  if (!diff.trim()) {
    process.exit(0); // 스테이징된 변경 없음 — 통과
  }

  const files = parseAddedLines(diff);
  let hasBlocking = false;
  let hasWarning = false;

  for (const file of files) {
    if (!file.lines.length) continue;
    const content = file.lines.join("\n");
    const { findings } = scanText(content);
    if (!findings.length) continue;

    for (const f of findings) {
      const blocking = f.severity === "CRITICAL" || f.severity === "HIGH";
      const icon = blocking ? "🚫" : "⚠️ ";
      console.log(`${icon} [${f.severity}] ${file.path} — ${f.label}: ${f.masked}`);
      if (blocking) hasBlocking = true;
      else hasWarning = true;
    }
  }

  if (hasBlocking) {
    console.log("\n❌ 커밋 차단: 위 CRITICAL/HIGH 항목이 실제 시크릿이라면 코드에서 제거하고");
    console.log("   환경변수(.env, 커밋 대상 아님)로 옮긴 뒤 다시 커밋하세요.");
    console.log("   테스트용으로 확실히 안전한 값이면 .env.example처럼 자리표시자로 바꿔주세요.");
    process.exit(1);
  }

  if (hasWarning) {
    console.log("\n⚠️  위 MEDIUM/LOW 항목은 오탐 가능성이 있는 휴리스틱이라 커밋은 막지 않습니다.");
  }
  process.exit(0);
}

// 스캐너 도구 자체의 버그로 커밋이 영영 막히면 안 되므로, 예상 못한 예외는
// 경고만 남기고 fail-open(커밋 허용). 실제 시크릿 발견(hasBlocking) 시의
// 의도된 차단(process.exit(1))만 커밋을 막는다.
try {
  main();
} catch (e) {
  console.warn(`⚠️  시크릿 스캐너 내부 오류(무시하고 커밋 진행): ${e.message}`);
  process.exit(0);
}
