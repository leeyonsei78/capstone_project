/**
 * lib/slack.js
 * Slack Incoming Webhook 전송 공용 헬퍼.
 *
 * scripts/slack-notifier.js, scripts/oracle-service.js,
 * scripts/application-review-service.js 가 공통으로 사용한다.
 *
 * 환경변수 (.env):
 *  SLACK_WEBHOOK_URL : Slack Incoming Webhook URL (없으면 전송을 건너뛰고 그 사실을 알려줌)
 */

require("dotenv").config();

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";

/**
 * @param {string} text 전송할 메시지 (Slack mrkdwn)
 * @returns {Promise<{sent: boolean, reason?: string, detail?: string}>}
 */
async function postToSlack(text) {
  if (!SLACK_WEBHOOK_URL) return { sent: false, reason: "no_webhook" };
  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      return { sent: false, reason: `http_${res.status}`, detail: await res.text().catch(() => "") };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: "error", detail: e.message };
  }
}

module.exports = { postToSlack, SLACK_WEBHOOK_URL };
