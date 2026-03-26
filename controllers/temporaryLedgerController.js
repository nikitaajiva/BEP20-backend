const mongoose = require('mongoose');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const LedgerRow = require('../models/LedgerRow'); // Assuming LedgerRow model exists for entries
const { Decimal128 } = mongoose.Types;
const { getOrCreateLedger, createLedgerEntry } = require('../jobs/helpers/ledgerHelpers'); // Corrected path

exports.applyTestLimits = async (req, res) => {
  const { amount } = req.body;
  const userId = req.user._id;

  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ message: 'Valid positive amount is required.' });
  }

  const depositAmountD128 = Decimal128.fromString(amount.toString());

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const ledger = await getOrCreateLedger(userId);

    // Simulate First Deposit Limit Setting
    ledger.limits.swiftLimit.cap = depositAmountD128;
    ledger.limits.swiftLimit.pending = Decimal128.fromString('0.0');
    ledger.limits.boostLimit.cap = depositAmountD128;
    ledger.limits.boostLimit.pending = Decimal128.fromString('0.0');
    ledger.limits.fiveXLimit.cap = depositAmountD128.multiply(Decimal128.fromString("5.0"));
    ledger.limits.fiveXLimit.pending = Decimal128.fromString('0.0');
    ledger.limits.zeroRiskLimit.cap = depositAmountD128;
    ledger.limits.zeroRiskLimit.pending = Decimal128.fromString('0.0');
    
    console.log(`[Temp API] Limits set for user ${userId}: swiftCap=${ledger.limits.swiftLimit.cap}, boostCap=${ledger.limits.boostLimit.cap}, fiveXCap=${ledger.limits.fiveXLimit.cap}, zeroRiskCap=${ledger.limits.zeroRiskLimit.cap}`);

    // Simulate Airdrop Activation (Simplified 100% match)
    const actualMatchedAirdrop = depositAmountD128; // For simplicity, 100% of deposit
    
    if (actualMatchedAirdrop.toFloat() > 0) {
        ledger.wallets.lp = ledger.wallets.lp.add(actualMatchedAirdrop);
        await createLedgerEntry({
            userId,
            eventType: 'AIRDROP_ACTIVATION',
            amount: actualMatchedAirdrop.toString(),
            walletFrom: 'SWIFT_WALLET', // Mocked origin
            walletTo: 'LP',
            narrative: `Test API: Airdrop matched from test deposit (100%)`,
            refId: `test-${Date.now()}` // Mocked refId
        });
        console.log(`[Temp API] Airdrop activation for user ${userId}: ${actualMatchedAirdrop.toString()} USDT matched to LP.`);
    }

    // Simulate Deposit itself
    ledger.wallets.lp = ledger.wallets.lp.add(depositAmountD128);
    await createLedgerEntry({
        userId,
        eventType: 'DEPOSIT',
        amount: depositAmountD128.toString(),
        walletFrom: 'EXTERNAL_TEST', // Mocked origin
        walletTo: 'LP',
        narrative: `Test API: User LP deposit.`,
        refId: `test-dep-${Date.now()}` // Mocked refId
    });
    console.log(`[Temp API] User ${userId} LP wallet credited with deposit: ${depositAmountD128.toString()}. New LP Balance: ${ledger.wallets.lp.toString()}`);


    // Update User Counter
    if (!(user.counters.selfLp instanceof Decimal128)) {
        user.counters.selfLp = Decimal128.fromString(user.counters.selfLp ? user.counters.selfLp.toString() : '0.0');
    }
    user.counters.selfLp = user.counters.selfLp.add(depositAmountD128);
    console.log(`[Temp API] User ${userId} selfLp counter updated to: ${user.counters.selfLp.toString()}`);

    await user.save();
    await ledger.save();

    res.status(200).json({ 
        message: 'Test limits applied successfully.', 
        updatedLedger: ledger,
        updatedUserCounters: user.counters 
    });

  } catch (error) {
    console.error(`[Temp API Error] ${error.message}`);
    // No transaction to abort, just send response
    res.status(500).json({ message: 'An internal server error occurred.', error: error.message });
  }
};

exports.applyTestSwiftBalance = async (req, res) => {
  const { username, amount } = req.query; // Changed to req.query

  if (!username) {
    return res.status(400).json({ message: 'Username is required.' });
  }
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) < 0) { // Allow 0 for resetting
    return res.status(400).json({ message: 'Valid, non-negative amount is required.' });
  }

  const swiftAmountD128 = Decimal128.fromString(amount.toString());
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const user = await User.findOne({ username: username }).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: `User with username '${username}' not found.` });
    }
    const userId = user._id;

    const ledger = await getOrCreateLedger(userId, session);

    // Only set the Swift wallet balance
    ledger.wallets.swift = swiftAmountD128;
    
    console.log(`[Temp API] Swift wallet for user ${userId} (username: ${username}) set to: ${ledger.wallets.swift.toString()}`);

    // Create a simple log entry
    await createLedgerEntry({
        userId,
        eventType: 'MOCK_SWIFT_CREDIT', // A distinct event type for this test operation
        amount: swiftAmountD128.toString(),
        walletTo: 'SWIFT',
        narrative: `Test API: Swift wallet balance set for user ${username}`,
        refId: `test-swift-${Date.now()}`
    }, session);

    await ledger.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ 
        message: `Test Swift balance applied successfully for user '${username}'.`,
        updatedLedger: ledger
    });

  } catch (error) {
    if (session.inTransaction()) {
        await session.abortTransaction();
    }
    session.endSession();
    console.error('[Temp API] Error applying test Swift balance:', error);
    res.status(500).json({ message: 'Error applying test Swift balance.', error: error.message });
  }
};

exports.clearUserWallets = async (req, res) => {
  const userId = req.user._id;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const ledger = await getOrCreateLedger(userId);
    // ... existing code ...
  } catch (error) {
    // ... existing code ...
  }
}; 
