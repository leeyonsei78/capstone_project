#!/usr/bin/env node
/**
 * test-slack.js
 * .env의 SLACK_WEBHOOK_URL이 실제로 동작하는지 한 번에 확인하는 스크립트.
 *
 * 사용법: node scripts/test-slack.js
 *   (또는 npm run test-slack)
 *
 * SLACK_WEBHOOK_URL이 비어 있으면 lib/slack.js의 동작 그대로 전송을
 * 건너뛰고 그 사실을 알려준다 (다른 서비스들과 동일한 fallback 동작).
 */
require("dotenv").config();
const { postToSlack, SLACK_WEBHOOK_URL } = require("./lib/slack");

async function main() {
  console.log("=".repeat(60));
  console.log("  Slack Webhook 연결 테스트");
  console.log("=".repeat(60));

  if (!SLACK_WEBHOOK_URL) {
    console.log("❌ SLACK_WEBHOOK_URL이 .env에 설정되어 있지 않습니다.");
    console.log("   .env.example의 안내를 참고해 Incoming Webhook을 발급받아 설정하세요.");
    process.exit(1);
  }

  console.log(`설정된 Webhook: ${SLACK_WEBHOOK_URL.slice(0, 40)}...`);
  console.log("테스트 메시지를 전송하는 중...");

  const result = await postToSlack(
    `🧪 *Slack 연동 테스트 메시지* — ${new Date().toLocaleString("ko-KR")}\n` +
    `이 메시지가 보인다면 SLACK_WEBHOOK_URL 설정이 정상입니다.`
  );

  if (result.sent) {
    console.log("✅ 전송 성공 — Slack 채널에서 메시지를 확인하세요.");
    process.exit(0);
  } else {
    console.log(`❌ 전송 실패 (${result.reason}): ${result.detail || ""}`);
    console.log("   Webhook URL이 올바른지, Slack App이 워크스페이스에 설치되어 있는지 확인하세요.");
    process.exit(1);
  }
}

main();
