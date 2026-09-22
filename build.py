#!/usr/bin/env python3
"""Combine per-dungeon contributions into the server's mission.json.

**The unit of contribution is a dungeon, not a mission and not the whole
archive.**  Each file under `missions/` holds every mission of one dungeon:

    missions/000010-adventurers-prairie.json

That choice is what keeps merging painless:

* two contributors working different dungeons touch different files, so git
  merges them with no conflict and no manual reconciliation;
* better information about a dungeon replaces one file wholesale, instead of
  hunting through a monolith — and the history shows what superseded what;
* nobody hand-edits `dist/mission.json`, so it can never carry a half-merged
  state.

Commands:
    python build.py            # build dist/mission.json + PROGRESS.md
    python build.py --check    # validate only, non-zero exit on problems
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict

import bundle

HERE = os.path.dirname(os.path.abspath(__file__))
MISSIONS_DIR = os.path.join(HERE, "missions")
DIST_DIR = os.path.join(HERE, "dist")
OUT_FILE = os.path.join(DIST_DIR, "mission.json")
UNITS_OUT = os.path.join(DIST_DIR, "unit.json")
PROGRESS = os.path.join(HERE, "PROGRESS.md")


def slug(text):
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s or "dungeon"


def dungeon_filename(dungeon_id):
    d = bundle.dungeons().get(int(dungeon_id))
    name = d["name"] if d else "dungeon"
    return "%06d-%s.json" % (int(dungeon_id), slug(name))


def load_contributions():
    """Every missions/*.json -> (path, payload).  Sorted for stable output."""
    out = []
    if not os.path.isdir(MISSIONS_DIR):
        return out
    for fn in sorted(os.listdir(MISSIONS_DIR)):
        if not fn.endswith(".json") or fn.startswith("_"):
            continue
        path = os.path.join(MISSIONS_DIR, fn)
        try:
            with open(path, "r", encoding="utf-8-sig") as fh:
                out.append((fn, json.load(fh)))
        except Exception as ex:
            out.append((fn, {"__error__": str(ex)}))
    return out


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

REQUIRED_MISSION = ("id", "name", "stages")
REQUIRED_ENEMY = ("unit_id", "position", "hp", "ai_id")


def validate(files):
    """[(level, file, message)] — 'error' blocks the build, 'warn' does not."""
    problems = []
    seen_missions = {}
    index = bundle.mission_index()
    units = {u["id"] for u in bundle.units()}
    ais = {a.get("id") for a in bundle.ai_records()}
    limits = bundle.meta().get("limits", {})
    max_mon = limits.get("maxMonstersPerStage", 6)

    for fn, payload in files:
        if isinstance(payload, dict) and "__error__" in payload:
            problems.append(("error", fn, "not valid JSON: %s" % payload["__error__"]))
            continue
        missions = payload.get("missions") if isinstance(payload, dict) else payload
        if not isinstance(missions, list):
            problems.append(("error", fn, "expected {\"missions\": [...]} or a JSON array"))
            continue

        for m in missions:
            mid = m.get("id")
            if not isinstance(mid, int):
                problems.append(("error", fn, "mission has a non-integer id: %r" % (mid,)))
                continue
            if mid in seen_missions:
                problems.append(("error", fn,
                                 "mission %d is already defined in %s"
                                 % (mid, seen_missions[mid])))
                continue
            seen_missions[mid] = fn

            for key in REQUIRED_MISSION:
                if key not in m:
                    problems.append(("error", fn, "mission %d is missing %r" % (mid, key)))

            known = index.get(mid)
            if not known:
                problems.append(("warn", fn,
                                 "mission %d is not in the game's mission table" % mid))
            else:
                # Rewards drifting from the MST usually means a typo, but an
                # author may be recreating a variant deliberately.
                for field in ("energy_cost", "exp"):
                    ours, theirs = m.get(field), known.get(field)
                    if ours and theirs and ours != theirs:
                        problems.append(("warn", fn,
                                         "mission %d %s is %s, the game data says %s"
                                         % (mid, field, ours, theirs)))

            stages = m.get("stages") or []
            if not stages:
                problems.append(("error", fn, "mission %d has no waves" % mid))
            for si, st in enumerate(stages):
                mons = st.get("battle_monsters") or []
                if not mons:
                    problems.append(("error", fn,
                                     "mission %d wave %d has no enemies" % (mid, si + 1)))
                if len(mons) > max_mon:
                    problems.append(("error", fn,
                                     "mission %d wave %d has %d enemies (max %d)"
                                     % (mid, si + 1, len(mons), max_mon)))
                for e in mons:
                    for key in REQUIRED_ENEMY:
                        if key not in e:
                            problems.append(("error", fn,
                                             "mission %d wave %d enemy is missing %r"
                                             % (mid, si + 1, key)))
                    uid = e.get("unit_id")
                    if uid and units and uid not in units:
                        problems.append(("error", fn,
                                         "mission %d wave %d uses unit %s, which is not "
                                         "in the roster" % (mid, si + 1, uid)))
                    if ais and e.get("ai_id") not in ais:
                        problems.append(("warn", fn,
                                         "mission %d wave %d uses ai_id %s, which is not "
                                         "in ai.json" % (mid, si + 1, e.get("ai_id"))))
                    if not re.match(r"^\d+:\d+$", str(e.get("position", ""))):
                        problems.append(("warn", fn,
                                         "mission %d wave %d position %r is not x:y"
                                         % (mid, si + 1, e.get("position"))))
                    # A drop that can fire must say what level it hands over.
                    if (e.get("unit_drop_chance") or 0) > 0:
                        if not e.get("unit_drop_id"):
                            problems.append(("error", fn,
                                             "mission %d wave %d has a drop chance but no "
                                             "unit" % (mid, si + 1)))
                        elif (e.get("unit_drop_level") or 0) < 1:
                            problems.append(("error", fn,
                                             "mission %d wave %d drop level must be >= 1"
                                             % (mid, si + 1)))
                    for d in e.get("treasure_drops") or []:
                        if int(d.get("target_type", 0)) == 4 and not str(
                                d.get("target_id", "")).strip():
                            problems.append(("error", fn,
                                             "mission %d wave %d has an item reward with "
                                             "no item" % (mid, si + 1)))
    return problems


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def build(files):
    """Flatten contributions into the archive arrays the server loads."""
    missions = []
    for _fn, payload in files:
        rows = payload.get("missions") if isinstance(payload, dict) else payload
        if isinstance(rows, list):
            missions.extend(rows)
    missions.sort(key=lambda m: m.get("id") or 0)

    # Every referenced unit needs a UnitRecord or the server refuses the
    # mission (UnitArchiver::lookup).  Start from the curated pool and add
    # whatever the contributions reference, straight from the bundle.
    pool = {u["id"]: u for u in bundle.curated_units()}
    records = bundle.unit_records()
    added = []
    for m in missions:
        for st in m.get("stages") or []:
            for e in st.get("battle_monsters") or []:
                uid = e.get("unit_id")
                if isinstance(uid, int) and uid not in pool:
                    rec = records.get(str(uid))
                    if rec:
                        pool[uid] = rec
                        added.append(uid)
    units = [pool[k] for k in sorted(pool)]
    return missions, units, added


def write_progress(files, missions):
    """Regenerate PROGRESS.md from the files — never hand-maintained."""
    by_dungeon = defaultdict(list)
    index = bundle.mission_index()
    for m in missions:
        info = index.get(m.get("id"))
        did = info["dungeon_id"] if info else None
        by_dungeon[did].append(m["id"])

    dungeons = bundle.dungeons()
    rows = []
    for did, d in sorted(dungeons.items(),
                         key=lambda kv: (kv[1]["subsystem"], kv[1]["area"], kv[0])):
        done = sorted(by_dungeon.get(did, []))
        total = len(d["mission_ids"])
        if not done:
            continue
        rows.append((d, done, total))

    total_missions = sum(len(d["mission_ids"]) for d in dungeons.values())
    lines = [
        "# Progress",
        "",
        "*Generated by `build.py` — do not edit by hand.*",
        "",
        "| Metric | Count |",
        "|---|---:|",
        "| Missions authored | **%d** |" % len(missions),
        "| Missions in the game | %d |" % total_missions,
        "| Dungeons started | %d of %d |" % (len(rows), len(dungeons)),
        "| Contribution files | %d |" % len(files),
        "",
        "## Dungeons with work in them",
        "",
        "| Subsystem | Area | Dungeon | Authored | In game |",
        "|---|---|---|---:|---:|",
    ]
    for d, done, total in rows:
        lines.append("| %s | %s | %s | %d | %d |"
                     % (d["subsystem"], d["area"] or "—", d["name"],
                        len(done), total))
    lines.append("")
    lines.append("Everything not listed above is unclaimed — pick a dungeon and "
                 "open a PR.  See CONTRIBUTING.md.")
    with open(PROGRESS, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true",
                    help="validate only; do not write dist/")
    args = ap.parse_args()

    files = load_contributions()
    print("contribution files: %d" % len(files))

    problems = validate(files)
    errors = [p for p in problems if p[0] == "error"]
    warns = [p for p in problems if p[0] == "warn"]
    for level, fn, msg in problems:
        print("  %-5s %-40s %s" % (level.upper(), fn, msg))
    print("  %d error(s), %d warning(s)" % (len(errors), len(warns)))

    if errors:
        print("\nBuild refused: fix the errors above.")
        return 1
    if args.check:
        print("\nCheck passed.")
        return 0

    missions, units, added = build(files)
    os.makedirs(DIST_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(missions, fh, ensure_ascii=False, indent=1)
    with open(UNITS_OUT, "w", encoding="utf-8") as fh:
        json.dump(units, fh, ensure_ascii=False, indent=1)
    write_progress(files, missions)

    print()
    print("built %d mission(s) -> %s" % (len(missions), os.path.relpath(OUT_FILE, HERE)))
    print("      %d unit record(s) -> %s (%d generated for referenced units)"
          % (len(units), os.path.relpath(UNITS_OUT, HERE), len(set(added))))
    print("      progress -> %s" % os.path.relpath(PROGRESS, HERE))
    print()
    print("Copy dist/mission.json and dist/unit.json into the server's "
          "deploy/archive/ to play them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
