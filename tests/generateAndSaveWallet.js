const xrpl = require('xrpl');
const fs = require('fs');
const path = require('path');

function generateAndSaveWallet() {
  try {
    const newWallet = xrpl.Wallet.generate();

    
    
    

    const filePath = path.join(__dirname, 'data');
    const content = `${newWallet.classicAddress}\n${newWallet.seed}\n------------\n`;

    fs.appendFileSync(filePath, content);
    

  } catch (error) {
    console.error("Error generating wallet:", error);
    process.exit(1);
  }
}

generateAndSaveWallet(); 
