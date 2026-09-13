/**
 * base-provider.js
 * 병원 진료내역 데이터 제공자 추상 인터페이스
 *
 * HIRA API 또는 Mock 데이터로 교체 시 이 인터페이스를 구현하세요.
 *
 *  현재 구현체:
 *   - MockHospitalProvider  (scripts/hospital-provider/mock-provider.js)
 *   - HIRAProvider          (scripts/hospital-provider/hira-provider.js)  ← 추후 실제 연동
 *
 *  교체 방법:
 *   .env 파일에서 HOSPITAL_PROVIDER=hira 로 변경
 */

class BaseHospitalProvider {
  /**
   * 진료내역 조회
   *
   * @param {string} patientAddress  - 피보험자 지갑 주소 (0x...)
   * @param {string} treatmentCode   - ADA 치료 코드 (예: D0120, D2140)
   * @param {number} claimDate       - 청구 Unix timestamp
   * @returns {Promise<MedicalRecord|null>}  - 진료 기록 없으면 null
   */
  async getMedicalRecord(patientAddress, treatmentCode, claimDate) {
    throw new Error("getMedicalRecord() must be implemented");
  }

  /**
   * 청구 금액 적정성 검증
   *
   * @param {string} treatmentCode   - ADA 치료 코드
   * @param {number} requestedAmount - 청구 금액 (USDC, 소수 단위 e.g. 50_000000)
   * @returns {Promise<VerificationResult>}
   */
  async verifyClaimAmount(treatmentCode, requestedAmount) {
    throw new Error("verifyClaimAmount() must be implemented");
  }

  /**
   * 제공자 상태 확인
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  async healthCheck() {
    throw new Error("healthCheck() must be implemented");
  }
}

/**
 * @typedef {Object} MedicalRecord
 * @property {string} patientId       - 환자 식별자
 * @property {string} treatmentCode   - ADA 치료 코드
 * @property {string} treatmentName   - 치료명 (한글)
 * @property {string} hospitalName    - 병원명
 * @property {string} hospitalCode    - 병원 코드
 * @property {number} treatmentDate   - 진료 일자 (Unix timestamp)
 * @property {number} claimedAmount   - 진료비 (원화, 참고용)
 * @property {boolean} verified       - 진료 확인 여부
 */

/**
 * @typedef {Object} VerificationResult
 * @property {boolean} approved           - 승인 여부
 * @property {string}  verificationCode   - 결과 코드 (VERIFIED / AMOUNT_EXCEEDED / UNKNOWN_CODE / NO_RECORD / POLICY_INACTIVE)
 * @property {string}  hospitalName       - 병원명
 * @property {string}  message            - 결과 메시지
 * @property {Object}  rawData            - 원본 데이터 (감사 추적용)
 */

module.exports = BaseHospitalProvider;
