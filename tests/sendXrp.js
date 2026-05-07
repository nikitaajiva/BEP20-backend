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

    

    const sourceWallet = xrpl.Wallet.fromSeed(sourceSeed);

    const prepared = await client.autofill({
      "TransactionType": "Payment",
      "Account": sourceWallet.address,
      "Amount": xrpl.xrpToDrops(amount), // 10 XRP
      "Destination": destinationAddress
    });
    
    const signed = sourceWallet.sign(prepared);
    

    const tx = await client.submitAndWait(signed.tx_blob);
    

    
    

    await client.disconnect();
  } catch (error) {
    console.error("Error sending XRP:", error);
  }
}

sendXrp(); 
