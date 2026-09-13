/**
 * mock-provider.js
 * Mock 병원 진료내역 제공자
 *
 * 실제 HIRA API 연동 전까지 사용하는 테스트용 구현체.
 * hira-provider.js 로 교체 시 동일한 인터페이스를 사용합니다.
 *
 * 검증 규칙:
 *  - 등록된 ADA 코드 → 코드별 최대 허용 금액 범위 내 → VERIFIED
 *  - 등록된 ADA 코드 → 금액 초과                       → AMOUNT_EXCEEDED
 *  - 미등록 ADA 코드                                    → UNKNOWN_CODE
 */

const BaseHospitalProvider = require("./base-provider");

// ── 치료 코드 데이터베이스 (실제 HIRA 수가 기준 참고) ──────────────
const TREATMENT_DB = {
  D0120: { name: "치과 정기검진",       maxUsd: 100,  hospitalName: "서울치과의원",   hospitalCode: "H001" },
  D0150: { name: "포괄 구강검진",       maxUsd: 150,  hospitalName: "강남치과",       hospitalCode: "H002" },
  D0210: { name: "전악 X선 촬영",       maxUsd: 200,  hospitalName: "영상치과",       hospitalCode: "H003" },
  D0330: { name: "파노라마 X선",        maxUsd: 150,  hospitalName: "영상치과",       hospitalCode: "H003" },
  D1110: { name: "성인 스케일링",       maxUsd: 120,  hospitalName: "서울치과의원",   hospitalCode: "H001" },
  D2140: { name: "아말감 충전 (1면)",   maxUsd: 200,  hospitalName: "강남치과",       hospitalCode: "H002" },
  D2150: { name: "아말감 충전 (2면)",   maxUsd: 250,  hospitalName: "강남치과",       hospitalCode: "H002" },
  D2160: { name: "아말감 충전 (3면)",   maxUsd: 300,  hospitalName: "강남치과",       hospitalCode: "H002" },
  D2330: { name: "레진 충전 (1면)",     maxUsd: 200,  hospitalName: "이치과의원",     hospitalCode: "H004" },
  D2740: { name: "도재관 크라운",       maxUsd: 800,  hospitalName: "이치과의원",     hospitalCode: "H004" },
  D2750: { name: "세라믹관 크라운",     maxUsd: 900,  hospitalName: "서울치과의원",   hospitalCode: "H001" },
  D3310: { name: "근관치료 (전치)",     maxUsd: 400,  hospitalName: "강남치과",       hospitalCode: "H002" },
  D3330: { name: "근관치료 (대구치)",   maxUsd: 600,  hospitalName: "강남치과",       hospitalCode: "H002" },
  D4341: { name: "치주 소파술 (1~3치)", maxUsd: 400,  hospitalName: "치주과의원",     hospitalCode: "H005" },
  D4342: { name: "치주 소파술 (4치+)",  maxUsd: 500,  hospitalName: "치주과의원",     hospitalCode: "H005" },
  D6010: { name: "임플란트 수술",       maxUsd: 2000, hospitalName: "임플란트치과",   hospitalCode: "H006" },
  D7140: { name: "단순 발치",           maxUsd: 150,  hospitalName: "이치과의원",     hospitalCode: "H004" },
  D7210: { name: "매복 발치 (부분)",    maxUsd: 400,  hospitalName: "구강악안면외과", hospitalCode: "H007" },
  D7240: { name: "완전 매복 발치",      maxUsd: 600,  hospitalName: "구강악안면외과", hospitalCode: "H007" },
  D8080: { name: "포괄 교정 치료",      maxUsd: 1500, hospitalName: "교정치과",       hospitalCode: "H008" },
  D9110: { name: "치과 응급 처치",      maxUsd: 300,  hospitalName: "응급치과의원",   hospitalCode: "H009" },
  D9930: { name: "치아 교합 조정",      maxUsd: 200,  hospitalName: "서울치과의원",   hospitalCode: "H001" },
  D9940: { name: "교합장치 (나이트가드)", maxUsd: 350, hospitalName: "서울치과의원",  hospitalCode: "H001" },
};

// ── 응답 지연 시뮬레이션 (실제 API 호출 모사) ────────────────────
const MOCK_LATENCY_MS = 800;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class MockHospitalProvider extends BaseHospitalProvider {

  constructor() {
    super();
    console.log("[MockProvider] 초기화 완료 — Mock 병원 데이터 사용 중");
    console.log("[MockProvider] 실제 HIRA API로 교체하려면 HOSPITAL_PROVIDER=hira 설정");
  }

  /**
   * 진료내역 조회 (Mock)
   */
  async getMedicalRecord(patientAddress, treatmentCode, claimDate) {
    await sleep(MOCK_LATENCY_MS);

    const treatment = TREATMENT_DB[treatmentCode];
    if (!treatment) return null;

    return {
      patientId:     patientAddress,
      treatmentCode,
      treatmentName: treatment.name,
      hospitalName:  treatment.hospitalName,
      hospitalCode:  treatment.hospitalCode,
      treatmentDate: claimDate || Math.floor(Date.now() / 1000),
      claimedAmount: treatment.maxUsd * 1300, // 원화 환산 (참고용)
      verified:      true,
    };
  }

  /**
   * 청구 금액 적정성 검증 (Mock)
   * @param {string} treatmentCode
   * @param {bigint|number} requestedAmount - 토큰 단위 금액
   * @param {number} decimals - 토큰 소수점 자리수 (USDC=6, KRW=0)
   */
  async verifyClaimAmount(treatmentCode, requestedAmount, decimals = 6) {
    await sleep(MOCK_LATENCY_MS);

    const treatment = TREATMENT_DB[treatmentCode];

    // ① 미등록 코드
    if (!treatment) {
      return {
        approved:         false,
        verificationCode: "UNKNOWN_CODE",
        hospitalName:     "",
        message:          `미등록 치료 코드: ${treatmentCode}`,
        rawData:          { treatmentCode, requestedAmount },
      };
    }

    // 통화별 허용 한도 계산
    const KRW_PER_USD  = 1400;
    const divisor      = Math.pow(10, decimals);
    const requestedVal = Number(requestedAmount) / divisor;
    const maxVal       = decimals === 0
      ? treatment.maxUsd * KRW_PER_USD  // KRW 한도 (원)
      : treatment.maxUsd;               // USD 한도 ($)
    const symbol       = decimals === 0 ? "₩" : "$";
    const formatVal    = (v) => decimals === 0
      ? `${symbol}${Math.round(v).toLocaleString("ko-KR")}`
      : `${symbol}${v.toFixed(2)}`;

    // ② 금액 초과
    if (requestedVal > maxVal) {
      return {
        approved:         false,
        verificationCode: "AMOUNT_EXCEEDED",
        hospitalName:     treatment.hospitalName,
        message:          `청구 금액 초과: ${formatVal(requestedVal)} > 허용 한도 ${formatVal(maxVal)}`,
        rawData:          { treatmentCode, requestedAmount, maxAllowed: maxVal, currency: decimals === 0 ? "KRW" : "USDC", hospitalName: treatment.hospitalName },
      };
    }

    // ③ 승인
    return {
      approved:         true,
      verificationCode: "VERIFIED",
      hospitalName:     treatment.hospitalName,
      message:          `${treatment.name} — ${treatment.hospitalName} 진료 확인 (${formatVal(requestedVal)})`,
      rawData:          { treatmentCode, treatmentName: treatment.name, requestedAmount, currency: decimals === 0 ? "KRW" : "USDC", hospitalName: treatment.hospitalName, hospitalCode: treatment.hospitalCode },
    };
  }

  async healthCheck() {
    return { ok: true, message: "Mock provider is running" };
  }
}

module.exports = MockHospitalProvider;
