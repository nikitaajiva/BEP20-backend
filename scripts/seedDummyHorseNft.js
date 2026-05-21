const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const User = require('../models/User');
const HorseNftPackage = require('../server/Modules/horseNft/Models/HorseNftPackage');
const UserHorseNft = require('../server/Modules/horseNft/Models/UserHorseNft');

const seedDummyHorseNft = async () => {
  const dbURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/xrpmigrate';
  const userIdentifier = process.argv[2];

  try {
    await mongoose.connect(dbURI);
    console.log('Connected to MongoDB');

    let user;
    if (userIdentifier) {
      if (mongoose.Types.ObjectId.isValid(userIdentifier)) {
        user = await User.findById(userIdentifier);
      }
      if (!user) {
        user = await User.findOne({ 
          $or: [
            { email: userIdentifier },
            { username: userIdentifier },
            { uhid: userIdentifier }
          ] 
        });
      }
    } else {
      user = await User.findOne();
    }

    if (!user) {
      console.log('User not found. Please provide a valid email, username, uhid, or ID.');
      process.exit(1);
    }

    console.log(`Adding dummy Horse NFT for user: ${user.username} (${user.email})`);

    // Ensure packages exist
    const packages = [
      { tierCode: 'starter', displayName: 'Bronze', tierName: 'Bronze', priceUSDT: 500, bonusTokens: 100, annualRoiPercent: 15, dividendFrequency: 'monthly', sortOrder: 1 },
      { tierCode: 'growth', displayName: 'Silver', tierName: 'Silver', priceUSDT: 1000, bonusTokens: 250, annualRoiPercent: 25, dividendFrequency: 'monthly', sortOrder: 2 },
      { tierCode: 'premium', displayName: 'Gold', tierName: 'Gold', priceUSDT: 5000, bonusTokens: 1500, annualRoiPercent: 35, dividendFrequency: 'monthly', sortOrder: 3 }
    ];

    const packageIds = {};

    for (const pkgData of packages) {
      const pkg = await HorseNftPackage.findOneAndUpdate(
        { tierCode: pkgData.tierCode },
        pkgData,
        { upsert: true, new: true }
      );
      packageIds[pkgData.tierCode] = pkg._id;
    }

    const now = new Date();

    const dummyNfts = [
      {
        user: user._id,
        package: packageIds['starter'],
        tierCode: 'starter',
        displayName: 'Bronze',
        purchasePriceUSDT: 500,
        bonusTokens: 100,
        annualRoiPercent: 15,
        dividendFrequency: 'monthly',
        status: 'ACTIVE',
        paymentStatus: 'PAID',
        purchasedAt: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
        activatedAt: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000)
      },
      {
        user: user._id,
        package: packageIds['growth'],
        tierCode: 'growth',
        displayName: 'Silver',
        purchasePriceUSDT: 1000,
        bonusTokens: 250,
        annualRoiPercent: 25,
        dividendFrequency: 'monthly',
        status: 'ACTIVE',
        paymentStatus: 'PAID',
        purchasedAt: new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000), // 120 days ago
        activatedAt: new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000)
      },
      {
        user: user._id,
        package: packageIds['premium'],
        tierCode: 'premium',
        displayName: 'Gold',
        purchasePriceUSDT: 5000,
        bonusTokens: 1500,
        annualRoiPercent: 35,
        dividendFrequency: 'monthly',
        status: 'ACTIVE',
        paymentStatus: 'PAID',
        purchasedAt: new Date(now.getTime() - 250 * 24 * 60 * 60 * 1000), // 250 days ago
        activatedAt: new Date(now.getTime() - 250 * 24 * 60 * 60 * 1000)
      }
    ];

    for (const nftData of dummyNfts) {
      const nft = new UserHorseNft(nftData);
      await nft.save();
      console.log(`Created Horse NFT: ${nft.displayName}, Price: ${nft.purchasePriceUSDT}, Date: ${nft.purchasedAt.toDateString()}`);
    }

    console.log('Successfully seeded dummy Horse NFTs!');

  } catch (error) {
    console.error('Error seeding dummy Horse NFTs:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  }
};

seedDummyHorseNft();
