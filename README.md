# dicecloud-lov-stealinator

Read-only export tooling and offline import preparation for Libraries of Vexus.

```sh
nix-shell
./export-libraries-of-vexus.sh
node tools/prepare-import.js
```

Raw exports are canonical backups. `prepare-import.js` creates offline import
candidates only; destination-specific ID remapping and upload are intentionally
not implemented yet.

`exports/` is intentionally gitignored: it may contain content that must remain
local and must not be redistributed.

## Local restore mode

For a clean local DiceCloud database, restore mode preserves original library
and node IDs (including legacy `parent` and `ancestors` references) while
assigning ownership to a local user. It emits a Mongo shell program rather than
writing by itself; review or pipe that program into the local Mongo container.
