// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @dev 테스트용 스테이블코인 (USDC 모방, 6자리 소수점)
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private constant DECIMALS = 6;
    uint256 public constant MAX_FAUCET_AMOUNT = 10_000 * 10**6; // 10,000 USDC

    event FaucetUsed(address indexed user, uint256 amount);

    constructor() ERC20("Mock USD Coin", "USDC") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /**
     * @dev 관리자 전용 민팅
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev 테스트용 파우셋 - 누구나 최대 10,000 USDC 수령 가능
     */
    function faucet(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(amount <= MAX_FAUCET_AMOUNT, "Max 10,000 USDC per faucet");
        _mint(msg.sender, amount);
        emit FaucetUsed(msg.sender, amount);
    }
}
