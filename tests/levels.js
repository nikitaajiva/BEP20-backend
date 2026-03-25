(() => {
    // 1) explicitly point at the copy
    const copyDB   = db.getSiblingDB("xrp2");
    const levels   = copyDB.getCollection("levels");
    const ledgers  = copyDB.getCollection("ledgers");
    const users    = copyDB.getCollection("users");
    const LIMIT    = 16;
  
    // 2) find out how many parents we'll touch
    const parents = levels.distinct("parent", { level: { $lte: LIMIT } });
    const total   = parents.length;
    print(`🔍 Will update ${total} users’ totalTeamLp on '${copyDB.getName()}'…`);
  
    // 3) build the aggregation cursor
    const cursor = levels.aggregate([
      { $match: { level: { $lte: LIMIT } } },
      { $lookup: {
          from:     "ledgers",
          localField:  "child",
          foreignField:"uhid",
          pipeline: [ { $project: { lp: "$wallets.lp" } } ],
          as:       "ledger"
      }},
      { $unwind: "$ledger" },
      { $group: {
          _id:         "$parent",
          totalTeamLp: { $sum: "$ledger.lp" }
      }},
      { $project: {
          _id:         0,
          uhid:        "$_id",
          totalTeamLp: 1
      }}
    ], { allowDiskUse: true });
  
    // 4) iterate, update one-by-one, and log each
    let count = 0;
    cursor.forEach(doc => {
      const res = users.updateOne(
        { uhid: doc.uhid },
        { $set: { "counters.totalTeamLp": doc.totalTeamLp } }
      );
      count++;
      print(`✅ ${count}/${total} — uhid=${doc.uhid} (matched: ${res.matchedCount}, modified: ${res.modifiedCount})`);
    });
  
    print(`\n🎉 Done! Updated ${count} users in total.`);
  })();
  