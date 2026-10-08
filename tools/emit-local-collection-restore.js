/* Emit the small collection-metadata portion after individual libraries restore. */
const fs = require('node:fs/promises');
const path = require('node:path');
const [manifestPath, username] = process.argv.slice(2);
if (!manifestPath || !username) throw new Error('Usage: node tools/emit-local-collection-restore.js <manifest.json> <local-username>');
async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const collection = { ...manifest.collection, writers: [], readers: [] };
  delete collection.subscriberCount; delete collection.showInMarket;
  console.log(`const user = db.users.findOne({ username: ${JSON.stringify(username)} });`);
  console.log(`if (!user) throw new Error('Local user not found');`);
  console.log(`const collection = ${JSON.stringify(collection)};`);
  console.log(`db.libraryCollections.deleteOne({ _id: collection._id }); collection.owner = user._id; db.libraryCollections.insertOne(collection);`);
  console.log(`db.users.updateOne({ _id: user._id }, { $addToSet: { subscribedLibraryCollections: collection._id } });`);
  console.log(`print('Restored collection: ' + collection.name);`);
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
