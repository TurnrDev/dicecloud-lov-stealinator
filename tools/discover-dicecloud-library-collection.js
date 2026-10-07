/* Read-only inventory of a DiceCloud library collection through existing CDP. */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

const CDP_URL = process.env.DICECLOUD_CDP_URL || 'http://127.0.0.1:9222';
const COLLECTION_ID = process.argv[2];
if (!COLLECTION_ID) throw new Error('Usage: node tools/discover-dicecloud-library-collection.js <collection-id>');
const OUTPUT = process.argv[3] || path.join('exports', `dicecloud-library-collection-${COLLECTION_ID}.json`);

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const page = browser.contexts().flatMap(context => context.pages())
    .find(candidate => candidate.url().includes('dicecloud.com'));
  if (!page) throw new Error('No DiceCloud page exists in the CDP browser session.');

  await page.goto(`https://dicecloud.com/library-collection/${COLLECTION_ID}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof Meteor !== 'undefined' && typeof Mongo !== 'undefined');

  const inventory = await page.evaluate(async collectionId => {
    const getCollection = name => Mongo.Collection.getAll()
      .find(collection => collection.name === name)?.instance;
    const collections = getCollection('libraryCollections');
    const libraries = getCollection('libraries');
    if (!collections || !libraries) throw new Error('Library Minimongo collections are unavailable.');

    const handle = Meteor.subscribe('libraryCollection', collectionId);
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        if (handle.ready()) return resolve();
        if (Date.now() - startedAt > 30000) return reject(new Error('libraryCollection subscription timed out.'));
        setTimeout(check, 50);
      };
      check();
    });

    const libraryCollection = collections.findOne(collectionId);
    if (!libraryCollection) throw new Error(`Library collection ${collectionId} was not published.`);
    const ids = libraryCollection.libraries || [];
    const libraryDocs = libraries.find({ _id: { $in: ids } }).fetch();
    const byId = new Map(libraryDocs.map(library => [library._id, library]));
    return {
      collection: libraryCollection,
      libraries: ids.map((id, position) => ({ position, id, library: byId.get(id) || null })),
      missingLibraryMetadata: ids.filter(id => !byId.has(id)),
    };
  }, COLLECTION_ID);

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(JSON.stringify({ output: path.resolve(OUTPUT), libraries: inventory.libraries.length, missingLibraryMetadata: inventory.missingLibraryMetadata.length }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
