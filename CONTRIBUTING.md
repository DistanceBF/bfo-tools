# Contributing

Thank you for helping rebuild this. Every dungeon someone authors is content
that was otherwise gone for good.

## The short version

1. Check [PROGRESS.md](PROGRESS.md) and pick a dungeon nobody has done.
2. `python server.py`, open <http://localhost:8777>.
3. **+ From MST** → find your dungeon's missions. Id, name, rewards and the
   waves themselves fill in automatically, boss wave included where one
   survived.
4. Fill the empty waves from the palette. Drops come pre-filled; adjust what
   the mission needs.
5. **Save**, then **✓ Validate & build**. Fix anything reported as an error.
6. Commit the file(s) under `missions/` plus the regenerated `PROGRESS.md`, and
   open a pull request.

You only ever commit files under `missions/` (and `PROGRESS.md`, which the
build regenerates). Never edit `dist/` or `data/` by hand.

## One dungeon per file

Your work is saved as `missions/<dungeon id>-<name>.json`, holding every
mission in that dungeon. The editor routes each mission to the right file for
you; you do not have to manage this.

This is why a PR is easy to review and merge: it touches one or two files
nobody else is touching.

**Please keep one PR to one dungeon** (or a few closely related ones). A PR
spanning twenty dungeons is hard to review and hard to revise.

## What "good" looks like

The goal is a faithful recreation, so prefer recorded facts over plausible
invention:

* **Take the tool's prefills.** Energy, wave count, exp and zel come from the
  game's own tables, and the boss wave from preserved records. If you change
  one, the build warns — that is fine when you mean it, but do not change them
  casually.
* **The regular waves are yours to author.** They were never recorded anywhere,
  which is why the tool leaves them empty instead of inventing them. Use the
  curated palette — it is limited to the monsters that dungeon actually used —
  and keep the difficulty curve sensible for where the dungeon sits.
* **The drop defaults are a starting point, not a rule.** A new enemy drops
  itself at 10% and guards a 10% chest of its area's materials. That is the
  common case, not every case: clear the unit drop on something that should not
  be farmable, and raise or drop the rates where you know better. Which
  materials an area dropped is recorded; the rates are not, so weights start
  uniform. Tune them if you have real evidence, and say so in the PR.
* **Leave a dropped unit's variant on "Random (game rates)"** unless you know
  the mission handed out a specific one, so every clear does not award the same
  Lord.
* **Say where you got it.** If you are working from a video, a screenshot, a
  wiki page or memory, put that in the PR. "From memory" is a perfectly good
  answer — it is just useful for the next person to know.

## Superseding someone else's work

If new information shows an existing dungeon is wrong, replace that file
wholesale in a PR and say what changed and what the evidence is. Because a
dungeon is one file, this is a clean diff rather than a merge argument.

## Validation

`python build.py --check` runs exactly what CI runs. It reports:

* **errors** — the build refuses these. A mission with no waves, a wave with no
  enemies or more than six, a unit that is not in the roster, a drop that can
  fire with no unit or at level 0, an item reward with no item, a duplicate
  mission id across files.
* **warnings** — allowed through. Rewards that differ from the game's tables,
  an `ai_id` not in `ai.json`, a malformed position, a weight-0 treasure row, a
  mission id the game does not know.

Warnings are worth a second look but do not block you.

## Testing in game

If you run an offline server:

```bash
python build.py
cp dist/mission.json dist/unit.json <server>/deploy/archive/
```

Restart it and play the mission. Testing before you submit is welcome but not
required — plenty of useful contributions come from people without a server
set up.

## Reporting data problems

The reference data in `data/` is derived, and some of it is inferred. If a unit
has the wrong name, a mission's rewards look wrong, or a drop table lists
something that clearly does not drop there, open an issue. Include the mission
or unit id. Those reports are valuable — they improve the data for everyone,
not just your dungeon.
