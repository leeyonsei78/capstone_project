// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @dev MockUSDC/MockKRW의 테스트 전용 파우셋 — 이자만큼 실제 토큰을 발행해
 *      준비금 계좌 잔액이 항상 실제 토큰 보유량으로 뒷받침되도록 한다.
 */
interface IFaucetToken {
    function faucet(uint256 amount) external;
}

/**
 * @title ReserveFund
 * @dev 고객이 보험사에 송금해 쌓는 준비금 계좌. 연 5%를 매일 복리로 적립한다.
 */
contract ReserveFund is Ownable, ReentrancyGuard {
    IERC20 public immutable stablecoin;

    uint256 public constant ANNUAL_RATE_BPS = 500;   // 연 5%
    uint256 public constant BPS_DENOM       = 10000;
    uint256 public constant DAYS_PER_YEAR   = 365;

    struct Account {
        uint256 principal;
        uint256 lastAccrualTime;
        uint256 totalDeposited;
        uint256 totalWithdrawn;
        uint256 totalInterestEarned;
        bool    exists;
    }

    mapping(address => Account) public accounts;
    address[] private _holders;

    event ReserveDeposited(address indexed patient, uint256 amount, uint256 newPrincipal, uint256 timestamp);
    event ReserveWithdrawn(address indexed patient, uint256 amount, uint256 newPrincipal, uint256 timestamp);
    event InterestAccrued(address indexed patient, uint256 interestAmount, uint256 newPrincipal, uint256 timestamp);

    constructor(address _stablecoin) Ownable(msg.sender) {
        require(_stablecoin != address(0), "Invalid stablecoin address");
        stablecoin = IERC20(_stablecoin);
    }

    /**
     * @dev 연 5%를 매일 복리로 적용한 원금을 계산한다 (일 단위 반복 계산).
     */
    function _compound(uint256 principal, uint256 daysElapsed) internal pure returns (uint256) {
        for (uint256 i = 0; i < daysElapsed; i++) {
            principal += (principal * ANNUAL_RATE_BPS) / (BPS_DENOM * DAYS_PER_YEAR);
        }
        return principal;
    }

    /**
     * @dev 경과일만큼 이자를 실제로 원금에 반영(확정)한다.
     */
    function _accrue(address patient) internal {
        Account storage acc = accounts[patient];
        if (!acc.exists) return;
        uint256 daysElapsed = (block.timestamp - acc.lastAccrualTime) / 1 days;
        if (daysElapsed == 0) return;

        uint256 newPrincipal = _compound(acc.principal, daysElapsed);
        uint256 interest     = newPrincipal - acc.principal;
        if (interest > 0) {
            acc.principal            = newPrincipal;
            acc.totalInterestEarned += interest;
            // 이자만큼 실제 토큰을 발행해 인출 시 잔액이 항상 뒷받침되도록 함
            IFaucetToken(address(stablecoin)).faucet(interest);
            emit InterestAccrued(patient, interest, newPrincipal, block.timestamp);
        }
        acc.lastAccrualTime += daysElapsed * 1 days;
    }

    /**
     * @dev 보험사 준비금 계좌로 송금 (준비금 적립)
     */
    function depositReserve(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        Account storage acc = accounts[msg.sender];
        if (!acc.exists) {
            acc.exists          = true;
            acc.lastAccrualTime = block.timestamp;
            _holders.push(msg.sender);
        } else {
            _accrue(msg.sender);
        }
        require(stablecoin.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        acc.principal      += amount;
        acc.totalDeposited += amount;
        emit ReserveDeposited(msg.sender, amount, acc.principal, block.timestamp);
    }

    /**
     * @dev 준비금 인출. 인출 전 경과 이자를 먼저 원금에 반영한 뒤 인출한다.
     */
    function withdrawReserve(uint256 amount) external nonReentrant {
        Account storage acc = accounts[msg.sender];
        require(acc.exists, "No reserve account");
        _accrue(msg.sender);
        require(amount > 0 && amount <= acc.principal, "Invalid amount");
        acc.principal      -= amount;
        acc.totalWithdrawn += amount;
        require(stablecoin.transfer(msg.sender, amount), "Transfer failed");
        emit ReserveWithdrawn(msg.sender, amount, acc.principal, block.timestamp);
    }

    /**
     * @dev 미확정 이자까지 포함한 현재 예상 잔액 조회 (상태 변경 없음)
     */
    function previewBalance(address patient) external view returns (uint256 projectedPrincipal, uint256 pendingInterest) {
        Account memory acc = accounts[patient];
        if (!acc.exists) return (0, 0);
        uint256 daysElapsed = (block.timestamp - acc.lastAccrualTime) / 1 days;
        projectedPrincipal = _compound(acc.principal, daysElapsed);
        pendingInterest     = projectedPrincipal - acc.principal;
    }

    function getAccount(address patient) external view returns (Account memory) {
        return accounts[patient];
    }

    function getAllHolders() external view returns (address[] memory) {
        return _holders;
    }

    function getContractBalance() external view returns (uint256) {
        return stablecoin.balanceOf(address(this));
    }
}
