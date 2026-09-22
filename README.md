# BFO Mission Builder

A local tool for **recreating Brave Frontier's lost mission data**, and the
repository that collects what the community rebuilds.

When the servers shut down, the per-mission battle data went with them — which
monsters appeared in which wave, with what stats and drops. The client still
has every unit, item, area and reward table, so all of that is recoverable.
The battles themselves have to be authored by hand, one dungeon at a time.
That is what this repo is for.

```bash
python server.py
# open http://localhost:8777
```

Python 3 and a browser. No `pip install`, no Node, no build step, no network,
and no copy of the game server needed.

---

## What it gives you

* **Every unit (2291) and item (1668)**, by name — searchable, filterable by
  element and rarity.
* **Every mission in the game (3432)**, across Grand Gaia, Vortex, Trial,
  Frontier Gate/Hunter, Grand Quest and events. Pick one and its id, name,
  rewards and **wave count** are filled in from the game's own data — including
  the boss wave, built with the right units and HP wherever that line-up
  survived. The regular waves are laid out empty, because what they held was
  never recorded and guessing it would be fabrication.
* **Curated monster rosters.** Selecting a mission narrows the palette to the
  monsters that dungeon actually used — 10 units instead of 2291.
* **Drops that start filled in.** An enemy you place drops itself at 10% with a
  random personality type, and guards a 10% chest holding everything its area
  really dropped, plus zel and karma. Bosses get the chest but no unit drop.
  All of it is one control away from being changed or cleared.
* **Live validation** that flags a mission with no waves, a drop that can fire
  at level 0, an item reward with no item, and other things the server would
  choke on.

## How contributing works

**The unit of contribution is a dungeon**, not a single mission and not the
whole archive. Everything you author lands in one file per dungeon:

```
missions/000010-adventurer-s-prairie.json
```

That is what keeps merging painless:

* two people working different dungeons never touch the same file, so pull
  requests merge without conflicts;
* better information about a dungeon replaces one file wholesale — no hunting
  through a monolith, and the history shows what superseded what;
* nobody edits the combined output by hand, so it can never end up half-merged.

`python build.py` concatenates every contribution into `dist/mission.json`
(plus the `dist/unit.json` the server needs) and regenerates
[PROGRESS.md](PROGRESS.md), the board of what is done and what is unclaimed.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** to get started, and
**[DATA_MODEL.md](DATA_MODEL.md)** for what every field means and where the
data came from.

## Using what you build

Copy the built files into a running offline server:

```bash
python build.py
cp dist/mission.json dist/unit.json <server>/deploy/archive/
```

Restart the server and the missions are playable.

## Repository layout

| Path | What it is |
|---|---|
| `server.py` | the local web app |
| `web/` | the editor UI |
| `build.py` | combines contributions, validates, writes `dist/` and `PROGRESS.md` |
| `bundle.py` | reads the reference data |
| `data/` | **generated** reference bundle — units, items, areas, templates, drop tables |
| `missions/` | **the contributions** — one file per dungeon |
| `dist/` | **generated** — the archive files the server loads |

`data/` is a build artifact exported from a server working tree; see
[EXPORTING.md](EXPORTING.md). Don't hand-edit it, and don't hand-edit `dist/`.

## Accuracy

Recreating lost data invites invention, so the tooling is deliberately
conservative:

* Reward values, energy costs and wave counts come from the game's own tables,
  not from guesses.
* Monster line-ups come from preserved records; where only the boss wave
  survived, only the boss wave is offered and the tool says so.
* Drop tables record **which** materials an area dropped — the rates were never
  recorded anywhere, so weights start uniform and are yours to tune.
* Where a match was uncertain, the data is left out rather than guessed, and
  the build warns when an authored value contradicts the game's.

If you find something the tool states that is wrong, that is a bug worth
filing — the point is a faithful recreation, not a plausible one.
