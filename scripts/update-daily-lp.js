const mongoose = require('mongoose');
const moment = require('moment');
const DailyUserLp = require('../models/DailyUserLp');
const LedgerRow = require('../models/LedgerRow');
const Level = require('../models/Level');
const User = require('../models/User');
const config = require('../config');

async function getTeamMembers(uhid, maxLevel = 16) {
    const teamMembers = await Level.find({ 
        parent: uhid,
        level: { $lte: maxLevel }
    }).select('child level').lean();
    
    return teamMembers;
}

async function updateUserAndTeamLp(userId, uhid, date) {
    const startOfDay = moment(date).startOf('day').toDate();
    const endOfDay = moment(date).endOf('day').toDate();

    // Get current daily LP record
    let dailyLp = await DailyUserLp.findOne({ 
        userId,
        date: startOfDay
    });

    // Get new transactions since last update
    const query = {
        userId,
        ts: { 
            $lte: endOfDay,
            ...(dailyLp?.lastProcessedLedgerRowId && {
                $gt: dailyLp.lastProcessedLedgerRowId
            })
        },
        eventType: { 
            $in: [ 'LP_DEPOSIT_FROM_XAMAN', 'WITHDRAWAL']
        }
    };

    const newLedgerRows = await LedgerRow.find(query)
        .sort({ ts: 1 })
        .lean();

    if (newLedgerRows.length === 0) {
        return; // No new transactions
    }

    // Calculate new self LP
    let selfLp = dailyLp ? dailyLp.selfLp.toString() : '0.0';
    for (const row of newLedgerRows) {
        if (row.eventType === 'WITHDRAWAL') {
            selfLp = (parseFloat(selfLp) - parseFloat(row.amount.toString())).toString();
        } else {
            selfLp = (parseFloat(selfLp) + parseFloat(row.amount.toString())).toString();
        }
    }

    // Get and update team LP
    const teamMembers = await getTeamMembers(uhid);
    const teamByLevel = teamMembers.reduce((acc, member) => {
        if (!acc[member.level]) {
            acc[member.level] = [];
        }
        acc[member.level].push(member.child);
        return acc;
    }, {});

    // Calculate team LP by level
    const teamLpByLevel = [];
    let totalTeamLp = '0.0';

    for (const [level, members] of Object.entries(teamByLevel)) {
        const teamLedgerRows = await LedgerRow.find({
            userId: { $in: members },
            ts: { $lte: endOfDay },
            eventType: { 
                $in: [ 'LP_DEPOSIT_FROM_XAMAN', 'WITHDRAWAL']
            }
        }).lean();

        let levelLp = '0.0';
        for (const row of teamLedgerRows) {
            if (row.eventType === 'WITHDRAWAL') {
                levelLp = (parseFloat(levelLp) - parseFloat(row.amount.toString())).toString();
            } else {
                levelLp = (parseFloat(levelLp) + parseFloat(row.amount.toString())).toString();
            }
        }

        teamLpByLevel.push({
            level: parseInt(level),
            amount: mongoose.Types.Decimal128.fromString(levelLp)
        });

        totalTeamLp = (parseFloat(totalTeamLp) + parseFloat(levelLp)).toString();
    }

    // Update daily LP record
    const lastProcessedRow = newLedgerRows[newLedgerRows.length - 1];
    
    await DailyUserLp.findOneAndUpdate(
        { 
            userId,
            date: startOfDay
        },
        {
            userId,
            uhid,
            date: startOfDay,
            selfLp: mongoose.Types.Decimal128.fromString(selfLp),
            teamLp: mongoose.Types.Decimal128.fromString(totalTeamLp),
            teamLpByLevel,
            lastProcessedLedgerRowId: lastProcessedRow._id
        },
        { 
            upsert: true,
            new: true
        }
    );

    // Also update upline's team LP
    const uplineUsers = await Level.find({
        child: uhid,
        level: { $lte: 16 }
    }).select('parent').lean();

    for (const upline of uplineUsers) {
        const uplineUser = await User.findOne({ uhid: upline.parent }).select('_id uhid').lean();
        if (uplineUser) {
            await updateUserAndTeamLp(uplineUser._id, uplineUser.uhid, date);
        }
    }
}

async function processNewTransactions() {
    try {
        // Get the latest unprocessed LP transactions
        const latestTransactions = await LedgerRow.find({
            eventType: { 
                $in: ['DEPOSIT', 'LP_DEPOSIT_FROM_XAMAN', 'WITHDRAWAL']
            }
        })
        .sort({ ts: -1 })
        .limit(100) // Process in batches
        .lean();

        // Group transactions by user
        const userTransactions = {};
        for (const tx of latestTransactions) {
            if (!userTransactions[tx.userId]) {
                userTransactions[tx.userId] = [];
            }
            userTransactions[tx.userId].push(tx);
        }

        // Process each user's transactions
        for (const [userId, transactions] of Object.entries(userTransactions)) {
            const user = await User.findById(userId).select('uhid').lean();
            if (user) {
                await updateUserAndTeamLp(
                    userId,
                    user.uhid,
                    transactions[0].ts // Use latest transaction date
                );
            }
        }

        console.log(`Processed ${latestTransactions.length} transactions`);
    } catch (error) {
        console.error('Error processing transactions:', error);
    }
}

// Connect to MongoDB and start processing
mongoose.connect(config.mongoURI)
    .then(() => {
        console.log('MongoDB connected...');
        
        // Process new transactions every minute
        setInterval(processNewTransactions, 60000);
        
        // Initial processing
        return processNewTransactions();
    })
    .catch(err => {
        console.error('Script failed:', err);
        process.exit(1);
    }); 