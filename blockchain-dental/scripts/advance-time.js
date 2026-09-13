/**
 * advance-time.js
 * Hardhat 블록체인 시간을 강제로 앞당기는 테스트 유틸
 *
 * 실행: node scripts/advance-time.js [초]
 * 예시: node scripts/advance-time.js 600   ← 10분 앞당김
 *       node scripts/advance-time.js        ← 기본 15분
 */

const { ethers } = require("ethers");

const RPC_URL  = "http://127.0.0.1:8545";
const SECONDS  = parseInt(process.argv[2] || "900"); // 기본 15분

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const before = (await provider.getBlock("latest")).timestamp;
  console.log(`현재 블록 시간: ${new Date(before * 1000).toLocaleString("ko-KR")}`);
  console.log(`${SECONDS}초 (${(SECONDS/60).toFixed(1)}분) 앞당기는 중...`);

  // 시간 증가
  await provider.send("evm_increaseTime", [SECONDS]);
  // 블록 하나 채굴 (timestamp 반영)
  await provider.send("evm_mine", []);

  const after = (await provider.getBlock("latest")).timestamp;
  console.log(`변경 후 블록 시간: ${new Date(after * 1000).toLocaleString("ko-KR")}`);
  console.log("✅ 완료 — 워처가 만기를 감지합니다.");
}

main().catch(err => {
  console.error("오류:", err.message);
  process.exit(1);
});
