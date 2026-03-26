const mongoose = require('mongoose');

const UserSignUpSchema = new mongoose.Schema({
  uhid: {
    type: String,
    required: [true, 'A UHID is required for the signup record.'],
    unique: true,
    trim: true,
  },
  country: {
    type: String,
    trim: true,
  },
  mobile: {
    type: String,
    trim: true,
  },
  // Additional fields from the signup process can be added here if needed.
}, {
  timestamps: true, // This will add `createdAt` and `updatedAt` fields.
  collection: 'usersignups', // Explicitly set the collection name.
});

module.exports = mongoose.model('UserSignUp', UserSignUpSchema); 