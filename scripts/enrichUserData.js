const mongoose = require('mongoose');

// --- Configuration ---
const dbName = process.argv[2] || 'xrpmigrate'; // Use 'xrpmigrate' by default or specify via command line
const mongoUrl = `mongodb://localhost:27017/${dbName}`;

// --- Mongoose Models ---
// Using `mongoose.models` to prevent OverwriteModelError in case of multiple script runs
const UserSchema = new mongoose.Schema({
  uhid: { type: String, unique: true, required: true },
  country: { name: String },
  whatsappContact: String
}, { strict: false, collection: 'users' });
const User = mongoose.models.User || mongoose.model('User', UserSchema);

const UserSignUpSchema = new mongoose.Schema({
  uhid: String,
  cell: String,
  country: String,
}, { strict: false, collection: 'usersignup' });
const UserSignUp = mongoose.models.UserSignUp || mongoose.model('UserSignUp', UserSignUpSchema);

const CountrySchema = new mongoose.Schema({
  id: Number,
  name: String,
}, { strict: false, collection: 'countries' });
const Country = mongoose.models.Country || mongoose.model('Country', CountrySchema);

// --- Main Script Logic ---

async function enrichUserData() {
  console.log('Starting user data enrichment...');

  const countries = await Country.find({});
  if (countries.length === 0) {
    console.error('The "countries" collection is empty. Please populate it first.');
    return;
  }

  const pipeline = [
    // 1. Find signup docs with a non-empty cell and country code
    {
      $match: {
        'cell': { $exists: true, $ne: '' },
        'country': { $exists: true, $ne: null, $ne: '' }
      }
    },
    // 2. Join with the countries collection
    {
      $lookup: {
        from: 'countries',
        let: { country_code_str: '$country' },
        pipeline: [
          {
            $match: {
              $expr: {
                // Safely convert country string to int for matching
                $eq: ['$id', { $toInt: '$$country_code_str' }]
              }
            }
          },
          { $project: { _id: 0, name: 1 } }
        ],
        as: 'countryInfo'
      }
    },
    // 3. Filter out signups that didn't find a matching country
    {
      $match: { 'countryInfo': { $ne: [] } }
    },
    // 4. Deconstruct the countryInfo array to a single object
    {
      $unwind: '$countryInfo'
    },
    // 5. Shape the data for the final update
    {
      $project: {
        _id: 0,
        uhid: '$uhid',
        cell: '$cell',
        countryName: '$countryInfo.name'
      }
    }
  ];

  try {
    console.log('Executing aggregation pipeline to find users to update...');
    const usersToUpdate = await UserSignUp.aggregate(pipeline);
    console.log(`Found ${usersToUpdate.length} users with valid country information to enrich.`);

    if (usersToUpdate.length === 0) {
      console.log('No users to update.');
      return;
    }

    // Prepare bulk update operations
    const bulkOps = usersToUpdate.map(user => ({
      updateOne: {
        filter: { uhid: user.uhid },
        update: {
          $set: {
            'whatsappContact': user.cell,
            'country.name': user.countryName
          }
        }
      }
    }));

    console.log(`Performing bulk update for ${bulkOps.length} users...`);
    const result = await User.bulkWrite(bulkOps);
    console.log('Bulk write result:', JSON.stringify(result, null, 2));
    console.log('Successfully enriched user data.');

  } catch (error) {
    console.error('An error occurred during the data enrichment process:', error);
    throw error;
  }
}

// --- DB Connection and Execution ---

async function run() {
  try {
    console.log(`Connecting to database: ${dbName}...`);
    await mongoose.connect(mongoUrl);
    console.log('MongoDB connected successfully.');
    
    await enrichUserData();

  } catch (error) {
    console.error('\nScript execution failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nMongoDB connection closed.');
  }
}

run(); 