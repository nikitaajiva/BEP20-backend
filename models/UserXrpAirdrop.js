const mongoose = require('mongoose');

const UserXrpAirdropSchema = new mongoose.Schema({
    id: String,
    timestamp: String,
    uhid: String,
    child: String,
    type: String,
    txn: String,
    level: String,
    active: String,
    amount: String,
    currency: String,
    status: String
}, {
    collection: 'userxrpairdrop' // Use the existing collection
});

module.exports = mongoose.model('UserXrpAirdrop', UserXrpAirdropSchema); 