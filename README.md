# DiceCloud Libraries of Vexus archive

Private, read-only export and home-server restore tooling for Libraries of
Vexus (5e 2014 and 5e 2024). This repository is an operator runbook for its
maintainer—not a redistribution mechanism or public library importer.

The exporter attaches to Chromium with Playwright, reads the public
Meteor/Minimongo publications, and writes JSON snapshots locally. It never
calls DiceCloud methods or writes data to dicecloud.com.

> [!WARNING]
> This is an unsupported personal tool. **I accept no responsibility for damage,
> data loss, corruption, downtime, or any other problem it causes to your
> DiceCloud/HoardDC instance. I also accept no responsibility if DiceCloud takes
> action against your account, including a ban, for your use of it.** Read the
> code, keep backups, and decide for yourself whether the risk is acceptable.

## Keep the archive private

The exported content is not to be redistributed. `exports/` is intentionally
Git-ignored. Do not commit, push, or otherwise publish it. Transfer it only to
the private home server that runs HoardDC.

## Export workstation

Requirements: Nix with `nix-shell` (or Node.js 20+, Chromium, and `curl`) and
a DiceCloud account permitted to view both public collections.

```sh
nix-shell
npm ci
./export-libraries-of-vexus.sh
```

The script opens Chromium with an ignored profile at
`.dicecloud-export-profile/` unless an existing CDP browser is already
available at `http://127.0.0.1:9222`. Log in, return to the terminal, and press
Enter. It discovers and exports both collections, then exits with a summary.

The private archive is written as:

```text
exports/
  dicecloud-library-collection-jp6xTaHDZK4ELYzvN.json
  dicecloud-library-collection-5EKp4S55tDzRivSLn.json
  libraries-of-vexus/
    jp6xTaHDZK4ELYzvN/<library-id>.json
    5EKp4S55tDzRivSLn/<library-id>.json
```

Each collection directory has an `export-manifest.json`; confirm every library
entry reports `"status": "ok"`. Re-running replaces only your local snapshots
and never changes the source site.

## Transfer to the home server

Copy the ignored archive to the private HoardDC host after a successful export:

```sh
scp -r exports/ your-home-server:/srv/hoarddc-private/lov-archive/
```

Use an appropriate private destination and backup policy for that host. The
archive preserves the source library/node IDs and relationships, so it is the
canonical backup: no re-export is needed when rebuilding the home server.

## Restore into home-server HoardDC

On the private host, place `exports/` beside this repository (or copy this
repository too), install the Node dependency with `npm ci`, start the HoardDC
Docker/Mongo stack, and create the local account that will own the libraries.
Then run:

```sh
./restore-libraries-of-vexus-local.sh YOUR_LOCAL_USERNAME
```

If HoardDC's compose file is elsewhere:

```sh
DICECLOUD_DEV_COMPOSE=/absolute/path/to/docker-compose.dev.yml \
  ./restore-libraries-of-vexus-local.sh YOUR_LOCAL_USERNAME
```

Restore writes only to that local MongoDB instance. It preserves library and
node IDs, converts legacy tree fields to the local schema, strips source-site
collaboration/market data, and assigns ownership to the selected local user.
It safely replaces the previous local copy of each library when re-run.

The HoardDC fork must include the `insertPropertyFromLibraryNode` fix: copied
library properties need the destination character's `root` and selected slot's
`parentId`. With that in place, selecting a restored ruleset in the UI imports
and calculates it correctly.

## Implementation notes

Only the two Libraries of Vexus collections are supported. The lower-level
files in `tools/` are implementation details; there is no test-library step in
the supported workflow.
