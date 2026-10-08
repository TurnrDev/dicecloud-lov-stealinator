/*
 * Read-only DiceCloud library exporter.
 *
 * Connects to an already-running Chromium instance; it never calls a Meteor
 * method or modifies a Minimongo collection. The only server operation is the
 * documented `library` / `libraryNodes` subscription.
 */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

const CDP_URL = process.env.DICECLOUD_CDP_URL || 'http://127.0.0.1:9222';
const LIBRARY_ID = process.argv[2];
const OUTPUT = process.argv[3] || path.join(
  'exports', `dicecloud-library-${LIBRARY_ID}.json`
);
const USE_LOADED_ROUTE = process.argv.includes('--loaded');

// Union of every persisted, top-level LibraryNode field in the source schemas.
// A Mongo projection of a top-level object includes all of its descendants, so
// this is deliberately top-level rather than a lossy leaf-field projection.
// The tree fields are included by the publication itself; retaining them here
// documents the complete export contract and also covers legacy tree records.
const COMPLETE_NODE_FIELDS = [
  '_id', 'type', 'name', 'summary', 'description', 'tags', 'icon', 'color',
  'root', 'parentId', 'left', 'right', 'removed', 'removedAt', 'removedWith',
  'order', 'parent', 'ancestors',
  'fillSlots', 'searchable', 'libraryTags', 'slotFillerType', 'slotFillImage',
  'slotQuantityFilled', 'slotFillerCondition', 'slotFillerConditionNote',
  'actionType', 'variableName', 'target', 'attackRoll', 'uses', 'usesUsed',
  'reset', 'resources', 'silent',
  'amount', 'stat', 'operation', 'attributeType', 'hitDiceSize',
  'spellSlotLevel', 'healthBarColorMid', 'healthBarColorLow',
  'healthBarNoDamage', 'healthBarNoHealing', 'healthBarNoDamageOverflow',
  'healthBarNoHealingOverflow', 'healthBarDamageOrder', 'healthBarHealingOrder',
  'baseValue', 'damage', 'decimal', 'ignoreLowerLimit', 'ignoreUpperLimit',
  'hideWhenTotalZero', 'hideWhenValueZero',
  'branchType', 'text', 'condition', 'targetParentBuff', 'removeAll',
  'targetTags', 'targetByTags', 'targetField', 'extraTags', 'hideRemoveButton', 'duration', 'skipCrystalization',
  'level', 'slotTags', 'slotCondition', 'calculation', 'errors', 'carried',
  'contentsWeightless', 'weight', 'value', 'picture', 'avatarPicture',
  'damageTypes', 'excludeTags', 'includeTags', 'damageType', 'save', 'stats',
  'groupStats', 'hideStatsGroup', 'tab', 'location', 'plural', 'quantity',
  'requiresAttunement', 'attuned', 'showIncrement', 'equipped', 'ammoTriggerIds',
  'ignored', 'values', 'min', 'max', 'total', 'cost', 'ref', 'cache', 'roll',
  'dc', 'ability', 'skillType', 'baseProficiency', 'slotType', 'quantityExpected',
  'hideWhenFull', 'unique', 'maxPrepared', 'attackRollBonus', 'alwaysPrepared',
  'prepared', 'castWithoutSpellSlots', 'hasAttackRoll', 'castingTime', 'range',
  'verbal', 'somatic', 'concentration', 'material', 'ritual', 'school', 'showUI',
  'disabled', 'enabled', 'event', 'actionPropertyType', 'timing',
];

async function main() {
  if (!LIBRARY_ID) {
    throw new Error('Usage: node tools/export-dicecloud-library.js <library-id> [output.json] [--loaded]');
  }
  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    const page = pages.find(candidate => candidate.url().includes('dicecloud.com'));
    if (!page) throw new Error('No DiceCloud page exists in the CDP browser session.');

    // This is normal browser navigation, not a data mutation. It establishes
    // the public library's ordinary subscriptions before the extra read-only one.
    if (!USE_LOADED_ROUTE) {
      // Always reload the target route. A matching URL can still be a stale
      // Meteor client whose route subscriptions were never mounted.
      // `commit` avoids waiting forever on the app's long-lived resources;
      // readiness is checked from Minimongo below.
      await page.goto(`https://dicecloud.com/library/${LIBRARY_ID}`, { waitUntil: 'commit' });
    }
    await page.waitForFunction(() => typeof Meteor !== 'undefined' && typeof Mongo !== 'undefined');
    // The Vue route creates the ordinary `libraryNodes` subscription after it
    // mounts. Wait for it before layering the wider projection, rather than
    // racing application hydration.
    if (!USE_LOADED_ROUTE) {
      // Keep the readiness wait in the page's Meteor realm. This avoids a
      // Playwright argument-overload issue and, crucially, means the normal
      // route subscription and the wider subscription below share one CDP
      // connection and one Minimongo lifetime.
      await page.evaluate(({ timeoutMs }) => new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const check = () => {
          const nodes = Mongo.Collection.getAll()
            .find(collection => collection.name === 'libraryNodes')?.instance;
          // The deployed client currently publishes its restricted normal tree
          // with legacy `parent`/`ancestors` fields and without `root`. The
          // single-library route owns this collection while it is open.
          if (nodes?.find({}).count() > 0) {
            resolve();
            return;
          }
          if (Date.now() - startedAt >= timeoutMs) {
            reject(new Error(`Normal library tree did not load within ${timeoutMs}ms.`));
            return;
          }
          setTimeout(check, 100);
        };
        check();
      }), { timeoutMs: 120000 });
    }

    const snapshot = await page.evaluate(async ({ libraryId, fields }) => {
      const collections = new Map(
        Mongo.Collection.getAll().map(collection => [collection.name, collection.instance])
      );
      const libraries = collections.get('libraries');
      const libraryNodes = collections.get('libraryNodes');
      if (!libraries || !libraryNodes) throw new Error('Required Minimongo collections are unavailable.');

      const ready = handle => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Subscription timed out after 20 seconds')), 20000);
        const check = () => {
          if (handle.ready()) {
            clearTimeout(timeout);
            return resolve();
          }
          setTimeout(check, 25);
        };
        check();
      });

      const libraryHandle = Meteor.subscribe('library', libraryId);
      const fullNodesHandle = Meteor.subscribe('libraryNodes', libraryId, fields);
      await Promise.all([ready(libraryHandle), ready(fullNodesHandle)]);

      const library = libraries.findOne(libraryId);
      const nodes = libraryNodes.find({}, { sort: { left: 1 } }).fetch();
      if (!library) throw new Error(`Library ${libraryId} was not published.`);
      if (!nodes.length) throw new Error(`Library ${libraryId} has no published nodes.`);

      const ids = new Set(nodes.map(node => node._id));
      const nodeReferences = [];
      const visit = (value, nodeId, fieldPath = '') => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          value.forEach((item, index) => visit(item, nodeId, `${fieldPath}[${index}]`));
          return;
        }
        // `ref` is the canonical explicit LibraryNode-to-node relationship.
        if (value.collection === 'libraryNodes' && typeof value.id === 'string') {
          nodeReferences.push({ from: nodeId, field: fieldPath, to: value.id, internal: ids.has(value.id) });
        }
        for (const [key, child] of Object.entries(value)) {
          visit(child, nodeId, fieldPath ? `${fieldPath}.${key}` : key);
        }
      };
      nodes.forEach(node => visit(node, node._id));

      return {
        format: 'dicecloud-library-export/v1',
        exportedAt: new Date().toISOString(),
        source: { libraryId, nodeCount: nodes.length, subscription: 'libraryNodes(libraryId, COMPLETE_NODE_FIELDS)' },
        completeNodeFields: fields,
        library,
        libraryNodes: nodes,
        references: {
          parentIds: nodes.flatMap(node => {
            if (node.parentId) return [{ from: node._id, to: node.parentId, internal: ids.has(node.parentId), field: 'parentId' }];
            if (node.parent?.collection === 'libraryNodes' && node.parent.id) {
              return [{ from: node._id, to: node.parent.id, internal: ids.has(node.parent.id), field: 'parent' }];
            }
            return [];
          }),
          explicitLibraryNodeRefs: nodeReferences,
        },
      };
    }, { libraryId: LIBRARY_ID, fields: COMPLETE_NODE_FIELDS });

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(JSON.stringify({ output: path.resolve(OUTPUT), library: snapshot.library.name, nodes: snapshot.libraryNodes.length, references: snapshot.references }, null, 2));
  } finally {
    // Do not call Browser.close(): this is an externally owned Chromium
    // session. Letting this short-lived CDP client disconnect naturally keeps
    // the user's browser and its Meteor subscriptions untouched.
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { COMPLETE_NODE_FIELDS };
