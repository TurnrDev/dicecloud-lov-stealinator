/* Read-only batch exporter for DiceCloud library-collection manifests. */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { COMPLETE_NODE_FIELDS } = require('./export-dicecloud-library');

const CDP_URL = process.env.DICECLOUD_CDP_URL || 'http://127.0.0.1:9222';
const manifests = process.argv.slice(2);
if (!manifests.length) throw new Error('Usage: node tools/export-dicecloud-library-collections.js <collection-manifest.json> [...]');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function exportLibrary(page, libraryId) {
  await page.goto(`https://dicecloud.com/library/${libraryId}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof Meteor !== 'undefined' && typeof Mongo !== 'undefined', { timeout: 30000 });
  return page.evaluate(async ({ libraryId, fields }) => {
    const collection = name => Mongo.Collection.getAll().find(item => item.name === name)?.instance;
    const libraries = collection('libraries');
    const nodes = collection('libraryNodes');
    const until = (condition, message) => new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (condition()) return resolve();
        if (Date.now() - started > 120000) return reject(new Error(message));
        setTimeout(check, 100);
      };
      check();
    });
    await until(() => libraries?.findOne(libraryId) && nodes?.find().count() > 0, `Route did not load library ${libraryId}`);
    const handle = Meteor.subscribe('libraryNodes', libraryId, fields);
    await until(() => handle.ready(), `Complete-field subscription did not become ready for ${libraryId}`);
    await new Promise(resolve => setTimeout(resolve, 150));
    const library = libraries.findOne(libraryId);
    const libraryNodes = nodes.find({}, { sort: { left: 1, order: 1 } }).fetch();
    if (!library || !libraryNodes.length) throw new Error(`Incomplete export for ${libraryId}`);
    return { format: 'dicecloud-library-export/v1', exportedAt: new Date().toISOString(), completeNodeFields: fields, library, libraryNodes };
  }, { libraryId, fields: COMPLETE_NODE_FIELDS });
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const page = browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes('dicecloud.com'));
  if (!page) throw new Error('No DiceCloud page exists in the CDP browser session.');
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const outputDir = path.join('exports', 'libraries-of-vexus', manifest.collection._id);
    await fs.mkdir(outputDir, { recursive: true });
    const results = [];
    for (const entry of manifest.libraries) {
      const output = path.join(outputDir, `${entry.id}.json`);
      try {
        const snapshot = await exportLibrary(page, entry.id);
        await fs.writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
        results.push({ id: entry.id, name: snapshot.library.name, nodeCount: snapshot.libraryNodes.length, output, status: 'ok' });
        console.log(`exported ${entry.id}: ${snapshot.libraryNodes.length} nodes`);
      } catch (error) {
        results.push({ id: entry.id, name: entry.library?.name, status: 'error', error: String(error.message || error) });
        console.error(`failed ${entry.id}: ${error.message || error}`);
      }
      await wait(250);
    }
    await fs.writeFile(path.join(outputDir, 'export-manifest.json'), `${JSON.stringify({ collection: manifest.collection, results }, null, 2)}\n`);
    console.log(`completed collection ${manifest.collection._id}: ${results.filter(result => result.status === 'ok').length}/${results.length} libraries exported`);
  }
  // With CDP, close disconnects this client; it does not terminate the
  // externally owned Chromium process. It lets Node exit cleanly.
  await browser.close();
  console.log('Batch export complete. All manifests have been written.');
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
