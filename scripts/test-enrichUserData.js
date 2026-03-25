const mongoose = require('mongoose');
const path = require('path');

const UserSchema = new mongoose.Schema({
  uhid: { type: String, unique: true, required: true },
  country: { name: String },
  cell: String
}, { strict: false, collection: 'users' });
// Re-registering model to avoid OverwriteModelError in case of multiple runs/imports
const User = mongoose.models.User || mongoose.model('User', UserSchema);


const UserSignUpSchema = new mongoose.Schema({
  uhid: String,
  cell: String,
  country: String,
}, { strict: false, collection: 'usersignups' });
const UserSignUp = mongoose.models.UserSignUp || mongoose.model('UserSignUp', UserSignUpSchema);


const CountrySchema = new mongoose.Schema({
  id: Number,
  name: String,
}, { strict: false, collection: 'countries' });
const Country = mongoose.models.Country || mongoose.model('Country', CountrySchema);


async function testEnrichUserData() {
  console.log('Starting user data enrichment test for 10 users...');

  // 1. Create a pipeline to find 10 eligible users and their new data
  const enrichmentPipeline = [
    { $match: { 'cell': { $exists: true, $ne: '' }, 'country': { $exists: true, $ne: null, $ne: '' } } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'countries',
        let: { country_code_str: '$country' },
        pipeline: [
          { $match: { $expr: { $eq: ['$id', { $toInt: '$$country_code_str' }] } } },
          { $project: { _id: 0, name: 1 } }
        ],
        as: 'countryInfo'
      }
    },
    { $match: { 'countryInfo': { $ne: [] } } },
    { $unwind: '$countryInfo' },
    {
        $project: {
            _id: 0,
            uhid: '$uhid',
            cell: '$cell',
            countryName: '$countryInfo.name'
        }
    }
  ];

  const usersToUpdate = await UserSignUp.aggregate(enrichmentPipeline);

  if (usersToUpdate.length === 0) {
    console.log('Could not find any users to test with. Please check your `usersignups` data.');
    return;
  }

  const uhids = usersToUpdate.map(u => u.uhid);
  console.log(`Found ${usersToUpdate.length} users to test. UHIDs:`, uhids);
  
  // 2. Fetch and log the "before" state
  const usersBefore = await User.find({ uhid: { $in: uhids } }).select('uhid country cell');
  console.log('\n--- DATA BEFORE UPDATE ---');
  console.log(usersBefore);

  // 3. Perform the update
  const bulkOps = usersToUpdate.map(user => ({
    updateOne: {
      filter: { uhid: user.uhid },
      update: {
        $set: {
          'cell': user.cell,
          'country.name': user.countryName
        }
      }
    }
  }));

  if (bulkOps.length > 0) {
    await User.bulkWrite(bulkOps);
    console.log('\nUpdate operation completed.');
  }

  // 4. Fetch and log the "after" state
  const usersAfter = await User.find({ uhid: { $in: uhids } }).select('uhid country cell');
  console.log('\n--- DATA AFTER UPDATE ---');
  console.log(usersAfter);
}


async function run() {
    const mongoURI = 'mongodb://localhost:27017/xrp2';
    try {
        await mongoose.connect(mongoURI);
        console.log('MongoDB connected successfully.');
        await testEnrichUserData();
    } catch (error) {
        console.error('Database connection or script execution failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB connection closed.');
    }
}

run(); 