const HorseNftPackage = require("../Models/HorseNftPackage");

const DEFAULT_HORSE_NFT_PACKAGES = [
  {
    tierCode: "starter",
    displayName: "Starter Package",
    tierName: "Bronze",
    priceUSDT: 500,
    bonusTokens: 5000,
    annualRoiPercent: 15,
    dividendFrequency: "quarterly",
    benefits: [
      "1 Bronze-tier Horse NFT",
      "5,000 bonus Toking Tokens",
      "Up to 15% annual ROI from earnings",
      "Quarterly dividend payments",
      "Special Bronze Tier Airdrops During Major Campaigns",
    ],
    imageKey: null,
    isActive: true,
    sortOrder: 1,
  },
  {
    tierCode: "growth",
    displayName: "Growth Package",
    tierName: "Silver",
    priceUSDT: 1000,
    bonusTokens: 12000,
    annualRoiPercent: 25,
    dividendFrequency: "monthly",
    benefits: [
      "1 Silver-tier Horse NFT",
      "12,000 bonus Toking Tokens",
      "Up to 25% annual ROI from earnings",
      "Monthly dividend payments",
      "Special Silver Tier Airdrops During Major Campaigns",
      "Invitation to Tokinghoofborn Events",
    ],
    imageKey: null,
    isActive: true,
    sortOrder: 2,
  },
  {
    tierCode: "premium",
    displayName: "Premium Package",
    tierName: "Gold",
    priceUSDT: 5000,
    bonusTokens: 75000,
    annualRoiPercent: 35,
    dividendFrequency: "weekly",
    benefits: [
      "1 Gold-tier Horse NFT",
      "75,000 bonus Toking Tokens",
      "Up to 35% annual ROI from earnings",
      "Weekly dividend payments",
      "Special Gold Tier Airdrops During Major Campaigns",
      "Invitation to Tokinghoofborn Events",
      "VIP Access to Conferences where Tokinghoofborn is participating",
    ],
    imageKey: null,
    isActive: true,
    sortOrder: 3,
  },
];

const ALLOWED_TIER_CODES = new Set(["starter", "growth", "premium"]);
const ALLOWED_DIVIDEND_FREQUENCIES = new Set(["weekly", "monthly", "quarterly"]);

function sanitizeBenefits(benefits) {
  if (!Array.isArray(benefits)) {
    return [];
  }

  return benefits
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function serializeHorseNftPackage(doc) {
  if (!doc) return null;

  const obj = doc.toJSON ? doc.toJSON() : doc;
  return {
    id: obj._id?.toString?.() || obj.id || null,
    tierCode: obj.tierCode,
    displayName: obj.displayName,
    tierName: obj.tierName,
    priceUSDT: Number(obj.priceUSDT || 0),
    bonusTokens: Number(obj.bonusTokens || 0),
    annualRoiPercent: Number(obj.annualRoiPercent || 0),
    dividendFrequency: obj.dividendFrequency,
    benefits: sanitizeBenefits(obj.benefits),
    imageKey: obj.imageKey || null,
    isActive: Boolean(obj.isActive),
    sortOrder: Number(obj.sortOrder || 0),
    createdAt: obj.createdAt || null,
    updatedAt: obj.updatedAt || null,
  };
}

async function seedDefaultHorseNftPackages(session = null) {
  const packages = [];

  for (const item of DEFAULT_HORSE_NFT_PACKAGES) {
    let query = HorseNftPackage.findOneAndUpdate(
      { tierCode: item.tierCode },
      {
        $set: {
          displayName: item.displayName,
          tierName: item.tierName,
          priceUSDT: item.priceUSDT,
          bonusTokens: item.bonusTokens,
          annualRoiPercent: item.annualRoiPercent,
          dividendFrequency: item.dividendFrequency,
          benefits: item.benefits,
          imageKey: item.imageKey,
          isActive: item.isActive,
          sortOrder: item.sortOrder,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    if (session) {
      query = query.session(session);
    }

    packages.push(await query);
  }

  return packages
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(serializeHorseNftPackage);
}

async function ensureHorseNftPackagesSeeded() {
  const existingCount = await HorseNftPackage.countDocuments();
  if (existingCount > 0) {
    return false;
  }

  await seedDefaultHorseNftPackages();
  return true;
}

async function listHorseNftPackages({ activeOnly = true } = {}) {
  await ensureHorseNftPackagesSeeded();

  const query = activeOnly ? { isActive: true } : {};
  const packages = await HorseNftPackage.find(query).sort({ sortOrder: 1, createdAt: 1 });
  return packages.map(serializeHorseNftPackage);
}

async function getHorseNftPackageByTierCode(tierCode, { includeInactive = false, session = null } = {}) {
  if (!ALLOWED_TIER_CODES.has(tierCode)) {
    return null;
  }

  await ensureHorseNftPackagesSeeded();

  const query = { tierCode };
  if (!includeInactive) {
    query.isActive = true;
  }

  let findQuery = HorseNftPackage.findOne(query);
  if (session) {
    findQuery = findQuery.session(session);
  }

  return findQuery;
}

async function updateHorseNftPackage(tierCode, updates) {
  const pkg = await HorseNftPackage.findOne({ tierCode });
  if (!pkg) {
    return null;
  }

  Object.assign(pkg, updates);
  await pkg.save();
  return serializeHorseNftPackage(pkg);
}

module.exports = {
  DEFAULT_HORSE_NFT_PACKAGES,
  ALLOWED_TIER_CODES,
  ALLOWED_DIVIDEND_FREQUENCIES,
  serializeHorseNftPackage,
  sanitizeBenefits,
  seedDefaultHorseNftPackages,
  ensureHorseNftPackagesSeeded,
  listHorseNftPackages,
  getHorseNftPackageByTierCode,
  updateHorseNftPackage,
};
