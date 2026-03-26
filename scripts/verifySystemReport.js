const mongoose = require('mongoose');
const { getSystemReport } = require('../controllers/supportController');

(async () => {
  try {
    await mongoose.connect('mongodb://localhost/xrpmigrate');

    // Minimal mock req/res
    const req = {};
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        console.log('Status:', this.statusCode || 200);
        console.log('System Report:\n', JSON.stringify(payload.data, null, 2));
        mongoose.disconnect().then(() => process.exit(0));
      },
    };

    await getSystemReport(req, res);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})(); 