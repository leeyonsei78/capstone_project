/**
 * lib/openai-client.js
 * 온체인 심사(청구/청약)에 대한 AI 사전검토 의견을 생성하는 공용 OpenAI 클라이언트.
 *
 * insurance_agent 챗봇(agents/orchestrator.py)과 동일하게 OpenAI GPT-4o를 사용한다.
 *
 * ⚠️ 원칙: 이 모듈은 참고용 의견 텍스트만 생성한다. 실제 승인/거절, 자금 이체 등
 * 온체인 상태를 바꾸는 결정은 절대 내리지 않으며, 항상 기존 규칙 기반 로직
 * (오라클 자동검증, 관리자 수동승인)이 최종 결정을 담당한다. 이 모듈의 결과는
 * Slack 알림에 참고 의견으로만 첨부된다.
 *
 * 환경변수 (.env):
 *  OPENAI_API_KEY : OpenAI API 키 (insurance_agent/.env와 동일한 키 재사용 가능.
 *                   없으면 AI 검토를 건너뛰고 null 반환)
 */

require("dotenv").config();

const MODEL = "gpt-4o";

let _client = null;

function hasApiKey() {
  return !!process.env.OPENAI_API_KEY;
}

function getClient() {
  if (!hasApiKey()) return null;
  if (!_client) {
    const OpenAI = require("openai");
    _client = new OpenAI();
  }
  return _client;
}

/**
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {number} maxTokens
 * @returns {Promise<string|null>} 텍스트 응답. API 키 미설정/호출 실패 시 null.
 */
async function reviewWithAI(systemPrompt, userPrompt, maxTokens = 500) {
  const client = getClient();
  if (!client) return null;
  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const text = response.choices?.[0]?.message?.content;
    return text ? text.trim() : null;
  } catch (e) {
    console.warn(`[openai-client] AI 검토 호출 실패: ${e.message}`);
    return null;
  }
}

module.exports = { reviewWithAI, hasApiKey, MODEL };
