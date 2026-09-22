# Regenerating `data/`

`data/` is a **build artifact**, not source. It is what makes this repo
standalone: every name is already resolved and every id already joined, so the
tool needs no decoded game files, no client install and no network.

Contributors never touch it. Only regenerate it when the underlying data
improves — a better name resolution pass, a new scrape, a corrected MST.

## Producing it

From an offline-server working tree that has the decoded MSTs
(`deploy/mst/*.json`) and the scrape outputs (`tools/wiki_*`):

```bash
python tools/mission-editor/export_bundle.py <path to this repo>/data
```

That writes:

| File | Contents |
|---|---|
| `units.json` | 2291 units — name, element, rarity, cost, whether curated |
| `unit_records.json` | per-unit archive record, so any unit can be placed |
| `items.json` | 1668 items with resolved names |
| `areas.json` | land → area → dungeon → mission, tagged by subsystem |
| `mission_templates.json` | boss line-ups, dungeon rosters, per-mission drops |
| `drop_tables.json` | which materials each area drops |
| `unit.json`, `ai.json` | the server's curated archive palettes |
| `meta.json` | canvas bounds, authoring limits, element names, AI vocabulary |

About 5 MB total.

## Where the names come from

Worth knowing when judging how trustworthy a given name is:

* **Unit and mission names** — the client's own localisation table first, then
  preserved community records, then the game's internal name, then the id. An
  English name is never invented.
* **Item names** — same ladder. Some remain Japanese because no English string
  for them exists anywhere; those are shown as-is rather than machine
  translated.
* **Ids** — joined on the game's own identifiers wherever they exist, and
  cross-checked against a second column (artwork filename) to catch a bad
  match. Where a join stayed ambiguous, the entry was **left out** rather than
  guessed.

## Sanity checks after regenerating

```bash
python server.py     # should report the unit and mission counts on startup
python build.py      # should still build every existing contribution
```

If the mission count moves a lot, or `build.py` starts erroring on
contributions that used to pass, something in the export changed shape —
investigate before committing the new bundle.
