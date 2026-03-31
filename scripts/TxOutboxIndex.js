const mongoose = require('mongoose');
const Ledger   = require('../models/Ledger');
const TxOutbox = require('../models/TxOutbox');

(async () => {
  await mongoose.connect("mongodb://localhost:27017/xrpmigrate");
  await Ledger.collection.createIndex(
    { 'pendingWithdrawal.idempotencyKey': 1 },
    { unique:true, sparse:true }
  );
  await TxOutbox.collection.createIndex({ hash:1 }, { unique:true });
  
  process.exit(0);
})();
