/*
 * First-stage import preparation. It reads raw exports and emits an
 * import-safe bundle without contacting DiceCloud or any database.
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const input = process.argv[2] || 'exports/libraries-of-vexus';
const output = process.argv[3] || 'import-bundle';

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  }))).flat();
}

async function main() {
  const files = (await walk(input)).filter(file => file.endsWith('.json') && !file.endsWith('export-manifest.json'));
  const libraries = [];
  for (const file of files) {
    const snapshot = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!snapshot.library || !Array.isArray(snapshot.libraryNodes)) continue;
    const { owner, writers, readers, subscriberCount, ...library } = snapshot.library;
    libraries.push({
      source: { libraryId: snapshot.library._id, file },
      library,
      libraryNodes: snapshot.libraryNodes,
      importNotes: ['IDs and tree references require destination-specific remapping before upload.'],
    });
  }
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'raw-import-candidates.json'), `${JSON.stringify({ format: 'dicecloud-import-candidates/v1', libraries }, null, 2)}\n`);
  console.log(`Prepared ${libraries.length} raw import candidates in ${output}/raw-import-candidates.json`);
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
