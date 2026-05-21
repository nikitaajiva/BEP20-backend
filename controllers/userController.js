const User = require('../models/User');
const TokenStaking = require('../models/TokenStaking');
const { createLedgerEntry } = require('../jobs/helpers/ledgerHelpers');
const { createHorseNftPurchase } = require('../server/Modules/horseNft/Services/horseNftPurchaseService');

/**
 * @desc    Update user's notification settings
 * @route   PUT /api/users/settings/notifications
 * @access  Private
 */
const updateNotificationSettings = async (req, res) => {
    try {
        const { successfulDeposits, withdrawalConfirmations } = req.body;
        const userId = req.user._id;

        // Basic validation
        if (typeof successfulDeposits !== 'boolean' || typeof withdrawalConfirmations !== 'boolean') {
            return res.status(400).json({ message: 'Invalid settings format.' });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        user.notificationSettings = {
            successfulDeposits,
            withdrawalConfirmations,
        };

        await user.save();

        // Return the updated user object (excluding sensitive fields)
        const userToReturn = {
            _id: user._id,
            username: user.username,
            email: user.email,
            notificationSettings: user.notificationSettings
            // Add other fields from the user object you might want to return
        };


        res.status(200).json({
            message: 'Notification settings updated successfully.',
            user: userToReturn,
        });

    } catch (error) {
        console.error('Error updating notification settings:', error);
        res.status(500).json({ message: 'Server error while updating settings.' });
    }
};

/**
 * @desc    Update user's wallet address
 * @route   PUT /api/users/wallet-address
 * @access  Private
 */
// const updateWalletAddress = async (req, res) => {
//     try {
//         // The field from the frontend will be 'wallet_address'
//         const { wallet_address } = req.body;
//         
//         const userId = req.user._id;

//         if (!wallet_address || typeof wallet_address !== 'string') {
//             return res.status(400).json({ message: 'Invalid wallet address provided.' });
//         }

//         // Check if this wallet address is already used by ANOTHER user
//         const existingUserWithWallet = await User.findOne({ 
//             wallet_address: wallet_address, 
//             _id: { $ne: userId } 
//         });

//         if (existingUserWithWallet) {
//             // Use 409 Conflict status code for duplicate resource
//             return res.status(409).json({ message: 'This wallet address is already registered to another account.' });
//         }

//         const user = await User.findById(userId);

//         if (!user) {
//             return res.status(404).json({ message: 'User not found.' });
//         }

//         // Save the address to the correct field
//         user.wallet_address = wallet_address;
//         await user.save();

//         res.status(200).json({
//             message: 'Wallet address updated successfully.',
//             wallet_address: user.wallet_address,
//         });

//     } catch (error) {
//         console.error('Error updating wallet address:', error);
//         res.status(500).json({ message: 'Server error while updating wallet address.' });
//     }
// };


const updateWalletAddress = async (req, res) => {
    try {
        const { wallet_address } = req.body;
        const userId = req.user._id;

        if (!wallet_address || typeof wallet_address !== "string") {
            return res.status(400).json({ message: "Invalid wallet address provided." });
        }

        const newAddress = wallet_address.trim().toLowerCase();

        // 🔍 Check if another user already uses this address
        const existingUserWithWallet = await User.findOne({
            wallet_address: newAddress,
            _id: { $ne: userId },
        });

        if (existingUserWithWallet) {
            return res.status(409).json({
                message: "This wallet address is already registered to another account.",
            });
        }

        // 🔍 Fetch current user
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        const currentAddress = user.wallet_address ? user.wallet_address.trim().toLowerCase() : "";

        // ✅ If already same, return success
        if (currentAddress === newAddress) {
            return res.status(200).json({
                message: "Wallet address already set to this value.",
                wallet_address: user.wallet_address,
            });
        }

        // 🚫 If already set but different → block
        if (currentAddress && currentAddress !== newAddress) {
            return res.status(403).json({
                message:
                    "You cannot change your wallet address. It has already been set to a different value.",
                currentAddress: user.wallet_address,
            });
        }

        // ✅ Safe to set if blank/null
        user.wallet_address = newAddress;
        await user.save();

        res.status(200).json({
            message: "Wallet address updated successfully.",
            wallet_address: user.wallet_address,
        });
    } catch (error) {
        console.error("Error updating wallet address:", error);
        res.status(500).json({ message: "Server error while updating wallet address." });
    }
};

/**
 * @desc    Update user's profile information
 * @route   PUT /api/users/profile
 * @access  Private
 */
const updateUserProfile = async (req, res) => {
    try {
        const userId = req.user._id;
        const { username, country, countryCode, whatsappContact } = req.body;

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // Update only the fields that are provided
        if (username) user.username = username;
        if (country) user.country = country;
        if (countryCode) user.countryCode = countryCode;
        if (whatsappContact) user.whatsappContact = whatsappContact;

        const updatedUser = await user.save();

        // It's good practice to not return the full user object
        const userToReturn = {
            _id: updatedUser._id,
            username: updatedUser.username,
            email: updatedUser.email,
            country: updatedUser.country,
            countryCode: updatedUser.countryCode,
            whatsappContact: updatedUser.whatsappContact,
            wallet_address: updatedUser.wallet_address,
            notificationSettings: updatedUser.notificationSettings,
            // Include other fields as needed, but avoid sensitive ones
        };

        res.status(200).json({
            message: 'Profile updated successfully.',
            user: userToReturn
        });

    } catch (error) {
        console.error('Error updating user profile:', error);
        // Handle potential duplicate username error
        if (error.code === 11000 && error.keyPattern && error.keyPattern.username) {
            return res.status(409).json({ message: 'This username is already taken.' });
        }
        res.status(500).json({ message: 'Server error while updating profile.' });
    }
};

/**
 * @desc    Stake tokens for a user
 * @route   POST /api/users/stake
 * @access  Private
 */
const stakeTokens = async (req, res) => {
    const { debitInternalSolWallet } = require('../services/internalWalletService');
    const axios = require('axios');

    try {
        const { amount, days, tscAmount, ratePct, tokenAmount } = req.body;
        const userId = req.user._id;

        // Basic validation
        if (!amount || !days || isNaN(amount) || ![30, 90, 180, 365].includes(Number(days))) {
            return res.status(400).json({ message: 'Invalid staking parameters. Please provide amount and valid days (30, 90, 180, 365).' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // ── Fetch live SOL/USDT rate ───────────────────────────────────────────
        let solUsdRate = 150; // fallback
        try {
            const rateRes = await axios.get(
                'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
                { timeout: 5000 }
            );
            const rate = rateRes.data?.solana?.usd;
            if (rate && rate > 0) solUsdRate = rate;
        } catch (rateErr) {
            console.warn('[stakeTokens] Could not fetch live SOL rate, using fallback:', solUsdRate);
        }

        const requiredSol = parseFloat((Number(amount) / solUsdRate).toFixed(9));

        // ── Debit internal SOL wallet ─────────────────────────────────────────
        try {
            await debitInternalSolWallet({ userId, amountSol: requiredSol });
        } catch (debitErr) {
            if (debitErr.message === 'INSUFFICIENT_INTERNAL_SOL_BALANCE') {
                return res.status(402).json({
                    message: `Insufficient wallet balance. You need ${requiredSol} SOL (≈ $${amount} USDT at current rate of $${solUsdRate}/SOL).`,
                    requiredSol,
                    solUsdRate,
                });
            }
            throw debitErr;
        }

        // Compute APY based on duration
        const daysNum = Number(days);
        const computedApy = daysNum >= 365 ? 0.28 : daysNum >= 180 ? 0.22 : daysNum >= 90 ? 0.12 : 0.10;
        const apyToStore = ratePct ? Number(ratePct) / 100 : computedApy;

        const startDateNow = new Date();
        const endDateCalc = new Date(startDateNow.getTime() + (daysNum * 86400000));

        // Create document in dedicated TokenStaking collection
        const stakingDoc = await TokenStaking.create({
            user: userId,
            amount: Number(amount),
            days: daysNum,
            startDate: startDateNow,
            endDate: endDateCalc,
            status: 'active',
            apy: apyToStore,
            tokenAmount: Number(tokenAmount || tscAmount || 0),
            earnedRewards: 0,
            lastRewardedAt: null,
        });

        // Add new plan to legacy stakingPlans array for backward compatibility
        const newPlan = {
            amount: Number(amount),
            days: daysNum,
            startDate: startDateNow,
            status: "active",
            apy: ratePct,
            tokenAmount: Number(tokenAmount || tscAmount || 0)
        };

        if (!user.stakingPlans) {
            user.stakingPlans = [];
        }

        user.stakingPlans.push(newPlan);
        await user.save();

        // Create Ledger Entry for Staking (debit from SOL_INTERNAL)
        await createLedgerEntry({
            userId: user._id,
            eventType: 'STAKING_DEPOSIT',
            amount: requiredSol,
            walletFrom: 'SOL_INTERNAL',
            walletTo: 'STAKING_HUB',
            tscAmount: tscAmount,
            ratePct: ratePct,
            narrative: `Staked ${amount} USDT (${tscAmount || '0'} TSC) for ${days} days at ${ratePct || '0'}% APY. Paid ${requiredSol} SOL @ $${solUsdRate}/SOL.`,
        });

        res.status(200).json({
            message: 'Staking plan added successfully.',
            stakingDoc,
            stakingPlans: user.stakingPlans,
        });

    } catch (error) {
        console.error('Error staking tokens:', error);
        res.status(500).json({ message: 'Server error while staking tokens.' });
    }
};

/**
 * @desc    Purchase an NFT package — supports both Horse NFT (starter/growth/premium)
 *          AND N1–N5 Mining ecosystem tiers.
 * @route   POST /api/users/purchase-nft
 * @access  Private
 * @body    { tier: "starter"|"growth"|"premium"|"N1"|"N2"|"N3"|"N4"|"N5" }
 */
const purchaseNft = async (req, res) => {
    const { debitInternalSolWallet } = require('../services/internalWalletService');
    const axios = require('axios');

    try {
        const { tier, tscAmount } = req.body;
        const userId = req.user._id;
        const horseTierCodes = new Set(['starter', 'growth', 'premium']);

        // ── N1–N5 Mining NFT tier config ──────────────────────────────────────
        const MINING_TIERS = {
            N1: { nftType: 'mining', mintPrice: 100,   miningPower: 100,   powerCoefficient: 0.7, poolMultiplier: 2.0, afterTSCMultiplier: 2.5 },
            N2: { nftType: 'mining', mintPrice: 500,   miningPower: 500,   powerCoefficient: 0.8, poolMultiplier: 2.0, afterTSCMultiplier: 2.8 },
            N3: { nftType: 'mining', mintPrice: 1000,  miningPower: 1000,  powerCoefficient: 0.9, poolMultiplier: 2.0, afterTSCMultiplier: 3.0 },
            N4: { nftType: 'mining', mintPrice: 3000,  miningPower: 3000,  powerCoefficient: 1.0, poolMultiplier: 2.0, afterTSCMultiplier: 3.5 },
            N5: { nftType: 'mining', mintPrice: 10000, miningPower: 10000, powerCoefficient: 1.1, poolMultiplier: 2.0, afterTSCMultiplier: 4.0 },
        };

        const isHorse  = horseTierCodes.has(tier);
        const isMining = !!MINING_TIERS[tier];

        if (!tier || (!isHorse && !isMining)) {
            return res.status(400).json({ message: 'Invalid NFT tier. Choose a Horse tier (starter, growth, premium) or a Mining tier (N1–N5).' });
        }

        if (isHorse) {
            const result = await createHorseNftPurchase({
                userId,
                tierCode: tier,
                idempotencyKey: req.headers["x-idempotency-key"] || req.body?.idempotencyKey || null,
                paymentReference: req.body?.paymentReference || null,
                requestSource: "LEGACY_USERS_PURCHASE_NFT",
            });

            if (result.successState !== "ACTIVE") {
                return res.status(402).json({
                    message: result.message,
                    horseNftPurchase: result.purchase,
                });
            }

            const refreshedUser = await User.findById(userId).select("nftPackages");
            return res.status(200).json({
                message: result.message,
                nftPackages: refreshedUser?.nftPackages || [],
                horseNftPurchase: result.purchase,
            });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        // ── Fetch live SOL/USDT rate ───────────────────────────────────────────
        let solUsdRate = 150; // fallback
        try {
            const rateRes = await axios.get(
                'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
                { timeout: 5000 }
            );
            const rate = rateRes.data?.solana?.usd;
            if (rate && rate > 0) solUsdRate = rate;
        } catch (rateErr) {
            console.warn('[purchaseNft] Could not fetch live SOL rate, using fallback:', solUsdRate);
        }

        const cfg = MINING_TIERS[tier];
        const mintPriceUsdt = cfg.mintPrice;
        const requiredSol   = parseFloat((mintPriceUsdt / solUsdRate).toFixed(9));

        // ── Debit internal SOL wallet ─────────────────────────────────────────
        try {
            await debitInternalSolWallet({ userId, amountSol: requiredSol });
        } catch (debitErr) {
            if (debitErr.message === 'INSUFFICIENT_INTERNAL_SOL_BALANCE') {
                return res.status(402).json({
                    message: `Insufficient wallet balance. You need ${requiredSol} SOL (≈ $${mintPriceUsdt} USDT at current rate of $${solUsdRate}/SOL).`,
                    requiredSol,
                    solUsdRate,
                });
            }
            throw debitErr;
        }

        // ── Build package record ───────────────────────────────────────────────
        if (!user.nftPackages) user.nftPackages = [];

        let newPackage;
        let walletTo;
        let narrative;

        newPackage = {
            nftType: 'mining', tier,
            mintPrice: cfg.mintPrice, miningPower: cfg.miningPower,
            powerCoefficient: cfg.powerCoefficient, poolMultiplier: cfg.poolMultiplier,
            afterTSCMultiplier: cfg.afterTSCMultiplier,
            purchaseDate: new Date(), status: 'active',
        };
        walletTo  = 'NFT_MINT';
        narrative = `Minted ${tier} NFT — Mining Power: ${cfg.miningPower.toLocaleString()}, Coefficient: ${cfg.powerCoefficient}×. Paid ${requiredSol} SOL @ $${solUsdRate}/SOL.`;

        user.nftPackages.push(newPackage);
        await user.save();

        // ── Write ledger row ───────────────────────────────────────────────────
        await createLedgerEntry({
            userId,
            eventType: 'NFT_PURCHASE',
            amount:    requiredSol,
            walletFrom: 'SOL_INTERNAL',
            walletTo,
            tscAmount,
            narrative,
        });

        const message = `${tier} Mining NFT minted successfully. Mining power is now active.`;

        res.status(200).json({ message, nftPackages: user.nftPackages });

    } catch (error) {
        console.error('Error purchasing NFT:', error);
        res.status(500).json({ message: 'Server error while processing NFT purchase.' });
    }
};


/**
 * @desc    Get user's P1-P9 Node level status, current powers, and qualified level
 * @route   GET /api/users/node-status
 * @access  Private
 */
const getNodeStatus = async (req, res) => {
    try {
        const userId = req.user._id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        const getOwnMiningPower = (u) => {
            if (!u.nftPackages) return 0;
            return u.nftPackages
                .filter(p => p.nftType === 'mining' && p.status === 'active')
                .reduce((sum, p) => sum + (p.miningPower || 0), 0);
        };

        const ownPower = getOwnMiningPower(user);

        // Fetch downline users (all users where 'path' includes this user)
        const downlineUsers = await User.find({ path: userId });
        
        let teamPower = 0;
        for (const dUser of downlineUsers) {
            teamPower += getOwnMiningPower(dUser);
        }

        const totalPower = ownPower + teamPower;

        const NODE_TIERS_CFG = [
            { id: "P9", upgradePower: 30000000, totalPower: 64000000, miningCut: "90%", feeAirdrop: "5%" },
            { id: "P8", upgradePower: 16000000, totalPower: 32000000, miningCut: "80%", feeAirdrop: "7.5%" },
            { id: "P7", upgradePower: 8000000,  totalPower: 16000000, miningCut: "70%", feeAirdrop: "8.5%" },
            { id: "P6", upgradePower: 3500000,  totalPower: 7000000,  miningCut: "60%", feeAirdrop: "9.5%" },
            { id: "P5", upgradePower: 1500000,  totalPower: 3000000,  miningCut: "50%", feeAirdrop: "10.5%" },
            { id: "P4", upgradePower: 500000,   totalPower: 1000000,  miningCut: "40%", feeAirdrop: "11.5%" },
            { id: "P3", upgradePower: 150000,   totalPower: 300000,   miningCut: "30%", feeAirdrop: "12.5%" },
            { id: "P2", upgradePower: 50000,    totalPower: 100000,   miningCut: "20%", feeAirdrop: "15%" },
            { id: "P1", upgradePower: 10000,    totalPower: 30000,    miningCut: "10%", feeAirdrop: "20%" },
        ];

        let qualifiedTier = null;
        for (const tier of NODE_TIERS_CFG) {
            if (ownPower >= tier.upgradePower && totalPower >= tier.totalPower) {
                qualifiedTier = tier.id;
                break;
            }
        }

        if (user.nodeTier !== qualifiedTier) {
            user.nodeTier = qualifiedTier;
            await user.save();
        }

        const tierStatuses = NODE_TIERS_CFG.map(t => {
            const meetsOwn = ownPower >= t.upgradePower;
            const meetsTotal = totalPower >= t.totalPower;
            const isUnlocked = meetsOwn && meetsTotal;

            let reason = "Qualified";
            if (!isUnlocked) {
                const missingOwn = Math.max(0, t.upgradePower - ownPower);
                const missingTotal = Math.max(0, t.totalPower - totalPower);
                if (missingOwn > 0 && missingTotal > 0) {
                    reason = `Need ${missingOwn.toLocaleString()} U personal power & ${missingTotal.toLocaleString()} U total power.`;
                } else if (missingOwn > 0) {
                    reason = `Need ${missingOwn.toLocaleString()} U personal power.`;
                } else {
                    reason = `Need ${missingTotal.toLocaleString()} U total power.`;
                }
            }

            return {
                id: t.id,
                upgradePower: t.upgradePower,
                totalPower: t.totalPower,
                miningCut: t.miningCut,
                feeAirdrop: t.feeAirdrop,
                meetsOwn,
                meetsTotal,
                isUnlocked,
                reason,
            };
        }).reverse(); // Sort P1 -> P9

        res.status(200).json({
            success: true,
            ownPower,
            teamPower,
            totalPower,
            nodeTier: qualifiedTier || "None",
            tiers: tierStatuses
        });

    } catch (error) {
        console.error("Error in getNodeStatus:", error);
        res.status(500).json({ message: "Server error while fetching node status." });
    }
};

/**
 * @desc    Get user's complete dynamic ecosystem assets portfolio (Horse NFTs + Token Staking details)
 * @route   GET /api/users/portfolio
 * @access  Private
 */
const getPortfolioDetails = async (req, res) => {
    try {
        const userId = req.user._id;
        const User = require('../models/User');
        const user = await User.findById(userId).lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // 1. Horse NFT Package mappings & calculations
        const nftPackagesArr = user?.nftPackages || [];
        const effectiveNftPackages = nftPackagesArr.length > 0 
          ? nftPackagesArr 
          : (user?.nftPackage ? [{ tier: user.nftPackage }] : []);

        const tierNormalize = {
          starter: "bronze", growth: "silver", premium: "gold",
          bronze: "bronze", silver: "silver", gold: "gold",
        };

        const packageNames = {
          bronze: "BRONZE", silver: "SILVER", gold: "GOLD",
          starter: "BRONZE", growth: "SILVER", premium: "GOLD",
        };

        const nftRoiMap   = { starter: 45, growth: 55, premium: 65, bronze: 45, silver: 55, gold: 65 };
        const nftRateMap  = { starter: 0.003, growth: 0.004, premium: 0.005, bronze: 0.003, silver: 0.004, gold: 0.005 };
        const nftPriceMap = {
          starter: 500, growth: 1000, premium: 5000,
          bronze: 500, silver: 1000, gold: 5000,
          N1: 500, N2: 1000, N3: 5000, N4: 10000, N5: 25000
        };

        const horseNFTs = effectiveNftPackages.map((pkg, index) => {
          const tier = tierNormalize[pkg.tier] || "bronze";
          const roiProgress = nftRoiMap[pkg.tier] || 0;
          const dailyRate = nftRateMap[pkg.tier] || 0;
          const purchasePrice = pkg.mintPrice && pkg.mintPrice > 0 ? pkg.mintPrice : (nftPriceMap[pkg.tier] || 0);
          const dailyYield = (purchasePrice * dailyRate);
          const estPayout = (purchasePrice * (roiProgress / 100));

          return {
            id: pkg._id || `nft_${index}`,
            tier: pkg.tier,
            normalizedTier: tier,
            packageName: packageNames[pkg.tier] || pkg.tier.toUpperCase(),
            purchasePrice,
            currency: "USDT",
            purchaseDate: pkg.purchaseDate || new Date(),
            roiProgress,
            dailyRate,
            dailyYield: Number(dailyYield.toFixed(4)),
            estPayout: Number(estPayout.toFixed(2)),
            nextPayout: Number(dailyYield.toFixed(4)),
            status: pkg.status || "active"
          };
        });

        // 2. Token Staking — read from dedicated TokenStaking collection
        const stakingDocs = await TokenStaking.find({ user: userId }).lean();
        const tokenStaking = stakingDocs.map((stake, index) => {
          const daysPassed = Math.max(0, Math.floor((new Date() - new Date(stake.startDate)) / 86400000));
          const progress = Math.min(100, (daysPassed / stake.days) * 100);
          
          const apy = stake.apy || (stake.days >= 365 ? 0.28 : stake.days >= 180 ? 0.22 : stake.days >= 90 ? 0.12 : 0.10);
          const amt = parseFloat(stake.amount || stake.stakeAmount || "0");
          // Daily yield is 0 until the first cron run (which sets lastRewardedAt)
          const dailyYield = stake.lastRewardedAt !== null ? (amt * apy / 365) : 0;
          const estReward = (amt * apy * stake.days / 365);
          const daysRemaining = Math.max(0, stake.days - daysPassed);
          const tierName = stake.days >= 365 ? "Premium" : stake.days >= 180 ? "Advanced" : stake.days >= 90 ? "Growth" : "Starter";

          const startDate = stake.startDate || new Date();
          const endDate = stake.endDate || new Date(new Date(startDate).getTime() + (stake.days * 86400000));

          return {
            id: stake._id || `stake_${index}`,
            amount: amt,
            tokenAmount: parseFloat(stake.tokenAmount || stake.tscAmount || (amt / 0.01) || "0"),
            currency: "USDT",
            days: stake.days,
            startDate,
            endDate,
            status: stake.status || "active",
            tierName,
            apy: Number(apy.toFixed(2)),
            dailyYield: Number(dailyYield.toFixed(4)),
            estReward: Number(estReward.toFixed(2)),
            daysPassed,
            daysRemaining,
            progress: Number(progress.toFixed(2)),
            earnedRewards: stake.earnedRewards || 0
          };
        });

        // 3. Combined Aggregated Calculations
        const totalNftPrice = horseNFTs.reduce((acc, n) => acc + n.purchasePrice, 0);
        const totalStakedAmount = tokenStaking.reduce((acc, s) => acc + s.amount, 0);
        const totalEcosystemAssets = totalNftPrice + totalStakedAmount;

        const totalNftDailyYield = horseNFTs.reduce((acc, n) => acc + n.dailyYield, 0);
        const totalStakingDailyYield = tokenStaking.reduce((acc, s) => acc + s.dailyYield, 0);
        const totalDailyYield = totalNftDailyYield + totalStakingDailyYield;

        const avgDailyYieldPercent = totalEcosystemAssets > 0 
          ? Number(((totalDailyYield / totalEcosystemAssets) * 100).toFixed(4))
          : 0;

        res.status(200).json({
            success: true,
            horseNFTs,
            tokenStaking,
            summary: {
                totalEcosystemAssets,
                totalActiveAssets: horseNFTs.length + tokenStaking.length,
                totalDailyYield: Number(totalDailyYield.toFixed(4)),
                avgDailyYieldPercent,
                totalNftAssetsCount: horseNFTs.length,
                totalStakingAssetsCount: tokenStaking.length,
                totalNftPrice,
                totalStakedAmount
            }
        });
    } catch (error) {
        console.error('Error in getPortfolioDetails:', error);
        res.status(500).json({ message: 'Server error while fetching portfolio details.' });
    }
};

module.exports = {
    updateNotificationSettings,
    updateWalletAddress,
    updateUserProfile,
    stakeTokens,
    purchaseNft,
    getNodeStatus,
    getPortfolioDetails,
}; 
