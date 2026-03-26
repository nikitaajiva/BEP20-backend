const mongoose = require('mongoose');

const LevelSchema = new mongoose.Schema({
  // id: { type: String, required: true }, // Original 'id' field
  timestamp: { type: String }, // e.g., '2025-05-10 21:06:19'
  child: { type: String, required: true, index: true }, // Child's uhid
  level: { type: Number, required: true, index: true }, // Distance from parent to child
  status: { type: String }, 
  parent: { type: String, required: true, index: true } // Parent's uhid
}, { 
  timestamps: { createdAt: 'timestamp_mongoose_created', updatedAt: 'timestamp_mongoose_updated' }
});

// Composite index for the typical query in findRelation
LevelSchema.index({ parent: 1, child: 1 });

module.exports = mongoose.model('Level', LevelSchema, 'levels'); 