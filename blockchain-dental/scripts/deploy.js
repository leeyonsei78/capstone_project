const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("  덴탈보험 블록체인 시스템 배포 (USDC + KRW)");
  console.log("=".repeat(60));
  console.log(`  네트워크  : ${network.name} (chainId: ${network.chainId})`);
  console.log(`  배포자    : ${deployer.address}`);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`  잔액      : ${ethers.formatEther(bal)} ETH`);
  console.log("-".repeat(60));

  const accounts = await ethers.getSigners();

  // ─────────────────────────────────────────────────────────────
  // ── USDC 시스템 ─────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────

  // 1. MockUSDC 배포
  console.log("\n[1/8] MockUSDC 배포 중...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`  ✅ MockUSDC 배포 완료: ${usdcAddress}`);

  // 2. DentalInsurance(USDC) 배포
  console.log("\n[2/8] DentalInsurance(USDC) 배포 중...");
  const DentalInsurance = await ethers.getContractFactory("DentalInsurance");
  const insurance = await DentalInsurance.deploy(usdcAddress);
  await insurance.waitForDeployment();
  const insuranceAddress = await insurance.getAddress();
  console.log(`  ✅ DentalInsurance(USDC) 배포 완료: ${insuranceAddress}`);

  // 3. USDC 준비금 입금 (50,000 USDC) + 관리자 시작 잔액(1,000 USDC — 다른 계정과 동일)
  console.log("\n[3/8] USDC 준비금 입금 중... (50,000 USDC)");
  const usdcReserve = ethers.parseUnits("50000", 6);
  const adminStartBalance = ethers.parseUnits("1000", 6);
  let tx = await usdc.mint(deployer.address, usdcReserve + adminStartBalance);
  await tx.wait();
  tx = await usdc.approve(insuranceAddress, usdcReserve);
  await tx.wait();
  tx = await insurance.depositFunds(usdcReserve);
  await tx.wait();
  console.log(`  ✅ USDC 준비금 입금 완료: 50,000 USDC (관리자 잔액 1,000 USDC로 시작)`);

  // 4. USDC 샘플 보험증권
  console.log("\n[4/8] USDC 샘플 보험증권 생성 중...");
  const latestBlock = await ethers.provider.getBlock("latest");
  const now = Number(latestBlock.timestamp);
  const maturityIn30Min = now + 30 * 60;
  const maturityIn45Min = now + 45 * 60;
  const refundRate = 70;

  // 계정 #1 - 김덴탈 (월 50 USDC)
  if (accounts.length > 1) {
    tx = await insurance.createPolicy(
      accounts[1].address, "김덴탈",
      ethers.parseUnits("50", 6), ethers.parseUnits("1000", 6),
      maturityIn30Min, refundRate
    );
    await tx.wait();
    await usdc.connect(accounts[1]).faucet(ethers.parseUnits("1000", 6));
    console.log(`  ✅ USDC 증권 #1: 김덴탈 | 월 $50 | 한도 $1,000 | 1,000 USDC 지급`);
  }

  // 계정 #2 - 이치과 (월 80 USDC)
  if (accounts.length > 2) {
    tx = await insurance.createPolicy(
      accounts[2].address, "이치과",
      ethers.parseUnits("80", 6), ethers.parseUnits("2000", 6),
      maturityIn45Min, refundRate
    );
    await tx.wait();
    await usdc.connect(accounts[2]).faucet(ethers.parseUnits("1000", 6));
    console.log(`  ✅ USDC 증권 #2: 이치과 | 월 $80 | 한도 $2,000 | 1,000 USDC 지급`);
  }

  // ─────────────────────────────────────────────────────────────
  // ── KRW 시스템 ──────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────

  // 5. MockKRW 배포
  console.log("\n[5/8] MockKRW 배포 중...");
  const MockKRW = await ethers.getContractFactory("MockKRW");
  const krw = await MockKRW.deploy();
  await krw.waitForDeployment();
  const krwAddress = await krw.getAddress();
  console.log(`  ✅ MockKRW 배포 완료: ${krwAddress}`);

  // 6. DentalInsurance(KRW) 배포
  console.log("\n[6/8] DentalInsurance(KRW) 배포 중...");
  const insuranceKrw = await DentalInsurance.deploy(krwAddress);
  await insuranceKrw.waitForDeployment();
  const insuranceKrwAddress = await insuranceKrw.getAddress();
  console.log(`  ✅ DentalInsurance(KRW) 배포 완료: ${insuranceKrwAddress}`);

  // KRW 심사 룰 조정 (최소 보험료: 10,000 KRW)
  // setUnderwritingRules(minAge, maxAge, maxCoverageRatio, minMonthlyPremium, maxActivePolicies)
  tx = await insuranceKrw.setUnderwritingRules(18, 75, 100, 10000, 3);
  await tx.wait();
  console.log(`  ✅ KRW 심사 룰 설정 완료: 최소 보험료 10,000원`);

  // KRW 준비금 입금 (10,000,000원) + 관리자 시작 잔액(1,000,000원 — 다른 계정과 동일)
  const krwReserve = BigInt("10000000"); // 1천만원 (0 decimals)
  const krwAdminStartBalance = BigInt("1000000"); // 100만원
  // 배포자에게 준비금 + 시작잔액만큼 먼저 KRW 민팅
  tx = await krw.faucet(krwReserve + krwAdminStartBalance);
  await tx.wait();
  tx = await krw.approve(insuranceKrwAddress, krwReserve);
  await tx.wait();
  tx = await insuranceKrw.depositFunds(krwReserve);
  await tx.wait();
  console.log(`  ✅ KRW 준비금 입금 완료: 10,000,000 KRW (관리자 잔액 1,000,000 KRW로 시작)`);

  // KRW 샘플 보험증권
  const krwMaturity30 = now + 30 * 60;
  const krwMaturity45 = now + 45 * 60;

  // 계정 #1 - 김덴탈 (월 70,000원)
  if (accounts.length > 1) {
    tx = await insuranceKrw.createPolicy(
      accounts[1].address, "김덴탈",
      BigInt("70000"),    // 월 70,000원
      BigInt("1400000"),  // 보장한도 140만원
      krwMaturity30, refundRate
    );
    await tx.wait();
    await krw.connect(accounts[1]).faucet(BigInt("1000000")); // 100만원
    console.log(`  ✅ KRW 증권 #1: 김덴탈 | 월 ₩70,000 | 한도 ₩1,400,000 | 100만원 지급`);
  }

  // 계정 #2 - 이치과 (월 112,000원)
  if (accounts.length > 2) {
    tx = await insuranceKrw.createPolicy(
      accounts[2].address, "이치과",
      BigInt("112000"),   // 월 112,000원
      BigInt("2800000"),  // 보장한도 280만원
      krwMaturity45, refundRate
    );
    await tx.wait();
    await krw.connect(accounts[2]).faucet(BigInt("1000000")); // 100만원
    console.log(`  ✅ KRW 증권 #2: 이치과 | 월 ₩112,000 | 한도 ₩2,800,000 | 100만원 지급`);
  }

  // ── 샘플 청약 신청 (USDC 계약 기준) ─────────────────────────
  console.log("\n[7/8] 샘플 청약 신청 중... (자동심사 테스트용)");

  if (accounts.length > 4) {
    await usdc.connect(accounts[4]).faucet(ethers.parseUnits("1000", 6));
    // 비율 500/60 ≈ 8.3배 (10배 이하) → 즉시 자동승인
    tx = await insurance.connect(accounts[4]).submitApplication(
      "박청약", 35, ethers.parseUnits("60", 6), ethers.parseUnits("500", 6), 365, 70
    );
    await tx.wait();
    console.log(`  ✅ 청약 #1: 박청약 (35세) — 비율 8.3배(10배 이하), 즉시 자동승인 및 증권 생성 | ${accounts[4].address}`);
  }

  if (accounts.length > 5) {
    await usdc.connect(accounts[5]).faucet(ethers.parseUnits("1000", 6));
    // 비율 2000/40 = 50배 (10~100배 사이) → 관리자 심사 대기
    tx = await insurance.connect(accounts[5]).submitApplication(
      "최이십", 20, ethers.parseUnits("40", 6), ethers.parseUnits("2000", 6), 180, 60
    );
    await tx.wait();
    console.log(`  ✅ 청약 #2: 최이십 (20세) — 비율 50배(10~100배), 관리자 심사 대기중 | ${accounts[5].address}`);
  }

  if (accounts.length > 6) {
    tx = await insurance.connect(accounts[6]).submitApplication(
      "노거절", 80, ethers.parseUnits("50", 6), ethers.parseUnits("1000", 6), 365, 70
    );
    await tx.wait();
    console.log(`  ✅ 청약 #3: 노거절 (80세) — 자동 심사 거절 (연령 초과)`);
  }

  // ── Oracle 설정 (USDC + KRW 양쪽) ───────────────────────────
  console.log("\n[8/8] Oracle 설정 중...");
  const ORACLE_ADDRESS = accounts.length > 3
    ? accounts[3].address
    : "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

  // USDC 컨트랙트 Oracle (주소는 등록하되, 모드는 기본 OFF —
  // 20% 초과 청구는 기본적으로 관리자 수동 심사를 거치도록 함.
  // 필요 시 관리자 패널에서 오라클 모드를 ON으로 켤 수 있음)
  tx = await insurance.setOracleAddress(ORACLE_ADDRESS);
  await tx.wait();

  // KRW 컨트랙트 Oracle
  tx = await insuranceKrw.setOracleAddress(ORACLE_ADDRESS);
  await tx.wait();

  console.log(`  ✅ Oracle 주소 등록  : ${ORACLE_ADDRESS}`);
  console.log(`  ✅ Oracle 모드       : USDC + KRW 양쪽 비활성화 (기본값 — 20% 초과 청구는 관리자 수동 심사)`);

  // ── 준비금 계좌(ReserveFund) 시스템 배포 (USDC + KRW) ────────
  console.log("\n[9/9] ReserveFund(준비금 계좌) 배포 중...");
  const ReserveFund = await ethers.getContractFactory("ReserveFund");
  const reserveFund = await ReserveFund.deploy(usdcAddress);
  await reserveFund.waitForDeployment();
  const reserveFundAddress = await reserveFund.getAddress();
  const reserveFundKrw = await ReserveFund.deploy(krwAddress);
  await reserveFundKrw.waitForDeployment();
  const reserveFundKrwAddress = await reserveFundKrw.getAddress();
  console.log(`  ✅ ReserveFund(USDC) 배포 완료: ${reserveFundAddress}`);
  console.log(`  ✅ ReserveFund(KRW)  배포 완료: ${reserveFundKrwAddress}`);

  // ── 준비금 계좌 초기 세팅 (내 잔액 == 준비금 잔액이 되도록 별도로 추가 지급 후 예치) ──
  async function seedReserve(token, reserveContract, account, amount) {
    await (await token.connect(account).faucet(amount)).wait();
    await (await token.connect(account).approve(await reserveContract.getAddress(), amount)).wait();
    await (await reserveContract.connect(account).depositReserve(amount)).wait();
  }

  if (accounts.length > 1) {
    await seedReserve(usdc, reserveFund,    accounts[1], ethers.parseUnits("1000", 6));
    await seedReserve(krw,  reserveFundKrw, accounts[1], BigInt("1000000"));
  }
  if (accounts.length > 2) {
    await seedReserve(usdc, reserveFund,    accounts[2], ethers.parseUnits("1000", 6));
    await seedReserve(krw,  reserveFundKrw, accounts[2], BigInt("1000000"));
  }
  if (accounts.length > 4) {
    await seedReserve(usdc, reserveFund, accounts[4], ethers.parseUnits("1000", 6));
  }
  if (accounts.length > 5) {
    await seedReserve(usdc, reserveFund, accounts[5], ethers.parseUnits("1000", 6));
  }
  console.log(`  ✅ 준비금 계좌 초기 세팅 완료: 김덴탈/이치과 (USDC 1,000 + KRW 100만원), 박청약/최이십 (USDC 1,000) — 내 잔액과 동일하게 맞춤`);

  // ── 배포 정보 저장 ────────────────────────────────────────────
  const config = {
    network:         network.name,
    chainId:         network.chainId.toString(),
    deployer:        deployer.address,
    deployedAt:      new Date().toISOString(),
    oracleAddress:   ORACLE_ADDRESS,
    contracts: {
      MockUSDC:              usdcAddress,
      DentalInsurance:       insuranceAddress,
      MockKRW:               krwAddress,
      DentalInsuranceKRW:    insuranceKrwAddress,
      ReserveFund:           reserveFundAddress,
      ReserveFundKRW:        reserveFundKrwAddress
    }
  };

  const frontendDir = path.join(__dirname, "..", "frontend");
  if (!fs.existsSync(frontendDir)) fs.mkdirSync(frontendDir, { recursive: true });
  fs.writeFileSync(
    path.join(frontendDir, "config.json"),
    JSON.stringify(config, null, 2)
  );

  console.log("\n" + "=".repeat(60));
  console.log("  배포 완료!");
  console.log("=".repeat(60));
  console.log(`  [USDC 시스템]`);
  console.log(`    MockUSDC           : ${usdcAddress}`);
  console.log(`    DentalInsurance    : ${insuranceAddress}`);
  console.log(`  [KRW 시스템]`);
  console.log(`    MockKRW            : ${krwAddress}`);
  console.log(`    DentalInsuranceKRW : ${insuranceKrwAddress}`);
  console.log(`  Oracle 주소          : ${ORACLE_ADDRESS}`);
  console.log(`  [준비금 계좌]`);
  console.log(`    ReserveFund        : ${reserveFundAddress}`);
  console.log(`    ReserveFundKRW     : ${reserveFundKrwAddress}`);
  console.log(`  config.json 저장     : frontend/config.json`);
  console.log("\n  ▶ 웹 UI: http://localhost:3000");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("배포 실패:", error);
    process.exit(1);
  });
