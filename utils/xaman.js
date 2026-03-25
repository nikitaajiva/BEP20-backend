const { XummSdk } = require('xumm-sdk');

let xumm;

if (!global.xummInstance) {
  global.xummInstance = new XummSdk(
    process.env.XAMAN_API_KEY,
    process.env.XAMAN_API_SECRET
  );
}

xumm = global.xummInstance;

module.exports = xumm;