/**
 * hospital-provider/index.js
 * 병원 데이터 제공자 팩토리
 *
 * 환경 변수 HOSPITAL_PROVIDER 에 따라 구현체 자동 선택:
 *   HOSPITAL_PROVIDER=mock  (기본값) → MockHospitalProvider
 *   HOSPITAL_PROVIDER=hira           → HIRAProvider
 *
 * 사용 예:
 *   const provider = require("./hospital-provider");
 *   const result = await provider.verifyClaimAmount("D0120", 50_000000n);
 */

require("dotenv").config();

const MockHospitalProvider = require("./mock-provider");
const HIRAProvider          = require("./hira-provider");

function createProvider() {
  const providerType = (process.env.HOSPITAL_PROVIDER || "mock").toLowerCase();

  switch (providerType) {
    case "hira":
      console.log("[HospitalProvider] 🏥 HIRA API 제공자 선택");
      return new HIRAProvider();

    case "mock":
    default:
      console.log("[HospitalProvider] 🧪 Mock 제공자 선택 (테스트 모드)");
      return new MockHospitalProvider();
  }
}

module.exports = createProvider();
