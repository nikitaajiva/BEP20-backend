const { MongoClient } = require('mongodb');

async function run() {
  const uri = 'mongodb://localhost:27017'; // Change if needed
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('xrpmigrate');
    const users = db.collection('users');

    const cursor = users.find({}, { noCursorTimeout: true });

    for await (const user of cursor) {
      if (Number(user.uhid) < 17498803170) {
        const levels = db.collection('levels');

        const childUhid = user.uhid;   // keep original child uhid constant
        let level = 1;                 // start with direct sponsor
        let currentSponsorId = user.sponsorId; // first ancestor

        while (currentSponsorId) {
          // fetch sponsor user document
          const sponsorUser = await users.findOne({ _id: currentSponsorId });
          if (!sponsorUser) break; // stop if data is missing

          const parentUhid = sponsorUser.uhid;

          // check if level entry already exists
          const existing = await levels.findOne({ parent: parentUhid, child: childUhid });
          if (!existing) {
            await levels.insertOne({
              timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
              child: childUhid,
              level: level,
              status: '1',
              parent: parentUhid,
            });
            
          }
          else {
            
          }
          // stop at root uhid or if sponsor has no further sponsor
          if (parentUhid === '786000786') break;

          currentSponsorId = sponsorUser.sponsorId;
          level += 1;
        }
      }
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    // Wait a bit to ensure all async logs finish (since forEach is async)
    setTimeout(() => client.close(), 3000);
  }
}

run();
