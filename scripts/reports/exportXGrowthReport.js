"use strict";

/**
 * scripts/reports/exportXGrowthReport.js
 * 
 * Comprehensive Audit with Individual Leg Breakdowns (L1 to L5+).
 * Shows individual leg performance while maintaining the 1/3 capped math.
 * Removed individual capped columns as requested.
 */

const mongoose = require("mongoose");
const path = require("path");
const ExcelJS = require("exceljs");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const User = require("../../models/User");
const Level = require("../../models/Level");
const DailyUserLp = require("../../models/DailyUserLp");

const X_TIERS = [
    { code: "X",  totalReq: 500,   rate: 0.10, level: 0 },
    { code: "X1", totalReq: 1000,  rate: 0.20, level: 1 },
    { code: "X2", totalReq: 3000,  rate: 0.25, level: 2 },
    { code: "X3", totalReq: 5000,  rate: 0.30, level: 3 },
    { code: "X4", totalReq: 10000, rate: 0.40, level: 4 },
    { code: "X5", totalReq: 15000, rate: 0.50, level: 5 },
];

const MAX_TOTAL_RATE = 0.50;

const d2n = (v) => {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    if (v.$numberDecimal) return parseFloat(v.$numberDecimal);
    return parseFloat(v.toString()) || 0;
};

async function run() {
    const inputDate = process.argv[2] || new Date().toISOString().split("T")[0];
    await mongoose.connect(process.env.MONGODB_URI);

    const todayDate = new Date(inputDate);
    todayDate.setUTCHours(0,0,0,0);
    const pastDate = new Date(todayDate);
    pastDate.setDate(pastDate.getDate() - 7);

    console.log(`📊 Generating Detailed Leg Report: ${todayDate.toISOString().slice(0, 10)}`);

    const [allUsers, allLevels, todayLps, pastLps] = await Promise.all([
        User.find({}, { uhid: 1, username: 1, xRank: 1, xrank: 1 }).lean(),
        Level.find({}).lean(),
        DailyUserLp.find({ date: todayDate }).lean(),
        DailyUserLp.find({ date: pastDate }).lean(),
    ]);

    const todayLpMap = new Map(todayLps.map(l => [l.uhid, d2n(l.lp)]));
    const pastLpMap = new Map(pastLps.map(l => [l.uhid, d2n(l.lp)]));
    const parentToChildren = new Map();
    const childToParent = new Map();
    for(const l of allLevels) {
        if(!parentToChildren.has(l.parent)) parentToChildren.set(l.parent, []);
        parentToChildren.get(l.parent).push(l.child);
        childToParent.set(l.child, l.parent);
    }

    const growthMap = new Map();
    for (const u of allUsers) {
        growthMap.set(u.uhid, (todayLpMap.get(u.uhid) || 0) - (pastLpMap.get(u.uhid) || 0));
    }

    const aggGrowthMemo = new Map(), aggVolumeTodayMemo = new Map(), aggVolumePastMemo = new Map(), depthMemo = new Map();

    function getAggregatedGrowth(uhid) {
        if(aggGrowthMemo.has(uhid)) return aggGrowthMemo.get(uhid);
        const children = parentToChildren.get(uhid) || [];
        let totalG = growthMap.get(uhid) || 0;
        for (const child of children) totalG += getAggregatedGrowth(child);
        aggGrowthMemo.set(uhid, totalG);
        return totalG;
    }

    function getAggregatedVolume(uhid, dateMap, memo) {
        if(memo.has(uhid)) return memo.get(uhid);
        const children = parentToChildren.get(uhid) || [];
        let totalV = dateMap.get(uhid) || 0;
        for (const child of children) totalV += getAggregatedVolume(child, dateMap, memo);
        memo.set(uhid, totalV);
        return totalV;
    }

    function getDepth(uhid) {
        if(depthMemo.has(uhid)) return depthMemo.get(uhid);
        const children = parentToChildren.get(uhid) || [];
        let max = 0;
        for (const child of children) max = Math.max(max, getDepth(child) + 1);
        depthMemo.set(uhid, max);
        return max;
    }

    const leaders = allUsers.filter(u => u.xRank || u.xrank);
    const reportData = [];

    for (const leader of leaders) {
        const selfGrowth = growthMap.get(leader.uhid) || 0;
        const children = parentToChildren.get(leader.uhid) || [];
        
        const teamToday = getAggregatedVolume(leader.uhid, todayLpMap, aggVolumeTodayMemo);
        const teamPast = getAggregatedVolume(leader.uhid, pastLpMap, aggVolumePastMemo);
        
        const legGrowths = children.map(cUhid => getAggregatedGrowth(cUhid)).sort((a,b) => b-a);
        
        // Individual Leg Growth (Raw)
        const l1 = legGrowths[0] || 0;
        const l2 = legGrowths[1] || 0;
        const l3 = legGrowths[2] || 0;
        const l4 = legGrowths[3] || 0;
        const l5 = legGrowths[4] || 0;
        const othersSumRaw = legGrowths.slice(2).reduce((s,g) => s+g, 0);

        const rankStr = (leader.xRank || leader.xrank || "X").toUpperCase();
        const tier = X_TIERS.find(t => t.code === rankStr) || X_TIERS[0];
        const cap = tier.totalReq / 3;

        // --- Capped Calculation (Required for eligibility, but not shown in columns) ---
        const cappedL1 = Math.min(l1, cap);
        const cappedL2 = Math.min(l2, cap);
        const cappedOthers = Math.min(othersSumRaw, cap); 
        const cappedTotalBiz = cappedL1 + cappedL2 + cappedOthers;

        const eligible = cappedTotalBiz >= tier.totalReq;

        let qRank = "NONE", qRate = 0;
        for (const t of X_TIERS) {
            const tCap = t.totalReq / 3;
            if (Math.min(l1, tCap) + Math.min(l2, tCap) + Math.min(othersSumRaw, tCap) >= t.totalReq) {
                qRank = t.code; qRate = t.rate;
            } else break;
        }

        reportData.push({
            uhid: leader.uhid, username: leader.username, rank: rankStr, rankLvl: tier.level,
            levels: getDepth(leader.uhid), legCount: children.length,
            teamToday, teamPast, totalGrowth: teamToday - teamPast,
            l1, l2, l3, l4, l5, 
            cappedTotalBiz,
            bonus: 0, retention: 0, eligible: eligible ? "YES" : "NO", qRate, qRank
        });
    }

    reportData.sort((a,b) => a.rankLvl - b.rankLvl);

    // Simulation
    const leaderMap = new Map(reportData.map(r => [r.uhid, r]));
    const events = Array.from(growthMap.entries()).filter(e => e[1] !== 0);
    for (const [uhid, growth] of events) {
        const absG = Math.abs(growth), isRet = growth < 0;
        let curr = uhid, dist = 0, prevR = 0;
        while(childToParent.has(curr) && dist < MAX_TOTAL_RATE) {
            const pUhid = childToParent.get(curr);
            const p = leaderMap.get(pUhid);
            if(p && p.eligible === "YES") {
                const diff = Math.max(0, p.qRate - prevR);
                if(diff > 0) {
                    const amount = absG * Math.min(diff, MAX_TOTAL_RATE - dist);
                    if(isRet) p.retention += amount; else p.bonus += amount;
                    dist += Math.min(diff, MAX_TOTAL_RATE - dist);
                    prevR = p.qRate;
                }
            }
            curr = pUhid;
        }
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("X Growth Audit");
    sheet.columns = [
        { header: "Leader UHID", key: "uhid", width: 18 },
        { header: "Username", key: "username", width: 18 },
        { header: "Rank", key: "rank", width: 8 },
        { header: "Levels", key: "levels", width: 8 },
        { header: "Total Legs", key: "legCount", width: 10 },
        { header: "Team LP Today", key: "teamToday", width: 18 },
        { header: "Team LP Past", key: "teamPast", width: 18 },
        { header: "Net Business (Growth)", key: "totalGrowth", width: 18 },
        { header: "Leg 1 Growth", key: "l1", width: 15 },
        { header: "Leg 2 Growth", key: "l2", width: 15 },
        { header: "Leg 3 Growth", key: "l3", width: 15 },
        { header: "Leg 4 Growth", key: "l4", width: 15 },
        { header: "Leg 5 Growth", key: "l5", width: 15 },
        { header: "Total Capped Biz", key: "cappedTotalBiz", width: 15 },
        { header: "X Bonus Earned", key: "bonus", width: 15 },
        { header: "Retention", key: "retention", width: 15 },
        { header: "Eligible?", key: "eligible", width: 10 }
    ];

    sheet.getRow(1).font = { bold: true };
    reportData.forEach(r => {
        const row = sheet.addRow({
            ...r,
            teamToday: r.teamToday.toFixed(2), teamPast: r.teamPast.toFixed(2), totalGrowth: r.totalGrowth.toFixed(2),
            l1: r.l1.toFixed(2), l2: r.l2.toFixed(2), l3: r.l3.toFixed(2), l4: r.l4.toFixed(2), l5: r.l5.toFixed(2),
            cappedTotalBiz: r.cappedTotalBiz.toFixed(2),
            bonus: r.bonus.toFixed(6), retention: r.retention.toFixed(6)
        });
        if(r.eligible === "NO") row.getCell(17).font = { color: { argb: 'FFFF0000' } };
    });

    const filename = `Clean_Leg_Audit_${Date.now()}.xlsx`;
    await workbook.xlsx.writeFile(filename);
    console.log(`✅ File Saved: ${filename}`);
    await mongoose.disconnect();
}
run();