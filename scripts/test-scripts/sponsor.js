const { MongoClient } = require('mongodb');

async function run() {
  const uri = 'mongodb://localhost:27017'; // Change if needed
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('xrpmigrate');

    const usersCol = db.collection('users');
    const levelsCol = db.collection('levels');

    const uhids = [
      '86000786',
      '1749362676',
      '1749460306',
      '1749460551',
      '1749460613',
      '1749469027'
    ];

    const ROOT_UHID = '786000786';

    for (const startUhid of uhids) {
      const startUser = await usersCol.findOne({ uhid: startUhid });
      if (!startUser || !startUser.sponsorId) {
        
        continue;
      }

      let childUhid = startUser.uhid;
      let currentUser = startUser;
      let level = 1;

      while (currentUser && currentUser.sponsorId) {
        const sponsor = await usersCol.findOne({ _id: currentUser.sponsorId });
        if (!sponsor || !sponsor.uhid) {
          
          break;
        }

        const parentUhid = sponsor.uhid;

        const existing = await levelsCol.findOne({ parent: parentUhid, child: childUhid });

        if (existing) {
          if (existing.level !== level) {
            
          } else {
            
          }
        } else {
          const now = new Date();
          const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);

          await levelsCol.insertOne({
            id: String(level),
            timestamp,
            child: childUhid,
            level,
            status: '1',
            parent: parentUhid
          });

          
        }

        if (parentUhid === ROOT_UHID) {
          break;
        }

        childUhid = parentUhid;
        currentUser = sponsor;
        level++;
      }
    }
  } catch (error) {
    console.error('Error running sponsor script:', error);
  } finally {
    await client.close();
  }
}

run();  
