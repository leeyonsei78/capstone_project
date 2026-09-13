/**
 * hira-provider.js
 * 건강보험심사평가원(HIRA) API 연동 제공자
 *
 * ─── 실제 연동 준비 방법 ──────────────────────────────────────────
 *  1. HIRA 개발자 포털 가입: https://www.hira.or.kr/dev
 *  2. API 키 발급 신청 (심사 후 발급, 수일 소요)
 *  3. .env 파일에 아래 항목 추가:
 *       HOSPITAL_PROVIDER=hira
 *       HIRA_API_KEY=발급받은_API_키
 *       HIRA_API_URL=https://apis.data.go.kr/B551182  (기본값)
 *  4. npm install axios  (HTTP 클라이언트 추가)
 *  5. oracle-service.js 재시작
 *
 * ─── HIRA 주요 API 엔드포인트 ────────────────────────────────────
 *  진료비 청구 내역:  /getDtlList01    (입원/외래/약국)
 *  요양기관 정보:     /getHospBasisList (병원 기본 정보)
 *  진료 코드 조회:    /getMedDtlList   (치료 행위 코드)
 *
 * ─── 현재 상태 ────────────────────────────────────────────────────
 *  API 키 미설정 시 NotImplementedError 발생.
 *  mock-provider.js 를 계속 사용하세요.
 */

const BaseHospitalProvider = require("./base-provider");

// ADA 코드 → HIRA 행위 코드 매핑 테이블 (일부)
// 실제 연동 시 HIRA 코드 체계에 맞게 확장 필요
const ADA_TO_HIRA_CODE = {
  D0120: "BC111",  // 구강검진
  D0330: "F4200",  // 파노라마 촬영
  D1110: "BC131",  // 치석 제거 (스케일링)
  D2140: "BD101",  // 광중합형 복합 레진 충전
  D2750: "BF151",  // 세라믹 크라운
  D3310: "BE111",  // 근관치료
  D4341: "BC221",  // 치주 치료
  D7140: "BG111",  // 발치
  D7240: "BG131",  // 매복 발치
  D9110: "BA111",  // 응급 처치
};

class HIRAProvider extends BaseHospitalProvider {

  constructor() {
    super();
    this.apiKey  = process.env.HIRA_API_KEY;
    this.baseUrl = process.env.HIRA_API_URL || "https://apis.data.go.kr/B551182";

    if (!this.apiKey) {
      console.warn("[HIRAProvider] ⚠️  HIRA_API_KEY 미설정 — .env에 HIRA_API_KEY를 추가하세요.");
    } else {
      console.log("[HIRAProvider] ✅ HIRA API 초기화 완료");
      console.log(`[HIRAProvider]    Base URL : ${this.baseUrl}`);
    }
  }

  /**
   * 진료내역 조회 (HIRA API)
   * TODO: 실제 API 엔드포인트와 파라미터 구조에 맞게 수정 필요
   */
  async getMedicalRecord(patientAddress, treatmentCode, claimDate) {
    this._requireApiKey();

    const hiraCode = ADA_TO_HIRA_CODE[treatmentCode];

    // --- 실제 구현 예시 (axios 사용) ---
    // const axios = require("axios");
    // const response = await axios.get(`${this.baseUrl}/getDtlList01`, {
    //   params: {
    //     serviceKey: this.apiKey,
    //     pageNo:     1,
    //     numOfRows:  10,
    //     yadmCd:     hiraCode,
    //     inqDt:      this._formatDate(claimDate),
    //   }
    // });
    // const item = response.data?.response?.body?.items?.item?.[0];
    // if (!item) return null;
    // return {
    //   patientId:     patientAddress,
    //   treatmentCode,
    //   treatmentName: item.clCdNm,
    //   hospitalName:  item.yadmNm,
    //   hospitalCode:  item.yadmCd,
    //   treatmentDate: claimDate,
    //   claimedAmount: Number(item.mdexptYnd),
    //   verified:      true,
    // };

    throw new Error("HIRAProvider.getMedicalRecord() — 실제 구현 필요 (주석 참고)");
  }

  /**
   * 청구 금액 적정성 검증 (HIRA 수가 기준)
   * TODO: HIRA 수가 API 연동 후 구현
   */
  async verifyClaimAmount(treatmentCode, requestedAmount) {
    this._requireApiKey();

    // --- 실제 구현 예시 ---
    // 1. HIRA 수가 API로 treatmentCode의 기준 수가 조회
    // 2. requestedAmount와 비교하여 승인/거절 결정
    // 3. 결과 반환

    throw new Error("HIRAProvider.verifyClaimAmount() — 실제 구현 필요 (주석 참고)");
  }

  async healthCheck() {
    if (!this.apiKey) {
      return { ok: false, message: "HIRA_API_KEY not configured" };
    }
    // TODO: HIRA API 서버 상태 확인 엔드포인트 호출
    return { ok: false, message: "HIRAProvider health check not implemented yet" };
  }

  // ── Private ──────────────────────────────────────────────────

  _requireApiKey() {
    if (!this.apiKey) {
      throw new Error("HIRA_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.");
    }
  }

  _formatDate(timestamp) {
    const d = new Date(timestamp * 1000);
    return d.toISOString().slice(0, 10).replace(/-/g, "");  // YYYYMMDD
  }
}

module.exports = HIRAProvider;
