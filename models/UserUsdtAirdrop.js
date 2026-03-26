const mongoose = require("mongoose");

const UserUsdtAirdropSchema = new mongoose.Schema(
  {
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
    status: String,
  },
  {
    collection: "userusdtairdrop",
  }
);

module.exports = mongoose.model("UserUsdtAirdrop", UserUsdtAirdropSchema);
