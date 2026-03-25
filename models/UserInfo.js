const mongoose = require('mongoose');

const UserInfoSchema = new mongoose.Schema({
  // id: { type: String, required: true }, // Original 'id' field
  timestamp: { type: String }, // e.g., '2025-05-11 19:05:54'
  uhid: { type: String, required: true, unique: true, index: true },
  login_key: { type: String }, // Potentially sensitive
  wallet_key: { type: String }, // Potentially sensitive
  gfaauth: { type: String }, // Google Authenticator flag?
  email: { type: String } // Clear text email
}, { 
  timestamps: { createdAt: 'timestamp_mongoose_created', updatedAt: 'timestamp_mongoose_updated' }
});

module.exports = mongoose.model('UserInfo', UserInfoSchema, 'userinfo'); 