const { ethers } = require("ethers");
const {
  BSC_CONFIRMATIONS,
  assertMainnet,
  getProvider,
  getUsdtContract,
  normalizeAddress,
} = require("./bsc");

const HOT_WALLET_PRIVATE_KEY = process.env.BSC_HOT_WALLET_PRIVATE_KEY;

function getSigner() {
  if (!HOT_WALLET_PRIVATE_KEY) {
    throw new Error("BSC hot wallet private key is not configured");
  }
  const provider = getProvider();
  return new ethers.Wallet(HOT_WALLET_PRIVATE_KEY, provider);
}

async function sendUsdt({ destination, amount, memo }) {
  if (!destination) throw new Error("Destination address missing");
  if (!amount || Number(amount) <= 0) throw new Error("Invalid USDT amount");

  const signer = getSigner();
  await assertMainnet(signer.provider);
  const usdt = getUsdtContract(signer);
  const decimals = await usdt.decimals();

  const to = normalizeAddress(destination);
  const value = ethers.parseUnits(amount.toString(), decimals);

  const tx = await usdt.transfer(to, value, {
    // Placeholder for gas overrides if needed later.
  });

  const receipt = await tx.wait(BSC_CONFIRMATIONS);
  if (!receipt || receipt.status !== 1) {
    throw new Error("USDT transfer failed or reverted");
  }

  return {
    success: true,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    confirmations: receipt.confirmations,
    memo,
  };
}

module.exports = {
  sendUsdt,
  debitEcosystem: async (amount, uniqueTransactionId) => {
    const destination = process.env.BSC_ECOSYSTEM_WALLET_ADDRESS;
    if (!destination) {
      throw new Error("BSC ecosystem wallet address is not configured");
    }
    return sendUsdt({ destination, amount, memo: uniqueTransactionId });
  },
};
