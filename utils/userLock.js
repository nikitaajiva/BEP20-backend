const { Mutex } = require('async-mutex');

// Map of userId -> mutex
const mutexes = new Map();

function getUserLock(userId) {
  const key = userId.toString();
  if (!mutexes.has(key)) {
    mutexes.set(key, new Mutex());
  }
  return mutexes.get(key);
}

module.exports = {
  getUserLock
}; 