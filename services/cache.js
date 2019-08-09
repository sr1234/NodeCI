const mongoose = require('mongoose');
const redis = require('redis');
const util = require('util');
const keys = require('../config/keys');

const client = redis.createClient(keys.redisUrl);
client.hget = util.promisify(client.hget);
const exec = mongoose.Query.prototype.exec; // get a reference to the existing default exec function that is defined on a mongoose query.

// Define a function that will let us
// toggle whether to cache or not cache
// a query.
mongoose.Query.prototype.cache = function(options = {}) {
  this.useCache = true; // set this property the exec function so that we can check if it's true.  If it is, we can use our cache functionality.
  this.hashKey = JSON.stringify(options.key || '');

  return this; // added this line so we can use .cache() just like any other function/method on the query object to chain with other function calls.
};

mongoose.Query.prototype.exec = async function() {
  if (!this.useCache) {
    return exec.apply(this, arguments);
  }

  // We are going to use a combination of the query and the collection
  // it is being applied to to form a unique+consistent key to use to store
  // the query and its result in the redis cache.
  // Can't just add the collection name to the original mongoose query object
  // because it would CHANGE the query itself, so we need to create a NEW object
  // for this.  That's what the below 'key' object is.
  const key = JSON.stringify(
    Object.assign({}, this.getQuery(), {
      collection: this.mongooseCollection.name
    })
  );

  // See if we have a value for 'hashKey' in redis
  const cacheValue = await client.hget(this.hashKey, key);

  // If we do, return that
  if (cacheValue) {
    const doc = JSON.parse(cacheValue);

    return Array.isArray(doc)
      ? doc.map(d => new this.model(d))
      : new this.model(doc);
  }

  // Otherwise, issue the query and store the result in redis
  const result = await exec.apply(this, arguments);

  client.hset(this.hashKey, key, JSON.stringify(result), 'EX', 10);

  return result;
};

module.exports = {
  clearHash(hashKey) {
    client.del(JSON.stringify(hashKey));
  }
};
