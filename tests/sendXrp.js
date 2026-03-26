const xrpl = require('xrpl');
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

async function sendXrp() {
  try {
    let sourceAddress, destinationAddress, amount, sourceSeed;

    await new Promise((resolve) => {
        readline.question('Enter the source wallet address: ', (addr) => {
            sourceAddress = addr;
            resolve();
        });
    });
    
    await new Promise((resolve) => {
        readline.question('Enter the destination wallet address: ', (addr) => {
            destinationAddress = addr;
            resolve();
        });
    });

    await new Promise((resolve) => {
        readline.question('Enter amount: ', (result) => {
            amount = result;
            readline.close();
            resolve();
        });
    });

    await new Promise((resolve) => {
        readline.question('Enter the source wallet seed: ', (seed) => {
            sourceSeed = seed;
            readline.close();
            resolve();
        });
    });
    const client = new xrpl.Client('wss://xrplcluster.com/');
    await client.connect();

    console.log("\nConnected to mainnet");

    const sourceWallet = xrpl.Wallet.fromSeed(sourceSeed);

    const prepared = await client.autofill({
      "TransactionType": "Payment",
      "Account": sourceWallet.address,
      "Amount": xrpl.xrpToDrops(amount), // 10 XRP
      "Destination": destinationAddress
    });
    
    const signed = sourceWallet.sign(prepared);
    console.log("Signing transaction...");

    const tx = await client.submitAndWait(signed.tx_blob);
    console.log("Transaction sent!");

    console.log("\nTransaction result:", tx.result.meta.TransactionResult);
    console.log("Balance changes:", JSON.stringify(xrpl.getBalanceChanges(tx.result.meta), null, 2));

    await client.disconnect();
  } catch (error) {
    console.error("Error sending XRP:", error);
  }
}

sendXrp(); 