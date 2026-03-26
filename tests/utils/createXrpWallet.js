const xrpl = require('xrpl');

async function createTestWallet() {
  try {
    // Connect to testnet
    const client = new xrpl.Client('wss://neat-responsive-energy.xrp-mainnet.quiknode.pro/45f3ff38aac25053f6b316235305d0cefacb68e7');
    await client.connect();

    // Create a wallet
    const fund_result = await client.fundWallet();
    const test_wallet = fund_result.wallet;

    console.log("\nCreated test wallet!");
    console.log("===============================");
    console.log("Classic Address:", test_wallet.classicAddress);
    console.log("Seed:", test_wallet.seed);
    console.log("Public Key:", test_wallet.publicKey);
    console.log("Private Key:", test_wallet.privateKey);
    console.log("===============================\n");

    // Get the balance
    const balance = await client.getXrpBalance(test_wallet.address);
    console.log("Balance:", balance, "XRP");

    await client.disconnect();
    return test_wallet;

  } catch (error) {
    console.error("Error creating test wallet:", error);
    throw error;
  }
}

// Execute if run directly
if (require.main === module) {
  createTestWallet()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  createTestWallet
}; 