#!/usr/bin/env node
/**
 * install-git-hooks.js
 * `npm install` 시 package.json의 "prepare" 스크립트로 자동 실행되어
 * scripts/git-hooks/pre-commit을 저장소의 .git/hooks/pre-commit으로 복사한다.
 *
 * .git/hooks는 git이 버전관리하지 않으므로 이 방식(husky 없이 직접 복사)이
 * 가장 가벼운 설치 방법이다. 이미 다른 pre-commit 훅이 있으면 덮어쓰기 전에
 * *.backup으로 보존한다.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function findRepoRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function main() {
  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    console.warn("⚠️  git 저장소가 아닌 것 같아 pre-commit 훅 설치를 건너뜁니다.");
    return;
  }

  const hooksDir = path.join(repoRoot, ".git", "hooks");
  if (!fs.existsSync(hooksDir)) {
    console.warn("⚠️  .git/hooks 디렉터리를 찾을 수 없어 pre-commit 훅 설치를 건너뜁니다.");
    return;
  }

  const source = path.join(__dirname, "git-hooks", "pre-commit");
  const target = path.join(hooksDir, "pre-commit");

  if (fs.existsSync(target)) {
    const existing = fs.readFileSync(target, "utf8");
    if (existing.includes("check-secrets.js")) {
      // 이미 우리 훅이 설치돼 있음 — 최신 내용으로 갱신만
    } else if (existing.trim().length > 0) {
      const backup = `${target}.backup`;
      fs.copyFileSync(target, backup);
      console.log(`ℹ️  기존 pre-commit 훅을 ${backup}로 백업했습니다.`);
    }
  }

  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);
  console.log("✅ pre-commit 훅 설치 완료 (커밋 시 scripts/check-secrets.js가 자동 실행됩니다)");
}

main();
