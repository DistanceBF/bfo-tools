#!/usr/bin/env python3
"""BFO Mission Builder — local web app.

Standalone: Python 3 and a browser, nothing else.  No pip install, no Node, no
network, and no copy of the game server.  All reference data comes from
`data/*.json` (see bundle.py); your work is saved as one file per dungeon under
`missions/`.

    python server.py            # then open http://localhost:8777

Environment:
    BFO_PORT        listen port (default 8777)
    BFO_DATA_DIR    reference bundle (default ./data)
    BFO_MISSIONS    contribution directory (default ./missions)
"""

import json
import os
import re
import shutil
import sqlite3
import sys
from contextlib import closing
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bundle   # noqa: E402
import build    # noqa: E402  (shared validation + filenames)

WEB_DIR = os.path.join(HERE, "web")
WEB2_DIR = os.path.join(HERE, "web2")
GME_DEFAULT_PROFILE = "gme.sqlite"
GME_ACTIVE_PATH_FILE = os.path.join(WEB2_DIR, ".active-gme-path.txt")
STATIC_WEB_DIRS = {
    "web1": os.path.join(HERE, "web1"),
    "web2": WEB2_DIR,
    "web3": os.path.join(HERE, "web3"),
    "images": os.path.join(HERE, "images"),
}
MISSIONS_DIR = os.environ.get("BFO_MISSIONS", os.path.join(HERE, "missions"))
BACKUP_DIR = os.path.join(HERE, ".backups")
PORT = int(os.environ.get("BFO_PORT", "8777"))

GME_ACCOUNT_FIELDS = [
    "username", "level", "exp", "max_unit_count", "max_friend_count", "zel",
    "karma", "brave_coin", "max_warehouse_count", "friend_points", "gems",
    "energy", "fight_point", "max_fight_point", "hunter_orbs", "achieve_point",
    "summon_tickets", "rainbow_coins", "colosseum_tickets", "tutorial_status",
    "tutorial_end_flag", "debug_mode",
]
GME_UNIT_FIELDS = [
    "unit_id", "unit_type_id", "unit_lvl", "base_hp", "base_atk", "base_def",
    "base_rec", "ext_hp", "ext_atk", "ext_def", "ext_rec", "bb_id", "bb_lvl",
    "sbb_id", "sbb_lvl", "new", "add_hp", "add_atk", "add_def", "add_rec",
    "limit_over_hp", "limit_over_atk", "limit_over_def", "limit_over_rec",
    "exp", "total_exp", "skill_id", "skill_lv", "extra_skill_id",
    "extra_skill_lv", "leader_skill_id", "element", "fe_bp",
    "fe_max_usable_bp", "eqip_item_id", "eqip_item_frame_id", "eqip_item_id2",
    "eqip_item_frame_id2", "favorite_flg", "sphere_ext",
]
GME_ITEM_FIELDS = ["item_id", "item_num", "favorite_flg", "disp_order"]


# ---------------------------------------------------------------------------
# Contribution files
# ---------------------------------------------------------------------------

def _all_missions():
    """Every mission across every contribution file, with its source file."""
    out = []
    for fn, payload in build.load_contributions():
        rows = payload.get("missions") if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            continue
        for m in rows:
            m["_file"] = fn
            out.append(m)
    out.sort(key=lambda m: m.get("id") or 0)
    return out


def _group_by_dungeon(missions):
    """Split a flat mission list into {dungeon_id: [missions]}.

    The dungeon is the contribution unit, so a save has to route each mission
    to its own file rather than dumping everything into one.  Missions the game
    data does not know (custom ids) land in dungeon 0.
    """
    index = bundle.mission_index()
    groups = {}
    for m in missions:
        info = index.get(m.get("id"))
        did = info["dungeon_id"] if info else 0
        groups.setdefault(did, []).append(m)
    return groups


def _save_missions(missions):
    """Write missions back out, one file per dungeon.  Returns the file list."""
    os.makedirs(MISSIONS_DIR, exist_ok=True)
    groups = _group_by_dungeon(missions)

    written = []
    for did, rows in sorted(groups.items()):
        fn = build.dungeon_filename(did) if did else "000000-custom.json"
        path = os.path.join(MISSIONS_DIR, fn)
        if os.path.isfile(path):
            os.makedirs(BACKUP_DIR, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            shutil.copy2(path, os.path.join(BACKUP_DIR, "%s.%s" % (fn, stamp)))

        d = bundle.dungeons().get(did, {})
        clean = []
        for m in sorted(rows, key=lambda x: x.get("id") or 0):
            m = {k: v for k, v in m.items() if not k.startswith("_")}
            clean.append(m)
        payload = {
            "dungeon_id": did,
            "dungeon": d.get("name", ""),
            "area": d.get("area", ""),
            "subsystem": d.get("subsystem", ""),
            "missions": clean,
        }
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
        written.append(fn)

    # A dungeon whose last mission was deleted leaves a stale file behind.
    keep = set(written)
    for fn in os.listdir(MISSIONS_DIR):
        if fn.endswith(".json") and not fn.startswith("_") and fn not in keep:
            os.remove(os.path.join(MISSIONS_DIR, fn))
    return written


# ---------------------------------------------------------------------------
# GME account editor
# ---------------------------------------------------------------------------

def _gme_profile(payload=None, query=None):
    path = _active_gme_path()
    if not os.path.isfile(path):
        raise FileNotFoundError("Missing active gme.sqlite: %s" % path)
    return GME_DEFAULT_PROFILE


def _gme_db_path(profile):
    return _active_gme_path()


def _default_gme_path():
    return os.path.join(WEB2_DIR, GME_DEFAULT_PROFILE)


def _active_gme_path():
    if os.path.isfile(GME_ACTIVE_PATH_FILE):
        with open(GME_ACTIVE_PATH_FILE, "r", encoding="utf-8") as fh:
            path = fh.read().strip()
        if path:
            return os.path.abspath(path)
    return _default_gme_path()


def _set_active_gme_path(path):
    path = os.path.abspath(os.path.expanduser(str(path or "").strip().strip('"')))
    if not path:
        raise ValueError("Enter a gme.sqlite file path")
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    if not path.lower().endswith((".sqlite", ".db", ".sqllite")):
        raise ValueError("File must be a .sqlite, .db, or .sqllite database")
    _gme_validate_db(path)
    with open(GME_ACTIVE_PATH_FILE, "w", encoding="utf-8") as fh:
        fh.write(path)
    return _gme_state(GME_DEFAULT_PROFILE)


def _gme_backup(profile):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    src = _gme_db_path(profile)
    dst = os.path.join(BACKUP_DIR, "%s.%s" % (os.path.basename(src), stamp))
    shutil.copy2(src, dst)


def _gme_connect(profile):
    con = sqlite3.connect(_gme_db_path(profile))
    con.row_factory = sqlite3.Row
    return con


def _gme_validate_db(path):
    required = {"user_info", "user_units", "user_items"}
    con = sqlite3.connect(path)
    try:
        rows = con.execute(
            "select name from sqlite_master where type = 'table'"
        ).fetchall()
    finally:
        con.close()
    found = {row[0] for row in rows}
    missing = sorted(required - found)
    if missing:
        raise ValueError("Missing account tables: %s" % ", ".join(missing))


def _gme_upload_database(body):
    profile = GME_DEFAULT_PROFILE
    if not body:
        raise ValueError("Uploaded database was empty")
    tmp = os.path.join(WEB2_DIR, ".upload-%s" % profile)
    final = _default_gme_path()
    with open(tmp, "wb") as fh:
        fh.write(body)
    try:
        _gme_validate_db(tmp)
        if os.path.exists(final):
            os.makedirs(BACKUP_DIR, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            shutil.copy2(final, os.path.join(BACKUP_DIR, "%s.%s" % (profile, stamp)))
        os.replace(tmp, final)
        with open(GME_ACTIVE_PATH_FILE, "w", encoding="utf-8") as fh:
            fh.write(final)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return _gme_state(profile)


def _gme_account(cur):
    row = cur.execute("select * from user_info limit 1").fetchone()
    return dict(row) if row else {}


def _catalog_map(rows):
    return {int(r["id"]): r for r in _catalog_rows(rows)}


def _catalog_rows(rows):
    if isinstance(rows, dict):
        out = []
        for key, value in rows.items():
            if isinstance(value, dict):
                row = dict(value)
                row.setdefault("id", int(key))
                out.append(row)
        return out
    return rows or []


def _gme_unit_records():
    path = os.path.join(bundle.DATA_DIR, "units", "unit.json")
    with open(path, "r", encoding="utf-8-sig") as source:
        return _catalog_map(json.load(source))


def _gme_state(profile=None):
    profile = profile or _gme_profile()
    units_catalog = [
        {
            "id": unit_id,
            "name": rec.get("name", ""),
            "element": rec.get("element", ""),
            "rarity": rec.get("rarity", ""),
            "named": bool(rec.get("name")),
            "in_archive": True,
        }
        for unit_id, rec in _gme_unit_records().items()
    ]
    items_catalog = _catalog_rows(bundle.items())
    unit_names = _catalog_map(units_catalog)
    item_names = _catalog_map(items_catalog)
    with closing(_gme_connect(profile)) as con:
        cur = con.cursor()
        units = []
        for row in cur.execute("select * from user_units order by user_unit_id"):
            d = dict(row)
            info = unit_names.get(d.get("unit_id"), {})
            d["name"] = info.get("name", "")
            d["rarity"] = info.get("rarity", "")
            d["catalog_element"] = info.get("element", "")
            units.append(d)
        items = []
        for row in cur.execute("select * from user_items order by item_id, instance_id"):
            d = dict(row)
            info = item_names.get(d.get("item_id"), {})
            d["name"] = info.get("name", "")
            d["thumbnail"] = info.get("thumbnail", "")
            items.append(d)
        return {
            "profile": profile,
            "databasePath": _gme_db_path(profile),
            "account": _gme_account(cur),
            "units": units,
            "items": items,
            "unitCatalog": units_catalog,
            "itemCatalog": items_catalog,
        }


def _coerce_gme_value(value):
    if isinstance(value, bool):
        return int(value)
    return value


def _gme_update_account(payload):
    profile = _gme_profile(payload)
    fields = [f for f in GME_ACCOUNT_FIELDS if f in payload]
    if not fields:
        return _gme_state(profile)
    _gme_backup(profile)
    with closing(_gme_connect(profile)) as con:
        account = _gme_account(con.cursor())
        sets = ", ".join("%s = ?" % f for f in fields)
        values = [_coerce_gme_value(payload[f]) for f in fields]
        values.append(account["id"])
        con.execute("update user_info set %s where id = ?" % sets, values)
        con.commit()
    return _gme_state(profile)


def _unit_defaults(unit_id):
    rec = _gme_unit_records().get(int(unit_id))
    if rec is None:
        raise ValueError("Unit %s is missing from data/units/unit.json" % unit_id)
    stats = rec.get("stats") or [{}]
    max_stats = stats[-1]
    return {
        "base_hp": max_stats.get("hp", 1),
        "base_atk": max_stats.get("atk", 1),
        "base_def": max_stats.get("def", 1),
        "base_rec": max_stats.get("rec", 1),
        "bb_id": str(rec["bb_id"]),
        "sbb_id": str(rec["sbb_id"]),
        "element": str(rec.get("element") or ""),
    }


def _gme_upsert_unit(payload):
    profile = _gme_profile(payload)
    _gme_backup(profile)
    with closing(_gme_connect(profile)) as con:
        cur = con.cursor()
        account = _gme_account(cur)
        existing_id = payload.get("user_unit_id")
        unit_id = payload.get("unit_id")
        if existing_id and unit_id is None:
            existing = cur.execute(
                "select unit_id from user_units where user_unit_id = ?",
                [int(existing_id)],
            ).fetchone()
            if existing is None:
                raise ValueError("Unit not found")
            unit_id = existing["unit_id"]
        unit_id = int(unit_id or 0)
        defaults = _unit_defaults(unit_id)
        row = {
            "user_id": account["id"],
            "unit_id": unit_id,
            "unit_type_id": int(payload.get("unit_type_id") or 1),
            "unit_lvl": int(payload.get("unit_lvl") or 1),
            "base_hp": defaults["base_hp"],
            "base_atk": defaults["base_atk"],
            "base_def": defaults["base_def"],
            "base_rec": defaults["base_rec"],
            "ext_hp": 0, "ext_atk": 0, "ext_def": 0, "ext_rec": 0,
            "bb_id": defaults["bb_id"], "bb_lvl": 1,
            "sbb_id": defaults["sbb_id"], "sbb_lvl": 0,
            "new": 0,
            "add_hp": 0, "add_atk": 0, "add_def": 0, "add_rec": 0,
            "limit_over_hp": 0, "limit_over_atk": 0,
            "limit_over_def": 0, "limit_over_rec": 0,
            "exp": 1, "total_exp": 1,
            "skill_id": 0, "skill_lv": 0,
            "extra_skill_id": 0, "extra_skill_lv": 0,
            "leader_skill_id": 0,
            "element": defaults["element"],
            "fe_bp": 100, "fe_max_usable_bp": 200,
            "eqip_item_id": 0, "eqip_item_frame_id": 0,
            "eqip_item_id2": 0, "eqip_item_frame_id2": -1,
            "favorite_flg": 0, "sphere_ext": 0,
        }
        for field in GME_UNIT_FIELDS:
            if field in payload:
                row[field] = _coerce_gme_value(payload[field])
        for field in ("bb_id", "sbb_id"):
            if payload.get("allow_manual_skill_ids") is True and field in payload:
                value = str(payload[field]).strip()
                if value and (not value.isascii() or not value.isdecimal()):
                    raise ValueError("%s must be blank or a non-negative integer" % field)
                row[field] = value
            else:
                row[field] = defaults[field]
        if existing_id:
            fields = [f for f in GME_UNIT_FIELDS if f in payload]
            for forced in ("bb_id", "sbb_id"):
                if forced not in fields:
                    fields.append(forced)
            sets = ", ".join("%s = ?" % f for f in fields)
            values = [row[f] for f in fields] + [int(existing_id)]
            cur.execute("update user_units set %s where user_unit_id = ?" % sets, values)
        else:
            fields = ["user_id"] + GME_UNIT_FIELDS
            marks = ", ".join("?" for _ in fields)
            cur.execute(
                "insert into user_units (%s) values (%s)" % (", ".join(fields), marks),
                [row[f] for f in fields],
            )
        con.commit()
    return _gme_state(profile)


def _gme_delete_unit(payload):
    profile = _gme_profile(payload)
    _gme_backup(profile)
    with closing(_gme_connect(profile)) as con:
        con.execute("delete from user_units where user_unit_id = ?",
                    [int(payload.get("user_unit_id") or 0)])
        con.commit()
    return _gme_state(profile)


def _gme_upsert_item(payload):
    profile = _gme_profile(payload)
    _gme_backup(profile)
    with closing(_gme_connect(profile)) as con:
        cur = con.cursor()
        account = _gme_account(cur)
        existing_id = payload.get("instance_id")
        row = {
            "user_id": account["id"],
            "item_id": int(payload.get("item_id") or 0),
            "item_num": int(payload.get("item_num") or 1),
            "favorite_flg": int(payload.get("favorite_flg") or 0),
            "disp_order": int(payload.get("disp_order") or 0),
        }
        for field in GME_ITEM_FIELDS:
            if field in payload:
                row[field] = _coerce_gme_value(payload[field])
        if not existing_id:
            existing = cur.execute(
                "select instance_id, item_num from user_items where user_id = ? and item_id = ?",
                [account["id"], row["item_id"]],
            ).fetchone()
            if existing:
                existing_id = existing["instance_id"]
                row["item_num"] = int(existing["item_num"] or 0) + int(row["item_num"] or 0)
        if existing_id:
            fields = [f for f in GME_ITEM_FIELDS if f in payload]
            sets = ", ".join("%s = ?" % f for f in fields)
            values = [row[f] for f in fields] + [int(existing_id)]
            cur.execute("update user_items set %s where instance_id = ?" % sets, values)
        else:
            fields = ["user_id"] + GME_ITEM_FIELDS
            marks = ", ".join("?" for _ in fields)
            cur.execute(
                "insert into user_items (%s) values (%s)" % (", ".join(fields), marks),
                [row[f] for f in fields],
            )
        con.commit()
    return _gme_state(profile)


def _gme_delete_item(payload):
    profile = _gme_profile(payload)
    _gme_backup(profile)
    with closing(_gme_connect(profile)) as con:
        con.execute("delete from user_items where instance_id = ?",
                    [int(payload.get("instance_id") or 0)])
        con.commit()
    return _gme_state(profile)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass    # quiet; the console is for our own messages

    def _send_json(self, payload, code=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, msg, code=400):
        self._send_json({"error": msg}, code)

    def _send_file(self, path):
        if not os.path.isfile(path):
            self.send_error(404, "Not found")
            return
        ctype = {".html": "text/html", ".js": "application/javascript",
                 ".css": "text/css", ".json": "application/json",
                 ".png": "image/png", ".jpg": "image/jpeg",
                 ".jpeg": "image/jpeg", ".webp": "image/webp",
                 ".gif": "image/gif"}.get(
            os.path.splitext(path)[1], "application/octet-stream")
        with open(path, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", "%s; charset=utf-8" % ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_download(self, path, filename):
        if not os.path.isfile(path):
            self.send_error(404, "Not found")
            return
        with open(path, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", 'attachment; filename="%s"' % filename)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_static_web_file(self, folder, route):
        base = STATIC_WEB_DIRS[folder]
        prefix = "/" + folder
        rel = unquote(route[len(prefix):]).lstrip("/")
        if not rel:
            rel = "index.html"

        path = os.path.abspath(os.path.join(base, rel))
        if os.path.commonpath([base, path]) != base:
            self.send_error(403, "Forbidden")
            return
        return self._send_file(path)

    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path
        query = parse_qs(parsed.query)
        try:
            if route in ("/", "/index.html"):
                return self._send_file(os.path.join(WEB_DIR, "index.html"))
            if route in ("/app.js", "/style.css"):
                return self._send_file(os.path.join(WEB_DIR, route.lstrip("/")))
            for folder in STATIC_WEB_DIRS:
                if route == "/" + folder or route.startswith("/" + folder + "/"):
                    return self._send_static_web_file(folder, route)

            if route == "/api/gme/download":
                return self._send_download(_gme_db_path(GME_DEFAULT_PROFILE), GME_DEFAULT_PROFILE)
            if route == "/api/gme/state":
                return self._send_json(_gme_state(_gme_profile(query=query)))
            if route == "/api/meta":
                return self._send_json(bundle.meta())
            if route == "/api/server-info":
                return self._send_json({"projectPath": HERE})
            if route == "/api/units":
                return self._send_json(bundle.units())
            if route == "/api/items":
                return self._send_json(_catalog_rows(bundle.items()))
            if route == "/api/ais":
                return self._send_json(bundle.ai_records())
            if route == "/api/areas":
                return self._send_json(bundle.area_tree())
            if route == "/api/missions":
                return self._send_json(_all_missions())
            if route == "/api/drop-tables":
                area = query.get("area", [None])[0]
                t = bundle.drop_tables()
                return self._send_json(t.get(str(area), {}) if area else t)
            if route == "/api/mission-template":
                mid = query.get("mission", [None])[0]
                if not mid:
                    return self._error("missing ?mission=<id>")
                t = dict(bundle.mission_templates().get(str(mid), {}))
                if t:
                    names = {u["id"]: u["name"] for u in bundle.units()}
                    for m in t.get("monsters", []):
                        m["name"] = names.get(m.get("unit_id"), "")
                    for c in t.get("captures", []):
                        c["name"] = names.get(c.get("unit_id"), "")
                return self._send_json(t)
            if route == "/api/default-drops":
                q = query
                mid = q.get("mission", [None])[0]
                if not mid:
                    return self._error("missing ?mission=<id>")
                return self._send_json(
                    _default_drops(mid, int(q.get("weight", ["10"])[0])))
            if route == "/api/mission-mst":
                mid = query.get("id", [None])[0]
                info = bundle.mission_index().get(int(mid)) if mid else None
                return self._send_json({
                    "zel": info["zel"], "karma": info["karma"],
                    "exp": info["exp"], "energy_cost": info["energy_cost"],
                } if info else {})
            self.send_error(404, "Not found")
        except Exception as ex:
            self._error("%s: %s" % (type(ex).__name__, ex), 500)

    def do_POST(self):
        parsed = urlparse(self.path)
        route = parsed.path
        query = parse_qs(parsed.query)
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b""
        if route == "/api/gme/upload":
            try:
                return self._send_json(_gme_upload_database(raw))
            except Exception as ex:
                return self._error("%s: %s" % (type(ex).__name__, ex), 500)
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else None
        except Exception as ex:
            return self._error("Bad JSON: %s" % ex)
        try:
            if route == "/api/ais":
                if not isinstance(payload, list) or any(
                    not isinstance(row, dict) or not isinstance(row.get("id"), int)
                    or not isinstance(row.get("actions"), list) for row in payload
                ):
                    return self._error("Expected AI records with integer IDs and action lists")
                if len({row["id"] for row in payload}) != len(payload):
                    return self._error("AI IDs must be unique")
                path = os.path.join(bundle.DATA_DIR, "ai.json")
                os.makedirs(BACKUP_DIR, exist_ok=True)
                if os.path.isfile(path):
                    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                    shutil.copy2(path, os.path.join(BACKUP_DIR, "ai.json." + stamp))
                with open(path + ".tmp", "w", encoding="utf-8") as fh:
                    json.dump(payload, fh, ensure_ascii=False, indent=1)
                os.replace(path + ".tmp", path)
                bundle.refresh()
                return self._send_json({"ok": True, "count": len(payload)})
            if route == "/api/missions":
                if not isinstance(payload, list):
                    return self._error("Expected a JSON array of missions")
                written = _save_missions(payload)
                return self._send_json({"ok": True, "count": len(payload),
                                        "files": written})
            if route == "/api/build":
                files = build.load_contributions()
                problems = build.validate(files)
                errs = [p for p in problems if p[0] == "error"]
                if not errs:
                    missions, units, added = build.build(files)
                    os.makedirs(build.DIST_DIR, exist_ok=True)
                    for path, rows in ((build.OUT_FILE, missions), (build.UNITS_OUT, units)):
                        with open(path, "w", encoding="utf-8") as fh:
                            json.dump(rows, fh, ensure_ascii=False, indent=1)
                    build.write_progress(files, missions)
                return self._send_json({
                    "ok": not errs,
                    "problems": [{"level": l, "file": f, "message": m}
                                 for l, f, m in problems],
                })
            if route == "/api/gme/account":
                return self._send_json(_gme_update_account(payload or {}))
            if route == "/api/gme/use-path":
                return self._send_json(_set_active_gme_path((payload or {}).get("path")))
            if route == "/api/gme/unit":
                return self._send_json(_gme_upsert_unit(payload or {}))
            if route == "/api/gme/unit/delete":
                return self._send_json(_gme_delete_unit(payload or {}))
            if route == "/api/gme/item":
                return self._send_json(_gme_upsert_item(payload or {}))
            if route == "/api/gme/item/delete":
                return self._send_json(_gme_delete_item(payload or {}))
            self.send_error(404, "Not found")
        except Exception as ex:
            self._error("%s: %s" % (type(ex).__name__, ex), 500)


def _default_drops(mission_id, weight=10):
    """TreasureDrop rows for a mission, from its area's material table."""
    info = bundle.mission_index().get(int(mission_id))
    if not info:
        return {"mission_id": mission_id, "items": [],
                "note": "mission id not in the game's mission table"}
    table = bundle.drop_tables().get(str(info["area_id"]))
    if not table:
        return {"mission_id": mission_id, "area_id": info["area_id"],
                "area": info["area"], "items": [],
                "note": "no drop data recorded for this area"}
    items = [{
        "target_type": 4, "target_id": str(it["item_id"]),
        "name": it.get("name", ""), "weight": weight, "amount": 1,
        "sources": it.get("locations", []),
    } for it in table.get("items", [])]
    return {
        "mission_id": mission_id, "area_id": info["area_id"],
        "area": table.get("area", info["area"]),
        "land_id": table.get("land_id", info["land_id"]),
        "items": items,
        "note": ("uniform weights — the source records which materials drop in "
                 "an area, not their rates"),
    }


def main():
    missing = [f for f in ("units.json", "areas.json")
               if not os.path.isfile(os.path.join(bundle.DATA_DIR, f))]
    if missing:
        print("ERROR: the reference bundle is incomplete — missing %s"
              % ", ".join(missing))
        print("       expected in %s (see EXPORTING.md)" % bundle.DATA_DIR)
        return 1
    print("BFO Mission Builder")
    print("  reference data : %s (%d units, %d missions)"
          % (bundle.DATA_DIR, len(bundle.units()), len(bundle.mission_index())))
    print("  your missions  : %s (%d file(s))"
          % (MISSIONS_DIR, len(build.load_contributions())))
    print("  open           : http://localhost:%d" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
