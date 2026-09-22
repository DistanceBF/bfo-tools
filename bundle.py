"""Reference data access for the standalone builder.

Everything here is read from `data/*.json`, a bundle exported from a server
working tree (see EXPORTING.md).  That is what makes this repo self-contained:
no decoded MSTs, no client files, no wiki scrape caches, no network — just
Python and these JSONs.

The bundle is a build artifact.  Do not hand-edit it; regenerate it.
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("BFO_DATA_DIR", os.path.join(HERE, "data"))

_cache = {}


def refresh():
    _cache.clear()


def load(name, default=None):
    """Load `data/<name>`, cached.  Missing files degrade to `default`."""
    if name in _cache:
        return _cache[name]
    path = os.path.join(DATA_DIR, name)
    value = default
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8-sig") as fh:
                value = json.load(fh)
        except Exception as ex:
            print("WARNING: could not read %s: %s" % (path, ex))
    _cache[name] = value
    return value


def units():
    """Full unit roster: [{id, name, element, rarity, named, in_archive}]."""
    return load("units.json", [])


def items():
    """Item catalogue: [{id, name, named}]."""
    return load("items.json", [])


def area_tree():
    """land > area > dungeon > mission, tagged by subsystem."""
    return load("areas.json", [])


def mission_templates():
    """{mission_id: {quest, monsters, roster, drops, energy, battles, exp}}."""
    return load("mission_templates.json", {})


def drop_tables():
    """{area_id: {area, land_id, items:[...]}} — materials per area."""
    return load("drop_tables.json", {})


def unit_records():
    """{unit_id: UnitRecord} — the archive shape an authored unit needs."""
    return load("unit_records.json", {})


def ai_records():
    return load("ai.json", [])


def curated_units():
    """The archive's existing UnitRecord pool."""
    return load("unit.json", [])


def meta():
    return load("meta.json", {})


def mission_index():
    """{mission_id: {name, area, area_id, land_id, subsystem, energy, ...}}.

    Flattened from the area tree — the builder needs mission -> area lookups
    constantly (drop tables, file naming, progress) and walking four levels
    each time is wasteful.
    """
    if "_index" in _cache:
        return _cache["_index"]
    idx = {}
    for land in area_tree():
        for area in land.get("areas", []):
            for dungeon in area.get("dungeons", []):
                for m in dungeon.get("missions", []):
                    idx[int(m["id"])] = {
                        "id": int(m["id"]),
                        "name": m.get("name", ""),
                        "named": m.get("named", False),
                        "area": area.get("name", ""),
                        "area_id": area.get("id"),
                        "land_id": land.get("land_id"),
                        "dungeon_id": dungeon.get("id"),
                        "subsystem": m.get("subsystem", "Grand Gaia"),
                        "energy_cost": m.get("energy_cost", 0),
                        "battle_count": m.get("battle_count", 0),
                        "exp": m.get("exp", 0),
                        "zel": m.get("zel", 0),
                        "karma": m.get("karma", 0),
                        "has_template": m.get("has_template", False),
                    }
    _cache["_index"] = idx
    return idx


def dungeons():
    """{dungeon_id: {id, name, area, area_id, subsystem, mission_ids[]}}.

    The dungeon is the unit of contribution, so this is what names files and
    drives the progress board.  Dungeon display names are not recoverable from
    our data (1 of 1532 resolve), so the label is the AREA name plus the
    dungeon id — stable, and enough for a human to recognise.
    """
    if "_dungeons" in _cache:
        return _cache["_dungeons"]
    out = {}
    for land in area_tree():
        for area in land.get("areas", []):
            for d in area.get("dungeons", []):
                did = d.get("id")
                if did is None:
                    continue
                mids = [int(m["id"]) for m in d.get("missions", [])]
                # Prefer the wiki's dungeon name when a template supplies one.
                label = ""
                for mid in mids:
                    t = mission_templates().get(str(mid))
                    if t and t.get("dungeon"):
                        label = t["dungeon"]
                        break
                out[int(did)] = {
                    "id": int(did),
                    "name": label or ("%s %d" % (area.get("name", "Area"), did)),
                    "area": area.get("name", ""),
                    "area_id": area.get("id"),
                    "land_id": land.get("land_id"),
                    "subsystem": (d.get("missions") or [{}])[0].get(
                        "subsystem", "Grand Gaia"),
                    "mission_ids": sorted(mids),
                }
    _cache["_dungeons"] = out
    return out
