// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockKRW
 * @dev 테스트용 원화 스테이블코인
 *      소수점 없음: 1 토큰 = 1 원 (KRW)
 */
contract MockKRW is ERC20 {
    constructor() ERC20("Mock Korean Won", "KRW") {}

    /// @dev 소수점 없음 (1 KRW = 1 token unit)
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /// @dev 테스트용 무료 수령 (1인당 제한 없음 — 테스트 전용)
    function faucet(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}
