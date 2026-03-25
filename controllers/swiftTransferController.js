const mongoose = require('mongoose');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const LedgerRow = require('../models/LedgerRow');
const { Decimal128 } = mongoose.Types;
const { createLedgerEntry } = require('../jobs/helpers/ledgerHelpers');
const { 
    addDecimal128, 
    subtractDecimal128, 
    compareDecimal128 
} = require('../utils/decimal128Utils');

// Get all Swift transfers for the logged-in user (sent or received)
exports.getSwiftTransfers = async (req, res) => {
  try {
    const userId = req.user._id;
    const ledgerRows = await LedgerRow.find({
        userId,
        $or: [{ eventType: 'SWIFT_TRANSFER_OUT' }, { eventType: 'SWIFT_TRANSFER_IN' }]
    }).sort({ ts: -1 });

    res.status(200).json({ 
      success: true, 
      count: ledgerRows.length,
      data: ledgerRows 
    });

  } catch (error) {
    console.error('Error fetching Swift transfers:', error);
    res.status(500).json({ message: 'Server error while fetching Swift transfers.', error: error.message });
  }
};

exports.transferToUser = async (req, res) => {
    try {
        const { recipientEmail, amount, narrative } = req.body;
        const fromUserId = req.user._id;

        if (!recipientEmail) {
            return res.status(400).json({ success: false, message: 'Recipient email is required.' });
        }
        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({ success: false, message: 'A positive transfer amount is required.' });
        }

        const amountD128 = Decimal128.fromString(amount.toString());

        const fromLedger = await Ledger.findById(fromUserId);
        if (!fromLedger || compareDecimal128(fromLedger.wallets.swift, amountD128) < 0) {
            return res.status(400).json({ success: false, message: 'Insufficient Swift balance.' });
        }
        
        const toUser = await User.findOne({ email: recipientEmail });
        if (!toUser) {
            return res.status(404).json({ success: false, message: 'Recipient user not found.' });
        }

        if (toUser._id.equals(fromUserId)) {
            return res.status(400).json({ success: false, message: 'You cannot transfer funds to your own account.' });
        }

        const toUserId = toUser._id;
        const toLedger = await Ledger.findById(toUserId);
        if (!toLedger) {
            return res.status(404).json({ success: false, message: 'Recipient ledger not found.' });
        }
        
        fromLedger.wallets.swift = subtractDecimal128(fromLedger.wallets.swift, amountD128);
        toLedger.wallets.swift = addDecimal128(toLedger.wallets.swift, amountD128);

        await fromLedger.save();
        await toLedger.save();

        const fromUser = await User.findById(fromUserId).lean();

        await createLedgerEntry({
            userId: fromUserId,
            eventType: 'SWIFT_TRANSFER_OUT',
            amount: amountD128.toString(),
            walletFrom: 'SWIFT',
            walletTo: 'SWIFT',
            narrative: `Sent to ${toUser.username}: ${narrative || ''}`,
            refId: toUserId.toString()
        });

        await createLedgerEntry({
            userId: toUserId,
            eventType: 'SWIFT_TRANSFER_IN',
            amount: amountD128.toString(),
            walletFrom: 'SWIFT',
            walletTo: 'SWIFT',
            narrative: `Received from ${fromUser.username}: ${narrative || ''}`,
            refId: fromUserId.toString()
        });

        res.status(200).json({ success: true, message: 'Transfer successful.' });
    } catch (error) {
        console.error('Error during Swift transfer:', error);
        res.status(500).json({ success: false, message: 'An internal server error occurred.' });
    }
}; 