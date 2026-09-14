/**
 * lib/claude-client.js
 * 온체인 심사(청구/청약)에 대한 AI 사전검토 의견을 생성하는 공용 Claude 클라이언트.
 *
 * ⚠️ 원칙: 이 모듈은 참고용 의견 텍스트만 생성한다. 실제 승인/거절, 자금 이체 등
 * 온체인 상태를 바꾸는 결정은 절대 내리지 않으며, 항상 기존 규칙 기반 로직
 * (오라클 자동검증, 관리자 수동승인)이 최종 결정을 담당한다. 이 모듈의 결과는
 * Slack 알림에 참고 의견으로만 첨부된다.
 *
 * 환경변수 (.env):
 *  ANTHROPIC_API_KEY : Claude API 키 (없으면 AI 검토를 건너뛰고 null 반환)
 */

require("dotenv").config();

const MODEL = "claude-opus-5";

let _client = null;

function hasApiKey() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getClient() {
  if (!hasApiKey()) return null;
  if (!_client) {
    const Anthropic = require("@anthropic-ai/sdk");
    _client = new Anthropic();
  }
  return _client;
}

/**
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {number} maxTokens
 * @returns {Promise<string|null>} 텍스트 응답. API 키 미설정/호출 실패 시 null.
 */
async function reviewWithClaude(systemPrompt, userPrompt, maxTokens = 500) {
  const client = getClient();
  if (!client) return null;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      output_config: { effort: "low" },
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === "text");
    return block ? block.text.trim() : null;
  } catch (e) {
    console.warn(`[claude-client] AI 검토 호출 실패: ${e.message}`);
    return null;
  }
}

module.exports = { reviewWithClaude, hasApiKey, MODEL };
