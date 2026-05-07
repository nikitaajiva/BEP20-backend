const mongoose = require('mongoose');

const SwiftTransferSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    validate: {
      validator: function(value) {
        return parseFloat(value.toString()) > 0;
      },
      message: 'Transfer amount must be positive'
    }
  },
  status: {
    type: String,
    enum: ['completed', 'failed', 'pending'],
    default: 'pending',
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('SwiftTransfer', SwiftTransferSchema); 
