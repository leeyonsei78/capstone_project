/**
 * lib/mailer.js
 * SMTP 이메일 발송 공용 헬퍼 (nodemailer 기반).
 *
 * 기본 대상은 로컬 Docker로 띄운 Mailpit(SMTP 캐처, ../docker-compose.yml) —
 * 실 계정/자격증명 없이 localhost:1025로 보내면 http://localhost:8025 웹 UI에서
 * 발송~수신을 그대로 확인할 수 있다. 실제 SMTP 서버(Gmail, SendGrid 등)로 바꾸려면
 * .env의 SMTP_* 값만 바꾸면 되고 이 파일은 그대로 재사용된다.
 *
 * scripts/email-service.js 가 사용한다.
 *
 * 환경변수 (.env):
 *  SMTP_HOST   : 기본 localhost (Mailpit)
 *  SMTP_PORT   : 기본 1025 (Mailpit)
 *  SMTP_SECURE : "true"면 TLS 사용 (기본 false — Mailpit은 평문)
 *  SMTP_USER / SMTP_PASS : 인증이 필요한 서버일 때만 (Mailpit은 불필요)
 *  SMTP_FROM   : 발신자 표시 이름 + 주소
 */

require("dotenv").config();
const nodemailer = require("nodemailer");

const SMTP_HOST = process.env.SMTP_HOST || "localhost";
const SMTP_PORT = Number(process.env.SMTP_PORT || 1025);
const SMTP_FROM = process.env.SMTP_FROM || '"라이나생명 블록체인치아보험" <no-reply@dental-insurance.local>';

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return _transporter;
}

/**
 * @param {{to:string, subject:string, html:string, attachments?:Array}} opts
 * @returns {Promise<{sent:boolean, messageId?:string, reason?:string, detail?:string}>}
 */
async function sendMail({ to, subject, html, attachments }) {
  try {
    const info = await getTransporter().sendMail({ from: SMTP_FROM, to, subject, html, attachments });
    return { sent: true, messageId: info.messageId };
  } catch (e) {
    return { sent: false, reason: "error", detail: e.message };
  }
}

module.exports = { sendMail, SMTP_HOST, SMTP_PORT };
