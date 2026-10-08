/* Emit a reviewed Mongo shell restore program for all locally held LoV exports. */
const fs = require('node:fs/promises');
const path = require('node:path');

const [username, option] = process.argv.slice(2);
if (!username) throw new Error('Usage: node tools/emit-local-batch-restore.js <local-username> [--replace|--dry-run]');
const mode = option || '--dry-run';
if (!['--replace', '--dry-run'].includes(mode)) throw new Error('Expected --replace or --dry-run.');
const root = path.resolve(__dirname, '..');
const collectionIds = ['jp6xTaHDZK4ELYzvN', '5EKp4S55tDzRivSLn'];

function modernizeTree(rawNodes, libraryId) {
  const nodes = rawNodes.map(raw => {
    const node = { ...raw, root: { collection: 'libraries', id: libraryId } };
    if (raw.parent?.collection === 'libraryNodes') node.parentId = raw.parent.id;
    else delete node.parentId;
    return node;
  });
  const ids = new Set(nodes.map(node => node._id));
  const children = new Map();
  for (const node of nodes) {
    if (node.parentId && !ids.has(node.parentId)) throw new Error(`${libraryId}: dangling parent ${node.parentId}`);
    const key = node.parentId || '__root__';
    const siblings = children.get(key) || [];
    siblings.push(node); children.set(key, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  let counter = 0;
  const visit = node => { node.left = ++counter; for (const child of children.get(node._id) || []) visit(child); node.right = ++counter; };
  for (const node of children.get('__root__') || []) visit(node);
  if (counter !== nodes.length * 2) throw new Error(`${libraryId}: disconnected or cyclic tree`);
  return nodes;
}

function libraryForLocal(snapshot) {
  const library = { ...snapshot.library, writers: [], readers: [] };
  delete library.subscriberCount;
  delete library.showInMarket;
  return library;
}

async function main() {
  const collections = [];
  for (const id of collectionIds) {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'exports', `dicecloud-library-collection-${id}.json`), 'utf8'));
    const libraries = [];
    for (const entry of manifest.libraries) {
      const file = path.join(root, 'exports', 'libraries-of-vexus', id, `${entry.id}.json`);
      const snapshot = JSON.parse(await fs.readFile(file, 'utf8'));
      libraries.push({ library: libraryForLocal(snapshot), libraryNodes: modernizeTree(snapshot.libraryNodes, entry.id) });
    }
    const collection = { ...manifest.collection, writers: [], readers: [] };
    delete collection.subscriberCount;
    delete collection.showInMarket;
    collections.push({ collection, libraries });
  }
  const libraryCount = collections.reduce((total, item) => total + item.libraries.length, 0);
  const nodeCount = collections.reduce((total, item) => total + item.libraries.reduce((n, lib) => n + lib.libraryNodes.length, 0), 0);
  if (mode === '--dry-run') {
    console.log(JSON.stringify({ mode, collections: collections.map(item => ({ id: item.collection._id, name: item.collection.name, libraries: item.libraries.length })), libraryCount, nodeCount }, null, 2));
    return;
  }
  console.log('// Generated local-only DiceCloud restore. Existing LoV data is replaced.');
  console.log(`const restoreUser = db.users.findOne({ username: ${JSON.stringify(username)} });`);
  console.log(`if (!restoreUser) throw new Error('Local user not found: ${username}');`);
  for (const item of collections) {
    for (const entry of item.libraries) {
      const payload = JSON.stringify(entry);
      console.log(`{ const payload = ${payload};`);
      console.log(`db.libraryNodes.deleteMany({ $or: [{ 'root.id': payload.library._id }, { 'ancestors.id': payload.library._id }, { 'parent.id': payload.library._id }] });`);
      console.log(`db.libraries.deleteOne({ _id: payload.library._id });`);
      console.log(`payload.library.owner = restoreUser._id; db.libraries.insertOne(payload.library); db.libraryNodes.insertMany(payload.libraryNodes, { ordered: true });`);
      console.log(`db.users.updateOne({ _id: restoreUser._id }, { $addToSet: { subscribedLibraries: payload.library._id } }); }`);
    }
    const collection = JSON.stringify(item.collection);
    console.log(`{ const collection = ${collection}; db.libraryCollections.deleteOne({ _id: collection._id }); collection.owner = restoreUser._id; db.libraryCollections.insertOne(collection); db.users.updateOne({ _id: restoreUser._id }, { $addToSet: { subscribedLibraryCollections: collection._id } }); }`);
  }
  console.log(`print('Restored ${libraryCount} libraries and ${nodeCount} nodes into two local collections.');`);
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
