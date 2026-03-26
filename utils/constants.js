// ROI rate slabs configuration
const ROI_SLABS = [
    {minBalance: 9, rate: 0.005},      // 0.3%
    {minBalance: 1000, rate: 0.005},   // 0.4%
    {minBalance: 5000, rate: 0.006},   // 0.5%
    {minBalance: 11000, rate: 0.006}   // 0.6%
];

// Helper function to get ROI rate for a given balance
const getRoiRate = (balance) => {
    let applicableRate = 0;
    for (const slab of ROI_SLABS) {
        if (balance >= slab.minBalance) {
            applicableRate = slab.rate;
        }
    }
    return applicableRate;
};

// Helper function to get ROI slab info for a given balance
const getRoiSlabInfo = (balance) => {
    let applicableSlab = null;
    for (const slab of ROI_SLABS) {
        if (balance >= slab.minBalance) {
            applicableSlab = slab;
        }
    }
    return applicableSlab;
};

const LEDGER_EVENT_TYPE = {
    BOOST_REWARD: 'boost_reward',
    POSITIONING_BONUS: 'positioning_bonus',
    DIFFERENTIAL_CASCADE: 'differential_cascade',
    COMMUNITY_POSITIONING_BONUS: 'community_positioning_bonus',
};

const USER_STATUS = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    PENDING: 'pending'
};

module.exports = {
    ROI_SLABS,
    getRoiRate,
    getRoiSlabInfo,
    LEDGER_EVENT_TYPE,
    USER_STATUS
};