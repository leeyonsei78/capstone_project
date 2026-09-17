/**
 * test/ReserveFund.test.js
 * ReserveFund.sol 테스트 — 예치/인출/일복리 이자 로직.
 * 통화(USDC/KRW)에 따라 달라지는 로직이 없으므로 USDC(6 decimals) 시나리오
 * 하나로 검증한다 (DentalInsurance.test.js는 두 통화 모두 검증함).
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const DEPOSIT = 1_000_000n; // 1 USDC 단위와 무관한 raw 정수 — 로직 검증용

async function deployReserveFixture() {
  const [owner, patient, patient2] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("MockUSDC");
  const token = await Token.deploy();
  const tokenAddr = await token.getAddress();

  const Reserve = await ethers.getContractFactory("ReserveFund");
  const reserve = await Reserve.deploy(tokenAddr);
  const reserveAddr = await reserve.getAddress();

  // ReserveFund._accrue()가 이자만큼 스스로 faucet()을 호출하므로,
  // MockUSDC.faucet()은 누구나(컨트랙트 자신 포함) 호출 가능해야 정상 동작한다.
  for (const signer of [patient, patient2]) {
    await token.connect(signer).faucet(10_000_000_000n);
  }

  return { owner, patient, patient2, token, tokenAddr, reserve, reserveAddr };
}

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

// ReserveFund._compound()와 동일한 일 단위 복리 계산 (JS 측 기대값 산출용)
function compound(principal, daysElapsed) {
  let p = principal;
  for (let i = 0; i < daysElapsed; i++) {
    p += (p * 500n) / (10000n * 365n);
  }
  return p;
}

describe("ReserveFund", function () {
  let ctx;

  beforeEach(async function () {
    ctx = await deployReserveFixture();
  });

  describe("depositReserve", function () {
    it("최초 예치 시 계좌가 생성되고 원금이 반영된다", async function () {
      await ctx.token.connect(ctx.patient).approve(ctx.reserveAddr, DEPOSIT);
      await expect(ctx.reserve.connect(ctx.patient).depositReserve(DEPOSIT))
        .to.emit(ctx.reserve, "ReserveDeposited")
        .withArgs(ctx.patient.address, DEPOSIT, DEPOSIT, anyValue);
      const acc = await ctx.reserve.getAccount(ctx.patient.address);
      expect(acc.principal).to.equal(DEPOSIT);
      expect(acc.totalDeposited).to.equal(DEPOSIT);
      expect(acc.exists).to.equal(true);
    });

    it("0원 예치는 revert된다", async function () {
      await expect(ctx.reserve.connect(ctx.patient).depositReserve(0))
        .to.be.revertedWith("Amount must be > 0");
    });

    it("여러 번 예치하면 누적된다", async function () {
      await ctx.token.connect(ctx.patient).approve(ctx.reserveAddr, DEPOSIT * 2n);
      await ctx.reserve.connect(ctx.patient).depositReserve(DEPOSIT);
      await ctx.reserve.connect(ctx.patient).depositReserve(DEPOSIT);
      const acc = await ctx.reserve.getAccount(ctx.patient.address);
      expect(acc.totalDeposited).to.equal(DEPOSIT * 2n);
    });

    it("새 예치자는 보유자 목록(getAllHolders)에 추가된다", async function () {
      await ctx.token.connect(ctx.patient).approve(ctx.reserveAddr, DEPOSIT);
      await ctx.reserve.connect(ctx.patient).depositReserve(DEPOSIT);
      const holders = await ctx.reserve.getAllHolders();
      expect(holders).to.include(ctx.patient.address);
    });
  });

  describe("일 복리 이자 적립", function () {
    it("previewBalance가 _compound 공식과 동일하게 계산된다 (10일 경과)", async function () {
      await ctx.token.connect(ctx.patient).approve(ctx.reserveAddr, DEPOSIT);
      await ctx.reserve.connect(ctx.patient).depositReserve(DEPOSIT);

      await increaseTime(10 * 24 * 60 * 60);

      const [projected, pending] = await ctx.reserve.previewBalance(ctx.patient.address);
      const expected = compound(DEPOSIT, 10);
      expect(projected).to.equal(expected);
      expect(pending).to.equal(expected - DEPOSIT);
      expect(projected).to.be.gt(DEPOSIT); // 이자가 실제로 붙었는지 확인
    });

    it("인출 시 경과 이자가 먼저 원금에 반영된 뒤 차감된다", async function () {
      await ctx.token.connect(ctx.patient).approve(ctx.reserveAddr, DEPOSIT);
      await ctx.reserve.connect(ctx.patient).depositReserve(DEPOSIT);
      await increaseTime(5 * 24 * 60 * 60);

      const [projectedBeforeWithdraw] = await ctx.reserve.previewBalance(ctx.patient.address);
      const withdrawAmt = projectedBeforeWithdraw / 2n;

      const balBefore = await ctx.token.balanceOf(ctx.patient.address);
      await ctx.reserve.connect(ctx.patient).withdrawReserve(withdrawAmt);
      const balAfter = await ctx.token.balanceOf(ctx.patient.address);

      expect(balAfter - balBefore).to.equal(withdrawAmt);
      const acc = await ctx.reserve.getAccount(ctx.patient.address);
      expect(acc.principal).to.equal(projectedBeforeWithdraw - withdrawAmt);
      expect(acc.totalInterestEarned).to.be.gt(0n);
    });

    it("시간이 지나지 않으면 이자가 붙지 않는다", async function () {
      await ctx.token.connect(ctx.patient).approve(ctx.reserveAddr, DEPOSIT);
      await ctx.reserve.connect(ctx.patient).depositReserve(DEPOSIT);
      const [projected, pending] = await ctx.reserve.previewBalance(ctx.patient.address);
      expect(projected).to.equal(DEPOSIT);
      expect(pending).to.equal(0n);
    });
  });

  describe("파우셋 1회 상한(10,000 USDC)을 넘는 이자 처리", function () {
    it("오래 방치돼 누적 이자가 파우셋 상한을 넘어도 청크 처리로 revert 없이 정상 적립된다", async function () {
      // MockUSDC.faucet()은 1회 10,000 USDC(=10_000_000_000 raw)가 상한이라
      // 큰 원금 조달 자체도 여러 번에 나눠 받아야 한다.
      const PRINCIPAL = 100_000_000_000n; // 100,000 USDC
      const FAUCET_CAP = 10_000_000_000n;
      let remaining = PRINCIPAL;
      while (remaining > 0n) {
        const take = remaining > FAUCET_CAP ? FAUCET_CAP : remaining;
        await ctx.token.connect(ctx.patient).faucet(take);
        remaining -= take;
      }

      await ctx.token.connect(ctx.patient).approve(ctx.reserveAddr, PRINCIPAL);
      await ctx.reserve.connect(ctx.patient).depositReserve(PRINCIPAL);

      // 3년(1095일) 방치 — 연 5% 복리로 누적 이자가 10,000 USDC 상한을 훌쩍 넘김
      await increaseTime(1095 * 24 * 60 * 60);

      const [projected] = await ctx.reserve.previewBalance(ctx.patient.address);
      const expectedInterest = compound(PRINCIPAL, 1095) - PRINCIPAL;
      expect(expectedInterest).to.be.gt(FAUCET_CAP); // 이 테스트가 실제로 상한을 넘기는 시나리오인지 확인

      // 예전 버그였다면 아래 withdrawReserve 호출(_accrue 트리거)이 파우셋 상한 초과로 revert됐음
      await expect(ctx.reserve.connect(ctx.patient).withdrawReserve(1n)).to.not.be.reverted;

      const acc = await ctx.reserve.getAccount(ctx.patient.address);
      expect(acc.principal).to.equal(compound(PRINCIPAL, 1095) - 1n);
      expect(acc.totalInterestEarned).to.be.gt(FAUCET_CAP);
    });
  });

  describe("withdrawReserve", function () {
    it("계좌가 없으면 revert된다", async function () {
      await expect(ctx.reserve.connect(ctx.patient).withdrawReserve(1n))
        .to.be.revertedWith("No reserve account");
    });

    it("원금을 초과하는 인출은 revert된다", async function () {
      await ctx.token.connect(ctx.patient).approve(ctx.reserveAddr, DEPOSIT);
      await ctx.reserve.connect(ctx.patient).depositReserve(DEPOSIT);
      await expect(ctx.reserve.connect(ctx.patient).withdrawReserve(DEPOSIT + 1n))
        .to.be.revertedWith("Invalid amount");
    });

    it("0원 인출은 revert된다", async function () {
      await ctx.token.connect(ctx.patient).approve(ctx.reserveAddr, DEPOSIT);
      await ctx.reserve.connect(ctx.patient).depositReserve(DEPOSIT);
      await expect(ctx.reserve.connect(ctx.patient).withdrawReserve(0))
        .to.be.revertedWith("Invalid amount");
    });

    it("전액 인출 후 원금은 0이 된다", async function () {
      await ctx.token.connect(ctx.patient).approve(ctx.reserveAddr, DEPOSIT);
      await ctx.reserve.connect(ctx.patient).depositReserve(DEPOSIT);
      await ctx.reserve.connect(ctx.patient).withdrawReserve(DEPOSIT);
      const acc = await ctx.reserve.getAccount(ctx.patient.address);
      expect(acc.principal).to.equal(0n);
      expect(acc.totalWithdrawn).to.equal(DEPOSIT);
    });
  });

  describe("복수 계좌", function () {
    it("서로 다른 계정의 이자는 독립적으로 계산된다", async function () {
      await ctx.token.connect(ctx.patient).approve(ctx.reserveAddr, DEPOSIT);
      await ctx.reserve.connect(ctx.patient).depositReserve(DEPOSIT);
      await increaseTime(3 * 24 * 60 * 60);

      await ctx.token.connect(ctx.patient2).approve(ctx.reserveAddr, DEPOSIT);
      await ctx.reserve.connect(ctx.patient2).depositReserve(DEPOSIT); // patient2는 지금 막 시작

      const [proj1] = await ctx.reserve.previewBalance(ctx.patient.address);
      const [proj2] = await ctx.reserve.previewBalance(ctx.patient2.address);
      expect(proj1).to.be.gt(DEPOSIT);   // patient: 3일치 이자 반영
      expect(proj2).to.equal(DEPOSIT);   // patient2: 방금 예치, 이자 없음
    });
  });
});
