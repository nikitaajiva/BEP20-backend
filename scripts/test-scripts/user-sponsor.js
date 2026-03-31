const { MongoClient, ObjectId } = require('mongodb');

const uri = 'mongodb://localhost:27017'; // Replace with your MongoDB URI
const dbName = 'xrpmigrate';     // Replace with your DB name

const referrals = [
  { referred: 'trunglaika2024', sponsor: 'huy133971' },
  { referred: 'alisyedakbar1', sponsor: 'Cryptotrade2510' },
  { referred: 'vinodsahusawaipur', sponsor: 'rajkumar047752' },
  { referred: 'ajmaldhola6763', sponsor: 'Techhill902' },
  { referred: 'sanjeevmzn09', sponsor: 'parulsharma8923243300' },
  { referred: 'C9663636876', sponsor: 'dheerajsridatta2' },
  { referred: 'anujsaini872', sponsor: 'arunplc428' },
  { referred: 'ajimul5500', sponsor: 'anantabarman550083' },
  { referred: 'vk22081965', sponsor: 'cryptochamp1872' }
];

async function updateSponsorIds() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);
    const users = db.collection('users');

    for (const { referred, sponsor } of referrals) {
      const sponsorDoc = await users.findOne({ username: sponsor });
      if (!sponsorDoc) {
        console.warn(`Sponsor not found: ${sponsor}`);
        continue;
      }

      const updateResult = await users.updateOne(
        { username: referred },
        { $set: { sponsorId: sponsorDoc._id } }
      );

      if (updateResult.matchedCount === 0) {
        console.warn(`Referred user not found: ${referred}`);
      } else {
        
      }
    }
  } catch (error) {
    console.error('Error updating sponsor IDs:', error);
  } finally {
    await client.close();
  }
}

updateSponsorIds();
