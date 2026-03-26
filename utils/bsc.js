const { ethers } = require("ethers");

const BSC_CHAIN_ID = 56;
const RPC_URL = process.env.BSC_MAINNET_RPC_URL;
const USDT_CONTRACT_ADDRESS = process.env.USDT_CONTRACT_ADDRESS_MAINNET;
const BSC_CONFIRMATIONS = Number(process.env.BSC_CONFIRMATIONS || "3");

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

function getProvider() {
  if (!RPC_URL) {
    throw new Error("BSC RPC URL is not configured");
  }
  return new ethers.JsonRpcProvider(RPC_URL);
}

async function assertMainnet(provider) {
  const resolved = provider || getProvider();
  const network = await resolved.getNetwork();
  if (Number(network.chainId) !== BSC_CHAIN_ID) {
    throw new Error(`Invalid chainId ${network.chainId}. BSC mainnet required.`);
  }
}

function getUsdtContract(signerOrProvider) {
  if (!USDT_CONTRACT_ADDRESS) {
    throw new Error("USDT contract address is not configured");
  }
  const provider = signerOrProvider || getProvider();
  return new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, provider);
}

function normalizeAddress(address) {
  if (!address) return "";
  return ethers.getAddress(address);
}

module.exports = {
  BSC_CHAIN_ID,
  BSC_CONFIRMATIONS,
  ERC20_ABI,
  getProvider,
  assertMainnet,
  getUsdtContract,
  normalizeAddress,
};
