const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const pages = browser.contexts().flatMap(context => context.pages());
  const diagnostic = await Promise.all(pages.map(async page => ({
    url: page.url(),
    state: await page.evaluate(() => {
      if (typeof Meteor === 'undefined' || typeof Mongo === 'undefined') return { meteor: false };
      return {
        meteor: true,
        status: Meteor.status(),
        collections: Mongo.Collection.getAll().map(collection => ({
          name: collection.name,
          count: collection.instance?.find?.().count?.(),
        })),
        targetLibraryNodeCount: Mongo.Collection.getAll()
          .find(collection => collection.name === 'libraryNodes')?.instance
          .find({ 'root.id': 'WugQNXFRRvoDFJZfS' }).count(),
        libraryNodeTreeSample: Mongo.Collection.getAll()
          .find(collection => collection.name === 'libraryNodes')?.instance
          .findOne({}, { fields: { _id: 1, name: 1, root: 1, parentId: 1, left: 1, right: 1 } }),
      };
    }),
  })));
  console.log(JSON.stringify(diagnostic, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
