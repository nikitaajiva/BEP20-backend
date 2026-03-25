const xrpl = require('xrpl');
const fs = require('fs');
const path = require('path');

function generateAndSaveWallet() {
  try {
    const newWallet = xrpl.Wallet.generate();

    console.log("New wallet created locally:");
    console.log("Address:", newWallet.classicAddress);
    console.log("Seed:", newWallet.seed);

    const filePath = path.join(__dirname, 'data');
    const content = `${newWallet.classicAddress}\n${newWallet.seed}\n------------\n`;

    fs.appendFileSync(filePath, content);
    console.log(`Wallet credentials appended to ${filePath}`);

  } catch (error) {
    console.error("Error generating wallet:", error);
    process.exit(1);
  }
}

generateAndSaveWallet(); 