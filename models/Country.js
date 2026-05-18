const mongoose = require('mongoose');

const CountrySchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., 'AFGHANISTAN'
  nicename: { type: String, required: true }, // e.g., 'Afghanistan'
  iso: { type: String, required: true, unique: true }, // e.g., 'AF'
  iso3: { type: String },
  numcode: { type: Number },
  phonecode: { type: Number, required: true }, // e.g., 93
  status: { type: Number, default: 1 },
  dial_code: { type: String },
  flag: { type: String },
  id: { type: Number }
}, {
  collection: 'countries',
  strict: false
});

module.exports = mongoose.model('Country', CountrySchema); 
