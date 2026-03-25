const mongoose = require('mongoose');
const moment = require('moment');
const User = require('../models/User');
const Level = require('../models/Level');
const Ledger = require('../models/Ledger');
const LedgerRow = require('../models/LedgerRow');
const CascadeReward = require('../models/CascadeReward');
const { convertToFloat } = require('../utils/decimal128Utils');

/**
 * Utility to resolve a user from _id, uhid or username.
 */
const findUserByIdentifier = async (identifier) => {
  if (!identifier) return null;
  // _id check (24 hex chars)
  if (mongoose.isValidObjectId(identifier)) {
    const byId = await User.findById(identifier).lean();
    if (byId) return byId;
  }
  // try uhid or username
  const byUhid = await User.findOne({ uhid: identifier }).lean();
  if (byUhid) return byUhid;
  const byUsername = await User.findOne({ username: identifier }).lean();
  if (byUsername) return byUsername;
  return null;
};

/**
 * Build cascade qualification table in memory once.
 */
const CASCADE_QUALIFICATION = (() => {
  // Each level (1..16) has requirements & bonusPercent
  const reqDirects = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
  const reqSelfLP   = [9,9,9,1500,1500,1500,3000,3000,3000,3000,4000,4000,4000,5000,5000,5000];
  const reqTeamLP   = [0,0,0,7500,7500,7500,150000,150000,150000,150000,30000,30000,30000,50000,50000,50000];
  const bonusPct    = [0.12,0.10,0.07,0.05,0.05,0.05,0.03,0.03,0.03,0.03,0.05,0.05,0.05,0.07,0.10,0.12];
  const table=[];
  for(let i=1;i<=16;i++){
    const useTeamLP5 = i >= 7; // Levels 7-16 use team LP from 5 levels
    table.push({ 
      level: i, 
      directs: reqDirects[i-1], 
      selfLP: reqSelfLP[i-1], 
      teamLP: reqTeamLP[i-1],
      teamLPDepth: useTeamLP5 ? 5 : 3, // Indicate whether team LP is from 3 or 5 levels
      bonusRate: bonusPct[i-1] 
    });
  }
  return table;
})();

/**
 * Aggregate team members UHIDs and usernames up to a certain depth.
 */
const getTeamUhids = async (userUhid, depth) => {
  // First get the level records
  const records = await Level.find({ parent: userUhid, level: { $gte: 1, $lte: depth } }).select('child').lean();
  const childUhids = records.map(r => r.child);
  
  // Then get the corresponding user information
  const users = await User.find({ uhid: { $in: childUhids } }).select('uhid username').lean();
  
  // Create a map for easy lookup
  const userMap = {};
  users.forEach(user => {
    userMap[user.uhid] = user.username;
  });
  
  // Return both UHID and username for each team member
  return records.map(r => ({
    uhid: r.child,
    username: userMap[r.child] || 'Unknown'
  }));
};

/**
 * Sum LP for given UHIDs.
 */
const sumTeamLp = async (uhids) => {
  if (uhids.length === 0) return { total: 0, members: [] };
  const ledgers = await Ledger.find({ uhid: { $in: uhids } }).select('uhid userId wallets.lp').lean();
  let total = 0;
  const members = ledgers.map(l => {
    const lp = convertToFloat(l.wallets.lp);
    total += lp;
    return { uhid: l.uhid, userId: l.userId, lp };
  });
  return { total, members };
};

/**
 * GET /api/bonus/summary
 * Query params: user, incomeType, date(YYYY-MM-DD)
 */
const getBonusSummary = async (req, res) => {
  try {
    const { user: identifier, incomeType = 'cascade', date } = req.query;
    if (!identifier) return res.status(400).json({ msg: 'user query param required' });
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const targetDate = date ? moment(date).startOf('day') : moment().startOf('day');
    const nextDate = moment(targetDate).add(1, 'day');

    // Direct team count
    const directCount = await Level.countDocuments({ parent: user.uhid, level: 1 });

    // Team depth 3 and 5 UHIDs
    const teamLvl3 = await getTeamUhids(user.uhid, 3);
    const teamLvl5 = await getTeamUhids(user.uhid, 5);

    const teamCount3 = teamLvl3.length;
    const teamCount5 = teamLvl5.length;

    // LP sums
    const lp3 = await sumTeamLp(teamLvl3.map(t => t.uhid));
    const lp5 = await sumTeamLp(teamLvl5.map(t => t.uhid));

    // Self LP
    const ledger = await Ledger.findOne({ _id: user._id }).select('wallets.lp').lean();
    const selfLP = ledger ? convertToFloat(ledger.wallets.lp) : 0;

    const summary = {
      user: { _id: user._id, uhid: user.uhid, username: user.username },
      counts: {
        directTeam: directCount,
        teamLvl3: teamCount3,
        teamLvl5: teamCount5
      },
      lp: {
        teamLvl3: { total: lp3.total, members: lp3.members },
        teamLvl5: { total: lp5.total, members: lp5.members }
      },
      conditions: {},
      credited: { total: 0, events: [] }
    };

    if (incomeType === 'cascade') {
      // Determine which levels are open for user (1..16) based on conditions
      const openLevels = [];
      CASCADE_QUALIFICATION.forEach(q => {
        const meetsDirects = directCount >= q.directs;
        const meetsSelfLP = selfLP >= q.selfLP;
        const meetsTeamLP = q.teamLPDepth === 3 ? lp3.total >= q.teamLP : lp5.total >= q.teamLP;
        const meets = meetsDirects && (meetsSelfLP || meetsTeamLP);
        if (meets) openLevels.push(q.level);
      });

      // Sort open levels in ascending order
      openLevels.sort((a, b) => a - b);
      
      // Get the maximum open level and its requirements
      const maxLevel = Math.max(...openLevels);
      const maxLevelReq = maxLevel > 0 ? CASCADE_QUALIFICATION[maxLevel - 1] : null;
      
      summary.conditions = {
        matrix: CASCADE_QUALIFICATION,
        openLevels: openLevels,
        required: openLevels.length > 0 
          ? `Level ${maxLevel} requirements: ${maxLevelReq.directs} directs, ${maxLevelReq.selfLP} self LP or ${maxLevelReq.teamLP} team LP (from ${maxLevelReq.teamLPDepth} levels)`
          : 'No levels open - need at least 1 direct and 9 self LP',
        actual: { 
          directs: directCount, 
          selfLP, 
          teamLP3: lp3.total,
          teamLP5: lp5.total 
        }
      };

      // Credited total for date with eventType LEVEL_CASCADE_BONUS
      const targetDate2025 = moment(targetDate).year(2025);
      const nextDate2025 = moment(nextDate).year(2025);
      
      const cascadeEvents = await CascadeReward.find({
        userId: user._id,
        createdAt: { $gte: targetDate2025.toDate(), $lt: nextDate2025.toDate() }
      })
      .populate('triggeringUserId', 'username') // Populate the triggering user to get their username
      .lean();

      const formattedEvents = cascadeEvents.map(event => ({
        ts: event.createdAt,
        amount: event.amount,
        walletFrom: event.triggeringUserId?.username || 'Unknown',
        walletTo: user.username,
        narrative: event.narrative
      }));

      summary.credited = { 
        total: cascadeEvents.reduce((sum, e) => sum + convertToFloat(e.amount), 0), 
        events: formattedEvents 
      };
    } else if (incomeType === 'levelBooster') {
      // Placeholder – similar logic can be added later
      summary.conditions = { note: 'levelBooster' };
    } else {
      summary.conditions = { note: `${incomeType} logic not implemented yet` };
    }

    return res.json(summary);
  } catch (err) {
    console.error('getBonusSummary error:', err);
    return res.status(500).json({ msg: 'Server error' });
  }
};

/**
 * GET /api/bonus/details/team?user&depth=3&page&size
 */
const getTeamDetails = async (req, res) => {
  try {
    const { user: identifier, depth = 3, page = 1, size = 25 } = req.query;
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    // Get all team members up to specified depth with their usernames
    const teamMembers = await getTeamUhids(user.uhid, Number(depth));
    
    // Get level information for each team member
    const levelInfo = await Level.find({
      child: { $in: teamMembers.map(t => t.uhid) },
      parent: user.uhid
    }).select('child level').lean();

    // Create a map of uhid to level
    const levelMap = {};
    levelInfo.forEach(info => {
      levelMap[info.child] = info.level;
    });

    // Get LP info
    const ledgers = await Ledger.find({ uhid: { $in: teamMembers.map(t => t.uhid) } })
      .select('uhid wallets.lp')
      .lean();

    // Create LP map
    const lpMap = {};
    ledgers.forEach(ledger => {
      lpMap[ledger.uhid] = convertToFloat(ledger.wallets?.lp || 0);
    });

    // Combine all information
    const members = teamMembers.map(member => ({
      username: member.username,
      uhid: member.uhid,
      level: levelMap[member.uhid] || 0,
      lp: lpMap[member.uhid] || 0
    }));

    // Calculate total LP for the response
    const totalLP = members.reduce((sum, member) => sum + member.lp, 0);

    res.json({ 
      total: teamMembers.length, 
      members,
      totalLP
    });
  } catch (err) {
    console.error('getTeamDetails error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};

/**
 * GET /api/bonus/details/events?user&incomeType&date&page&size
 */
const getEventDetails = async (req, res) => {
  try {
    const { user: identifier, incomeType = 'cascade', date, page = 1, size = 25 } = req.query;
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const targetDate = date ? moment(date).startOf('day') : moment().startOf('day');
    const nextDate = moment(targetDate).add(1, 'day');

    if (incomeType === 'cascade') {
      // Use 2025 dates for cascade rewards
      const targetDate2025 = moment(targetDate).year(2025);
      const nextDate2025 = moment(nextDate).year(2025);

      // First get all cascade rewards for this user
      const cascadeRewards = await CascadeReward.find({
        userId: user._id,
        createdAt: { $gte: targetDate2025.toDate(), $lt: nextDate2025.toDate() }
      })
      .populate('triggeringUserId', 'username uhid')
      .populate('triggeringEventId')
      .lean();

      // Get all triggering users' UHIDs
      const triggeringUhids = cascadeRewards
        .map(reward => reward.triggeringUserId?.uhid)
        .filter(uhid => uhid);

      // Get level information for each triggering user
      const levelInfo = await Level.find({
        parent: user.uhid,
        child: { $in: triggeringUhids }
      }).lean();

      // Create a map of child UHID to level
      const levelMap = {};
      levelInfo.forEach(info => {
        levelMap[info.child] = info.level;
      });

      // Add level information to each reward
      const eventsWithLevels = cascadeRewards.map(reward => ({
        ...reward,
        level: levelMap[reward.triggeringUserId?.uhid] || 'Unknown',
        ts: reward.createdAt,
        amount: reward.amount,
        depositAmount: reward.triggeringEventId?.amount,
        walletFrom: reward.triggeringUserId?.username || 'Unknown',
        rate: (parseFloat(reward.rate || 0) * 100).toFixed(0)
      }));

      // Group events by level
      const groupedEvents = eventsWithLevels.reduce((acc, event) => {
        const level = event.level;
        if (!acc[level]) {
          acc[level] = {
            events: [],
            sum: 0
          };
        }
        acc[level].events.push(event);
        acc[level].sum += parseFloat(event.amount || 0);
        return acc;
      }, {});

      return res.json({
        events: eventsWithLevels,
        groupedByLevel: groupedEvents,
        total: eventsWithLevels.length
      });
    } else if (incomeType === 'levelBooster') {
      const skip = (page - 1) * size;
      const events = await LedgerRow.find({
        userId: user._id,
        eventType: 'LEVEL_BOOSTER_BONUS',
        ts: { $gte: targetDate.toDate(), $lt: nextDate.toDate() }
      }).skip(skip).limit(Number(size)).lean();

      const total = await LedgerRow.countDocuments({
        userId: user._id,
        eventType: 'LEVEL_BOOSTER_BONUS',
        ts: { $gte: targetDate.toDate(), $lt: nextDate.toDate() }
      });

      res.json({ total, events });
    } else {
      return res.status(400).json({ msg: 'Unsupported income type' });
    }
  } catch (err) {
    console.error('Error in getEventDetails:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};

module.exports = {
  getBonusSummary,
  getTeamDetails,
  getEventDetails
}; 