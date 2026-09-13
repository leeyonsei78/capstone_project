require("@nomicfoundation/hardhat-ethers");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 1 },
      viaIR: true
    }
  },
  networks: {
    hardhat: {
      // 트랜잭션이 없어도 block.timestamp가 실제 시간을 따라 계속 전진하도록 함.
      // 이게 없으면 아무 거래도 없을 때 시간이 멈춰서, 만기환급/자동납부 워처가
      // 실제로는 기한이 지났는데도 이를 감지하지 못하는 문제가 있었음.
      mining: { auto: true, interval: 4000 }
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 11155111
    }
  },
  paths: {
    sources: "./contracts",
    scripts: "./scripts",
    artifacts: "./artifacts"
  }
};
