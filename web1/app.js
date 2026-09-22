/* Mission Editor.
 * Phase 1: edit missions/waves/enemies, place enemies on a battlefield canvas,
 *          validate, save to mission.json.
 * Phase 2: "Test in game" saves + hot-reloads the running server.
 * Phase 3: AI builder (edit ai.json — behaviors enemies reference by ai_id).
 * Schema reference: tools/mission-editor/DATA_MODEL.md
 */
"use strict";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = {
  meta: null,
  units: [],            // full F_UNIT_MST roster [{id,name,element,rarity,named,in_archive}]
  unitsById: new Map(),
  items: [],            // item catalog for treasure drops [{id,name,named}]
  itemsById: new Map(),
  ais: [],              // full AiRecord[] {id,name,actions[...]}
  missions: [],         // the edited array (MissionRecord[])
  mi: -1,               // current mission index
  si: 0,                // current stage index
  ei: -1,               // selected enemy index
  dirty: false,
  template: null,      // cached /api/mission-template for the current mission
  areaDrops: null,     // cached /api/default-drops for the current mission
  scopeTouched: false, // user picked a palette scope by hand for this mission
  aiIndex: -1,          // AI being edited in the AI builder
  aiDirty: false,
};

// What a freshly placed enemy starts with.  These are the game's common case
// rather than zeroes, so the usual enemy needs no drop editing at all — see
// makeEnemy() and defaultTreasure().
const DEFAULT_UNIT_DROP_CHANCE = 10;   // %
const DEFAULT_CHEST_CHANCE = 10;       // %
const DEFAULT_ZEL_REWARD = 500;
const DEFAULT_KARMA_REWARD = 250;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const api = {
  async get(p) { const r = await fetch(p); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async post(p, body) {
    const r = await fetch(p, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

const cur = () => (S.mi >= 0 ? S.missions[S.mi] : null);
const curStage = () => { const m = cur(); return m && m.stages[S.si]; };
const markDirty = () => { S.dirty = true; renderSaveStatus(); renderValidation(); };

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
async function boot() {
  try {
    const [meta, units, ais, missions, items] = await Promise.all([
      api.get("/api/meta"), api.get("/api/units"),
      api.get("/api/ais"), api.get("/api/missions"),
      api.get("/api/items").catch(() => []),   // optional: treasure picker only
    ]);
    S.meta = meta; S.units = units; S.ais = ais; S.missions = missions; S.items = items;
    S.unitsById = new Map(units.map((u) => [u.id, u]));
    S.itemsById = new Map(items.map((i) => [i.id, i]));
    bindPalette();
    renderMissionList(); renderPalette(); renderSaveStatus();
    if (missions.length) selectMission(0);
  } catch (e) {
    alert("Failed to load archive:\n" + e.message);
  }
}

// ---------------------------------------------------------------------------
// Mission list
// ---------------------------------------------------------------------------
function renderMissionList() {
  const ul = $("missionList"); ul.innerHTML = "";
  S.missions.forEach((m, i) => {
    const li = el("li", i === S.mi ? "active" : "");
    // Badge the worst problem in the mission so an unfinished one is visible
    // without clicking into it — a mission with no waves is the common case.
    const status = missionStatus(m);
    const badge = status === "err" ? '<span class="badge err" title="Has blocking problems">⚠</span>'
                : status === "warn" ? '<span class="badge warn" title="Has warnings">⚠</span>'
                : "";
    li.innerHTML = `${badge}<span class="mname">${escapeHtml(m.name || "(unnamed)")}</span>
                    <span class="mid"> #${m.id} · ${m.stages ? m.stages.length : 0} wave(s)</span>`;
    li.onclick = () => selectMission(i);
    ul.appendChild(li);
  });
}

function selectMission(i) {
  S.mi = i; S.si = 0; S.ei = -1;
  $("noMission").classList.add("hidden");
  $("missionEditor").classList.remove("hidden");
  renderMissionList(); renderHeader(); renderStages(); renderCanvas();
  renderEnemyInspector(); renderValidation();
  S.template = null; S.scopeTouched = false; showTemplateNote();
  // Warm the area's material table now, so adding an enemy can fill its chest
  // without waiting on a round trip.
  ensureAreaDrops();
}

// ---------------------------------------------------------------------------
// "New from MST"
//
// Authoring a mission used to start from a blank record and a made-up id.
// This browses the real F_MISSION_MST tree (land > area > dungeon > mission)
// and prefills id, name and rewards, so the only thing left to invent is the
// battle — which is the only part the game data does not preserve.
// ---------------------------------------------------------------------------
async function newFromMst() {
  let tree = S.areaTree;
  if (!tree) {
    try { tree = S.areaTree = await api.get("/api/areas"); }
    catch (e) { alert("Could not load the mission tree:\n" + e.message); return; }
  }
  // Flatten to one searchable row per mission, carrying its path for context.
  const rows = [];
  for (const land of tree) {
    for (const area of land.areas) {
      for (const d of area.dungeons) {
        for (const m of d.missions) {
          rows.push({
            id: m.id, name: m.name, named: m.named,
            area: area.name, land_id: land.land_id,
            subsystem: m.subsystem || "Grand Gaia",
            energy: m.energy_cost, battles: m.battle_count,
            exp: m.exp, zel: m.zel, karma: m.karma,
            has_template: m.has_template, authored: m.authored,
          });
        }
      }
    }
  }
  openPicker({
    title: "Pick a mission from the game data",
    rows,
    placeholder: `Search ${rows.length} missions — name, id, area, or "vortex"/"trial"…`,
    render: (m) => {
      const row = el("div", "unit pickrow" + (m.authored ? " already" : ""));
      row.innerHTML = `<span class="uname${m.named ? "" : " unnamed"}">${escapeHtml(m.name)}</span>
        <span class="mrow-meta">${escapeHtml(m.subsystem)} · ${escapeHtml(m.area)} · ${m.battles || "?"} wave(s) · ${m.energy || 0}⚡</span>
        ${m.has_template ? '<span class="pip" title="Original boss line-up available">●</span>'
                         : '<span class="pip ghosted" title="No line-up recorded">○</span>'}
        <span class="uid">#${m.id}</span>
        ${m.authored ? '<span class="tag">authored</span>' : ""}`;
      return row;
    },
    onPick: async (m) => {
      const existing = S.missions.findIndex((x) => x.id === m.id);
      if (existing >= 0) {
        selectMission(existing);
        flash(`Mission ${m.id} is already in the archive — selected it.`);
        return;
      }
      const mission = {
        id: m.id, name: m.name,
        zel: m.zel || 0, karma: m.karma || 0, exp: m.exp || 0,
        energy_cost: m.energy || 0,
        stages: [],   // filled below from the MST's own wave count
      };
      S.missions.push(mission);
      markDirty();
      renderMissionList();
      selectMission(S.missions.length - 1);
      flash(`Created mission ${m.id} “${m.name}” from the MST.`);
      flash(await prefillWaves(mission, m.battles));
    },
  });
}

// The MST already knows how many waves a mission had, and the wiki often knows
// what its boss wave was.  Laying both out on creation saves clicking "+ Add
// wave" five times and "⤓ Original line-up" once, for every mission authored.
//
// The regular waves are created EMPTY on purpose: nothing preserved which
// monsters they held, so filling them would be invention.  What you get is the
// right SHAPE — the correct number of waves, the boss where the boss belongs —
// and the validation list then names each wave still waiting on enemies.
async function prefillWaves(mission, battles) {
  let boss = null;
  try { boss = await fetchTemplate(mission.id); } catch (e) { boss = null; }
  if (boss && !(boss.monsters || []).length) boss = null;
  await ensureAreaDrops();          // so the boss wave's chests are filled
  if (mission !== cur()) return `Created mission ${mission.id}.`;

  const total = Math.max(battles || 0, 1);
  const plain = boss ? total - 1 : total;
  for (let i = 0; i < plain; i++) {
    mission.stages.push({ is_boss: false, first_attack_rate: 0, battle_monsters: [] });
  }
  if (boss) mission.stages.push(bossStage(boss));

  S.si = 0; S.ei = -1;
  markDirty();
  renderMissionList(); renderStages(); renderCanvas(); renderEnemyInspector();
  return boss
    ? `Laid out ${total} wave(s) — the “${boss.quest}” boss wave is built; the rest are yours to fill.`
    : `Laid out ${total} empty wave(s) — no original line-up recorded for this mission.`;
}

// The search box matches the picker's generic {id, name}; missions also want
// their area searchable, so widen the haystack for this row shape.
function pickHaystack(r) {
  // Subsystem is searchable so "vortex" or "trial" narrows the 3432-row list
  // straight to that content.
  return [r.name, r.id, r.area, r.subsystem].filter(Boolean).join(" ").toLowerCase();
}

function newMission() {
  const nextId = S.missions.reduce((mx, m) => Math.max(mx, m.id || 0), 0) + 1;
  S.missions.push({
    id: nextId, name: "New Mission", zel: 0, karma: 0, exp: 0, energy_cost: 0,
    stages: [{ is_boss: false, first_attack_rate: 0, battle_monsters: [] }],
  });
  markDirty(); renderMissionList(); selectMission(S.missions.length - 1);
}

function duplicateMission() {
  const m = cur(); if (!m) return;
  const copy = JSON.parse(JSON.stringify(m));
  copy.id = S.missions.reduce((mx, x) => Math.max(mx, x.id || 0), 0) + 1;
  copy.name = (m.name || "Mission") + " (copy)";
  S.missions.splice(S.mi + 1, 0, copy);
  markDirty(); selectMission(S.mi + 1);
}

function deleteMission() {
  const m = cur(); if (!m) return;
  if (!confirm(`Delete mission #${m.id} "${m.name}"?`)) return;
  S.missions.splice(S.mi, 1); markDirty();
  if (!S.missions.length) {
    S.mi = -1; $("missionEditor").classList.add("hidden");
    $("noMission").classList.remove("hidden"); renderMissionList();
  } else selectMission(Math.max(0, S.mi - 1));
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
function renderHeader() {
  const m = cur(); if (!m) return;
  $("fMid").value = m.id; $("fName").value = m.name || "";
  $("fZel").value = m.zel || 0; $("fKarma").value = m.karma || 0;
  $("fExp").value = m.exp || 0; $("fEnergy").value = m.energy_cost || 0;
}
function bindHeader() {
  const map = { fMid: "id", fName: "name", fZel: "zel", fKarma: "karma", fExp: "exp", fEnergy: "energy_cost" };
  for (const [id, key] of Object.entries(map)) {
    $(id).addEventListener("input", (e) => {
      const m = cur(); if (!m) return;
      m[key] = key === "name" ? e.target.value : intOr0(e.target.value);
      if (id === "fMid" || id === "fName") renderMissionList();
      markDirty();
    });
  }
  $("btnMstRewards").onclick = async () => {
    const m = cur(); if (!m) return;
    const r = await api.get("/api/mission-mst?id=" + encodeURIComponent(m.id));
    if (!r || r.zel == null) { alert("No mission MST entry for id " + m.id); return; }
    m.zel = r.zel; m.karma = r.karma; m.exp = r.exp; m.energy_cost = r.energy_cost;
    renderHeader(); markDirty();
  };
}

// ---------------------------------------------------------------------------
// Stages / waves
// ---------------------------------------------------------------------------
function renderStages() {
  const m = cur(); if (!m) return;
  const tabs = $("stageTabs"); tabs.innerHTML = "";
  m.stages.forEach((st, i) => {
    const t = el("div", "stage-tab" + (i === S.si ? " active" : "") + (st.is_boss ? " boss" : ""));
    t.innerHTML = `Wave ${i + 1}${st.is_boss ? " 👑" : ""} <span class="muted">(${st.battle_monsters.length})</span>`;
    const x = el("span", "x", "✕"); x.title = "Delete wave";
    x.onclick = (ev) => { ev.stopPropagation(); deleteStage(i); };
    t.appendChild(x);
    t.onclick = () => { S.si = i; S.ei = -1; renderStages(); renderCanvas(); renderEnemyInspector(); };
    tabs.appendChild(t);
  });
  const st = curStage();
  const props = $("stageProps"); props.innerHTML = "";
  if (st) {
    const boss = el("label", "", `<input type="checkbox" ${st.is_boss ? "checked" : ""}> Boss wave`);
    boss.querySelector("input").onchange = (e) => { st.is_boss = e.target.checked; renderStages(); renderCanvas(); markDirty(); };
    const fa = el("label", "", `First-attack % <input type="number" min="0" max="100" value="${st.first_attack_rate || 0}">`);
    fa.querySelector("input").oninput = (e) => { st.first_attack_rate = clamp(intOr0(e.target.value), 0, 100); markDirty(); };
    props.append(boss, fa);
  }
  $("stageLabel").textContent = st ? `— Wave ${S.si + 1}` : "";
}
function addStage() {
  const m = cur(); if (!m) return;
  m.stages.push({ is_boss: false, first_attack_rate: 0, battle_monsters: [] });
  S.si = m.stages.length - 1; S.ei = -1; markDirty();
  renderStages(); renderCanvas(); renderEnemyInspector();
}
function deleteStage(i) {
  const m = cur(); if (!m || m.stages.length <= 1) { alert("A mission needs at least one wave."); return; }
  if (!confirm(`Delete wave ${i + 1}?`)) return;
  m.stages.splice(i, 1); S.si = Math.max(0, S.si - (i <= S.si ? 1 : 0)); S.ei = -1;
  markDirty(); renderStages(); renderCanvas(); renderEnemyInspector();
}

// ---------------------------------------------------------------------------
// Battlefield canvas
// ---------------------------------------------------------------------------
function fieldToPct(x, y) {
  const f = S.meta.field;
  return { left: ((x - f.xMin) / (f.xMax - f.xMin)) * 100,
           top: ((y - f.yMin) / (f.yMax - f.yMin)) * 100 };
}
function pctToField(px, py) {
  const f = S.meta.field;
  return { x: Math.round(clamp(f.xMin + px * (f.xMax - f.xMin), f.xMin, f.xMax)),
           y: Math.round(clamp(f.yMin + py * (f.yMax - f.yMin), f.yMin, f.yMax)) };
}
function parsePos(p) { const [x, y] = String(p || "0:0").split(":").map(Number); return { x: x || 0, y: y || 0 }; }

function renderCanvas() {
  const bf = $("battlefield");
  bf.querySelectorAll(".token").forEach((t) => t.remove());
  const st = curStage();
  const empty = $("fieldEmpty");
  if (!st || !st.battle_monsters.length) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  st.battle_monsters.forEach((mon, idx) => {
    const { x, y } = parsePos(mon.position);
    const { left, top } = fieldToPct(x, y);
    const u = S.unitsById.get(mon.unit_id);
    const t = el("div", `token el-${u ? u.element : 0}` + (idx === S.ei ? " selected" : "") + (st.is_boss ? " boss" : ""));
    t.style.left = left + "%"; t.style.top = top + "%";
    t.innerHTML = `<span class="tname">${escapeHtml(mon.name || "?")}</span><span class="thp">${mon.hp || 0} HP</span>`;
    t.onmousedown = (ev) => startDrag(ev, idx);
    bf.appendChild(t);
  });
}

function startDrag(ev, idx) {
  ev.preventDefault();
  S.si; S.ei = idx; renderCanvas(); renderEnemyInspector();
  const bf = $("battlefield");
  const mon = curStage().battle_monsters[idx];
  let moved = false;
  const move = (e) => {
    const r = bf.getBoundingClientRect();
    const px = clamp((e.clientX - r.left) / r.width, 0, 1);
    const py = clamp((e.clientY - r.top) / r.height, 0, 1);
    const f = pctToField(px, py);
    mon.position = `${f.x}:${f.y}`;
    moved = true;
    renderCanvas(); const posInput = $("efPos"); if (posInput) posInput.value = mon.position;
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    if (moved) markDirty();
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}

// ---------------------------------------------------------------------------
// Enemy palette + add
// ---------------------------------------------------------------------------
// The palette is the whole F_UNIT_MST roster (2291), so it needs filters and a
// render cap — painting every match on each keystroke made typing stutter.
const PALETTE_CAP = 150;

// The scope narrows the palette to the monsters the ORIGINAL GAME used here,
// which is the difference between picking from 10 and picking from 2291.
// "dungeon" is the wiki's per-dungeon Monsters roster; "area" is the union
// across that area's dungeons, for the many dungeons whose page never filled
// the field in.
function scopeUnits(scope) {
  const t = S.template;
  if (scope === "dungeon" && t && t.roster && t.roster.length) {
    return new Set(t.roster.map((u) => u.id));
  }
  if (scope === "area" && t && t.area_roster && t.area_roster.length) {
    return new Set(t.area_roster.map((u) => u.id));
  }
  return null;   // no restriction
}

function filterUnits(q, element, rarity, curatedOnly, scope) {
  q = (q || "").trim().toLowerCase();
  const allowed = scopeUnits(scope);
  return S.units.filter((u) => {
    if (allowed && !allowed.has(u.id)) return false;
    if (element && Number(u.element) !== Number(element)) return false;
    if (rarity && Number(u.rarity) !== Number(rarity)) return false;
    if (curatedOnly && !u.in_archive) return false;
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || String(u.id).includes(q);
  });
}

// Rebuild the scope options for whatever mission is selected.  Defaults to the
// narrowest real roster available, since that is almost always what you want.
function refreshScopeOptions() {
  const sel = $("paletteScope");
  const prev = sel.value;
  const t = S.template;
  const dn = t && t.roster ? t.roster.length : 0;
  const an = t && t.area_roster ? t.area_roster.length : 0;
  sel.innerHTML = "";
  const add = (v, label) => {
    const o = el("option"); o.value = v; o.textContent = label; sel.appendChild(o);
  };
  if (dn) add("dungeon", `This dungeon — ${t.dungeon} (${dn})`);
  if (an) add("area", `This area — ${t.area} (${an})`);
  add("all", `All units (${S.units.length})`);
  // Default to the NARROWEST real roster — that is the whole point of curating,
  // and options are appended narrowest-first.  A scope the user picked by hand
  // is kept until they move to another mission (selectMission clears the flag),
  // so switching to "All units" to grab something odd is not undone underneath
  // them on the next re-render.
  const keep = S.scopeTouched && [...sel.options].some((o) => o.value === prev);
  sel.value = keep ? prev : sel.options[0].value;
}

function unitRow(u, cls) {
  const row = el("div", cls || "unit");
  // `named:false` means no English string exists for this unit in this client
  // build — it shows as "Unit <id>" and is dimmed rather than hidden.
  row.innerHTML = `<span class="dot el-${u.element}"></span>
    <span class="uname${u.named ? "" : " unnamed"}">${escapeHtml(u.name)}</span>
    <span class="star">${"★".repeat(u.rarity || 0)}</span>
    <span class="uid">#${u.id}</span>
    ${u.in_archive ? '<span class="pip" title="Already in unit.json">●</span>'
                   : '<span class="pip ghosted" title="Added to unit.json on save">○</span>'}`;
  return row;
}

function renderPalette() {
  const box = $("unitPalette"); box.innerHTML = "";
  const matches = filterUnits(
    $("paletteSearch").value, $("paletteElement").value,
    $("paletteRarity").value, $("paletteCurated").checked,
    $("paletteScope").value);

  matches.slice(0, PALETTE_CAP).forEach((u) => {
    const row = unitRow(u);
    row.title = "Add to current wave";
    row.onclick = () => addEnemy(u);
    box.appendChild(row);
  });

  const shown = Math.min(matches.length, PALETTE_CAP);
  $("paletteCount").textContent = matches.length > shown
    ? `${shown} of ${matches.length} — refine to see more`
    : `${matches.length} unit${matches.length === 1 ? "" : "s"}`;
  if (!matches.length) {
    box.appendChild(el("div", "muted small pad", "No unit matches those filters."));
  }
}

function bindPalette() {
  const elSel = $("paletteElement");
  for (const [k, name] of Object.entries(S.meta.elements)) {
    const o = el("option"); o.value = k; o.textContent = name; elSel.appendChild(o);
  }
  const rSel = $("paletteRarity");
  for (let r = 1; r <= 8; r++) {
    const o = el("option"); o.value = r; o.textContent = "★".repeat(r); rSel.appendChild(o);
  }
  ["paletteSearch", "paletteElement", "paletteRarity", "paletteCurated", "paletteScope"]
    .forEach((id) => $(id).addEventListener("input", renderPalette));
  $("paletteScope").addEventListener("input", () => { S.scopeTouched = true; });
}

// ---------------------------------------------------------------------------
// Reusable searchable picker
//
// Replaces the <select> that used to list every unit: 2291 <option>s is
// unusable, and the item list is 1668 more.  One modal serves both.
// ---------------------------------------------------------------------------
const PICK_CAP = 200;
let _pickState = null;

function openPicker({ title, rows, render, onPick, placeholder }) {
  _pickState = { rows, render, onPick };
  $("pickTitle").textContent = title;
  const search = $("pickSearch");
  search.value = "";
  search.placeholder = placeholder || "Type to search…";
  $("pickModal").classList.remove("hidden");
  renderPickList();
  search.focus();
}

function closePicker() {
  $("pickModal").classList.add("hidden");
  _pickState = null;
}

function renderPickList() {
  if (!_pickState) return;
  const q = ($("pickSearch").value || "").trim().toLowerCase();
  const box = $("pickList"); box.innerHTML = "";
  const matches = _pickState.rows.filter((r) => !q || pickHaystack(r).includes(q));
  matches.slice(0, PICK_CAP).forEach((r) => {
    const row = _pickState.render(r);
    row.onclick = () => { const cb = _pickState.onPick; closePicker(); cb(r); };
    box.appendChild(row);
  });
  const shown = Math.min(matches.length, PICK_CAP);
  $("pickCount").textContent = matches.length > shown
    ? `${shown} of ${matches.length}` : `${matches.length} match`;
  if (!matches.length) box.appendChild(el("div", "muted small pad", "No match."));
}

function pickUnit(onPick) {
  openPicker({
    title: "Pick a unit (visuals)", rows: S.units,
    placeholder: "Search 2291 units by name or id…",
    render: (u) => unitRow(u, "unit pickrow"), onPick,
  });
}

function pickItem(onPick) {
  openPicker({
    title: "Pick an item", rows: S.items,
    placeholder: "Search 1668 items by name or id…",
    render: (i) => {
      const row = el("div", "unit pickrow");
      row.innerHTML = `<span class="uname${i.named ? "" : " unnamed"}">${escapeHtml(i.name)}</span>
        <span class="uid">#${i.id}</span>`;
      return row;
    },
    onPick,
  });
}

// ---------------------------------------------------------------------------
// New-enemy defaults
//
// A newly placed enemy arrives configured the way the original game's enemies
// usually were, not zeroed:
//
//   * it drops ITSELF, at 10%, level 1, with a RANDOM personality type (0 —
//     the server rolls it per mission start against F_UNIT_TYPE_MST's own
//     appearance rates, so replaying can award a different variant);
//   * it guards a 10% treasure chest holding everything its area drops, plus
//     the usual zel and karma rows.
//
// A BOSS gets the chest but no unit drop: a boss was the mission's objective,
// not something farmed off it, and the few that were capturable are the
// exception an author sets deliberately.  Every one of these is one control in
// the inspector away from being changed or cleared.
// ---------------------------------------------------------------------------
function makeEnemy({ id, unitId, name, hp, position, isBoss }) {
  const drops = !isBoss;
  return {
    id, name, unit_id: unitId, position,
    hp, atk: 300, def: 100,
    ai_id: S.ais.length ? S.ais[0].id : 1, act_min: 1, act_max: 1, wait: 5,
    unit_drop_id: drops ? unitId : 0,
    unit_drop_level: drops ? 1 : 0,
    unit_drop_type: 0,
    unit_drop_chance: drops ? DEFAULT_UNIT_DROP_CHANCE : 0,
    zel_max_drop: 10, zel_drop_count: 5, karma_max_drop: 8, karma_drop_count: 5,
    treasure_chest_chance: DEFAULT_CHEST_CHANCE,
    treasure_drops: defaultTreasure(),
  };
}

// The area's material table, cached per mission.  Fetched when a mission is
// selected so placing an enemy stays instant; callers that arrive while that
// request is still open share it instead of firing their own.
let _dropsInFlight = null;   // { mission_id, promise }

async function ensureAreaDrops() {
  const m = cur();
  if (!m) return null;
  if (S.areaDrops && S.areaDrops.mission_id === m.id) return S.areaDrops;
  if (_dropsInFlight && _dropsInFlight.mission_id === m.id) return _dropsInFlight.promise;
  const promise = (async () => {
    let res;
    try { res = await api.get(`/api/default-drops?mission=${encodeURIComponent(m.id)}`); }
    catch (e) { res = { items: [], note: "area lookup failed: " + e.message }; }
    // The selection can move while the request is open; only cache a result
    // that still belongs to the mission on screen.
    if (cur() !== m) return null;
    S.areaDrops = { mission_id: m.id, area: res.area || "",
                    items: res.items || [], note: res.note || "" };
    return S.areaDrops;
  })();
  _dropsInFlight = { mission_id: m.id, promise };
  promise.finally(() => {
    if (_dropsInFlight && _dropsInFlight.promise === promise) _dropsInFlight = null;
  });
  return promise;
}

// The chest contents a new enemy starts with.  The coin rows go in even when
// the area has no recorded materials (or the lookup has not landed yet), so a
// chest that can open is never empty — which is a validation warning.
function defaultTreasure() {
  const m = cur();
  const ad = m && S.areaDrops && S.areaDrops.mission_id === m.id ? S.areaDrops : null;
  const rows = (ad ? ad.items : []).map((it) => ({
    target_type: 4, target_id: String(it.target_id),
    weight: it.weight, amount: it.amount,
  }));
  rows.push({ target_type: 1, weight: 10, amount: DEFAULT_ZEL_REWARD, target_id: "" });
  rows.push({ target_type: 2, weight: 10, amount: DEFAULT_KARMA_REWARD, target_id: "" });
  return rows;
}

function nextSlot(st) {
  const slots = S.meta.slots;
  const used = new Set(st.battle_monsters.map((m) => m.position));
  for (const s of slots) { const p = `${s.x}:${s.y}`; if (!used.has(p)) return p; }
  // fall back to a jittered center
  const f = S.meta.field;
  return `${Math.round((f.xMin + f.xMax) / 2)}:${Math.round((f.yMin + f.yMax) / 2)}`;
}

async function addEnemy(u) {
  // Await the area table BEFORE reading the stage, so everything below runs
  // against the wave that is actually on screen when the enemy lands.
  await ensureAreaDrops();
  const st = curStage();
  if (!st) { alert("Create/select a wave first."); return; }
  if (st.battle_monsters.length >= S.meta.limits.maxMonstersPerStage) {
    alert(`A wave can hold at most ${S.meta.limits.maxMonstersPerStage} enemies.`); return;
  }
  st.battle_monsters.push(makeEnemy({
    id: u.id, unitId: u.id, name: u.name, hp: 1000,
    position: nextSlot(st), isBoss: st.is_boss,
  }));
  S.ei = st.battle_monsters.length - 1; markDirty();
  renderStages(); renderCanvas(); renderEnemyInspector();
}

// ---------------------------------------------------------------------------
// Enemy inspector
// ---------------------------------------------------------------------------
function renderEnemyInspector() {
  const insp = $("enemyInspector"); const box = $("enemyFields");
  const st = curStage();
  if (!st || S.ei < 0 || S.ei >= st.battle_monsters.length) { insp.classList.add("hidden"); return; }
  insp.classList.remove("hidden"); box.innerHTML = "";
  const m = st.battle_monsters[S.ei];

  const num = (id, key, label, opts = {}) => field(box, id, label, "number", m[key], (v) => {
    m[key] = clamp(intOr0(v), opts.min ?? 0, opts.max ?? Infinity);
    if (key === "hp") renderCanvas(); markDirty();
  });
  const txt = (id, key, label) => field(box, id, label, "text", m[key], (v) => { m[key] = v; markDirty(); if (key==="name"){renderCanvas();renderStages();} });

  box.append(hdr("Identity"));
  txt("efName", "name", "Name");
  num("efMonId", "id", "Monster ID");
  // Unit picker.  A <select> here used to hold all 2291 units, which is
  // unusable; this opens the searchable picker instead.
  const wrap = el("label", "", "Unit (visuals)");
  const u = S.unitsById.get(m.unit_id);
  const bUnit = el("button", "btn ghost pickbtn",
    u ? `${escapeHtml(u.name)} (#${u.id})` : `#${m.unit_id} — not in the roster`);
  bUnit.title = "Change which unit supplies this enemy's sprite and animations";
  bUnit.onclick = () => pickUnit((picked) => {
    m.unit_id = picked.id;
    renderCanvas(); markDirty(); renderEnemyInspector();
  });
  wrap.appendChild(bUnit); box.appendChild(wrap);
  field(box, "efPos", "Position (x:y)", "text", m.position, (v) => { m.position = v; renderCanvas(); markDirty(); });

  box.append(hdr("Combat"));
  num("efHp", "hp", "HP"); num("efAtk", "atk", "ATK"); num("efDef", "def", "DEF");
  // AI picker
  const aiWrap = el("label", "", "AI behavior");
  const aiSel = el("select");
  S.ais.forEach((a) => { const o = el("option"); o.value = a.id;
    o.textContent = `${a.name} (#${a.id})`; if (a.id === m.ai_id) o.selected = true; aiSel.appendChild(o); });
  aiSel.onchange = (e) => { m.ai_id = intOr0(e.target.value); markDirty(); };
  aiWrap.appendChild(aiSel); box.appendChild(aiWrap);
  num("efActMin", "act_min", "Acts min", { min: 1 }); num("efActMax", "act_max", "Acts max", { min: 1 });
  num("efWait", "wait", "Wait");

  box.append(hdr("Unit drop"));
  // Unit picker rather than a raw id box — same searchable modal as visuals.
  {
    const wrap = el("label", "", "Unit dropped");
    const du = S.unitsById.get(m.unit_drop_id);
    const b = el("button", "btn ghost pickbtn",
      m.unit_drop_id ? (du ? `${escapeHtml(du.name)} (#${m.unit_drop_id})` : `#${m.unit_drop_id}`)
                     : "None");
    b.onclick = () => pickUnit((picked) => {
      m.unit_drop_id = picked.id;
      if (!m.unit_drop_level) m.unit_drop_level = 1;   // never leave it at 0
      if (!m.unit_drop_chance) m.unit_drop_chance = DEFAULT_UNIT_DROP_CHANCE;
      markDirty(); renderEnemyInspector();
    });
    wrap.appendChild(b); box.appendChild(wrap);
    if (m.unit_drop_id) {
      const clr = el("button", "btn tiny ghost", "Clear drop");
      clr.onclick = () => {
        m.unit_drop_id = 0; m.unit_drop_chance = 0; m.unit_drop_level = 0;
        markDirty(); renderEnemyInspector();
      };
      box.appendChild(clr);
    }
  }
  // Level is floored at 1 whenever the drop can actually fire — a level-0 unit
  // reaches the client as a broken record.
  num("efDropLvl", "unit_drop_level", "Level", { min: (m.unit_drop_chance || 0) > 0 ? 1 : 0 });
  // 0 = "Random", rolled server-side per mission start against F_UNIT_TYPE_MST's
  // own appearance rates (23/23/22/22/10/0), so replaying can award a different
  // variant and the author never has to hardcode one.
  typeSelect(box, "Variant", m.unit_drop_type,
    Object.assign({ 0: "Random (game rates)" }, S.meta.unitTypes),
    (v) => { m.unit_drop_type = v; markDirty(); });
  num("efDropChance", "unit_drop_chance", "Chance %", { max: 100 });

  box.append(hdr("Zel / Karma drop"));
  num("efZelMax", "zel_max_drop", "Zel max"); num("efZelCnt", "zel_drop_count", "Zel rolls");
  num("efKarMax", "karma_max_drop", "Karma max"); num("efKarCnt", "karma_drop_count", "Karma rolls");

  box.append(hdr("Treasure chest"));
  num("efTreasChance", "treasure_chest_chance", "Chest %", { max: 100 });
  renderTreasureTable(box, m);
}

// ---------------------------------------------------------------------------
// Treasure drop table
//
// The weighted table rolled when an enemy's chest hits.  "Apply area defaults"
// fills it from the materials the original game dropped in this mission's area
// (recovered from the wiki — see DATA_MODEL.md §7.1), so recreating a mission
// does not mean inventing its loot.
// ---------------------------------------------------------------------------
function renderTreasureTable(box, m) {
  const wrap = el("div", "full treasure");

  const head = el("div", "treasure-head");
  head.appendChild(el("span", "muted small",
    `${m.treasure_drops.length} reward${m.treasure_drops.length === 1 ? "" : "s"}`));
  const btns = el("span", "row-actions");
  const bAdd = el("button", "btn tiny", "+ Add");
  bAdd.onclick = () => {
    m.treasure_drops.push({ target_type: 1, weight: 10, amount: 100, target_id: "" });
    markDirty(); renderEnemyInspector();
  };
  const bDef = el("button", "btn tiny ghost", "⤓ Area drops");
  bDef.title = "Fill from the materials this mission's area drops";
  bDef.onclick = () => applyAreaDefaults(m);
  const bGold = el("button", "btn tiny ghost", "+ Zel/Karma");
  bGold.title = "Add the usual coin rewards alongside the materials";
  bGold.onclick = () => {
    m.treasure_drops.push({ target_type: 1, weight: 10, amount: DEFAULT_ZEL_REWARD, target_id: "" });
    m.treasure_drops.push({ target_type: 2, weight: 10, amount: DEFAULT_KARMA_REWARD, target_id: "" });
    if (!m.treasure_chest_chance) m.treasure_chest_chance = DEFAULT_CHEST_CHANCE;
    markDirty(); renderEnemyInspector();
  };
  btns.append(bAdd, bDef, bGold);
  head.appendChild(btns);
  wrap.appendChild(head);

  m.treasure_drops.forEach((d, i) => {
    const row = el("div", "treasure-row");

    const tSel = el("select");
    for (const [k, name] of Object.entries(S.meta.treasureTypes)) {
      const o = el("option"); o.value = k; o.textContent = name;
      if (Number(k) === Number(d.target_type)) o.selected = true;
      tSel.appendChild(o);
    }
    tSel.onchange = (e) => {
      d.target_type = intOr0(e.target.value);
      // target_id only means anything for items (type 4); clear it otherwise
      // so validation rule 5 cannot be tripped by a stale id.
      if (d.target_type !== 4) d.target_id = "";
      markDirty(); renderEnemyInspector();
    };
    row.appendChild(tSel);

    if (Number(d.target_type) === 4) {
      const item = S.itemsById.get(Number(d.target_id));
      const bItem = el("button", "btn tiny ghost itembtn",
        item ? escapeHtml(item.name) : (d.target_id ? `#${escapeHtml(d.target_id)}` : "Pick item…"));
      bItem.title = d.target_id ? `Item #${d.target_id}` : "Choose the item this entry awards";
      bItem.onclick = () => pickItem((it) => {
        d.target_id = String(it.id); markDirty(); renderEnemyInspector();
      });
      row.appendChild(bItem);
    } else {
      row.appendChild(el("span", "muted small", "—"));
    }

    const w = el("input"); w.type = "number"; w.min = "1"; w.value = d.weight ?? 1;
    w.title = "Relative weight in the roll";
    w.oninput = (e) => { d.weight = clamp(intOr0(e.target.value), 1, Infinity); markDirty(); };
    row.appendChild(w);

    const a = el("input"); a.type = "number"; a.min = "0"; a.value = d.amount ?? 0;
    a.title = "Amount awarded";
    a.oninput = (e) => { d.amount = clamp(intOr0(e.target.value), 0, Infinity); markDirty(); };
    row.appendChild(a);

    const del = el("button", "btn tiny danger", "×");
    del.title = "Remove this entry";
    del.onclick = () => { m.treasure_drops.splice(i, 1); markDirty(); renderEnemyInspector(); };
    row.appendChild(del);

    wrap.appendChild(row);
  });

  if (m.treasure_drops.length) {
    const total = m.treasure_drops.reduce((s, d) => s + (Number(d.weight) || 0), 0);
    wrap.appendChild(el("div", "muted small",
      `Total weight ${total} — each entry's chance is its weight ÷ ${total}.`));
  }
  box.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// Original line-up template
//
// The wiki preserved each mission's BOSS wave (`boss1..boss5` on its dungeon
// page), matched to our mission id by the (energy, battles, exp) signature.
// This builds that wave rather than the whole mission — the regular waves were
// never recorded anywhere, and inventing them would be fabrication.
// ---------------------------------------------------------------------------
// Throws on a transport failure; resolves to null when the mission simply has
// no recorded line-up.  Callers distinguish the two.
async function fetchTemplate(missionId) {
  const t = await api.get(`/api/mission-template?mission=${encodeURIComponent(missionId)}`);
  return t && t.mission_id ? t : null;
}

// The boss wave the wiki preserved, as a stage ready to push.
function bossStage(t) {
  return {
    is_boss: true, first_attack_rate: 0,
    battle_monsters: t.monsters.slice(0, S.meta.limits.maxMonstersPerStage)
      .map((x, i) => makeEnemy({
        id: x.unit_id, unitId: x.unit_id, name: x.name || `Unit ${x.unit_id}`,
        hp: x.hp || 1000,
        position: (S.meta.slots[i] ? `${S.meta.slots[i].x}:${S.meta.slots[i].y}`
                                   : `${180 - i * 30}:${302 + i * 20}`),
        isBoss: true,
      })),
  };
}

async function showTemplateNote() {
  const note = $("templateNote");
  const m = cur();
  if (!m) { note.classList.add("hidden"); return; }
  try {
    const t = await fetchTemplate(m.id);
    if (!t) {
      S.template = null; refreshScopeOptions(); renderPalette();
      note.className = "template-note muted";
      note.textContent = `No original line-up recorded for mission ${m.id}.`;
      return;
    }
    S.template = t;
    refreshScopeOptions(); renderPalette();
    const mons = (t.monsters || []).map((x) => x.name || `#${x.unit_id}`).join(", ");
    note.className = "template-note";
    note.innerHTML = `<b>${escapeHtml(t.area)} · ${escapeHtml(t.dungeon)}</b> —
      “${escapeHtml(t.quest)}” · ${t.battles} wave(s), ${t.energy} energy, ${t.exp} exp
      ${mons ? `· boss wave: <b>${escapeHtml(mons)}</b>` : "· no boss recorded"}
      ${t.drops && t.drops.length ? `· drops ${escapeHtml(t.drops.join(", "))}` : ""}`;
  } catch (e) {
    note.className = "template-note muted";
    note.textContent = "Template lookup failed: " + e.message;
  }
}

async function applyTemplate() {
  const m = cur();
  if (!m) return;
  let t = S.template;
  if (!t || t.mission_id !== m.id) {
    try { t = await fetchTemplate(m.id); }
    catch (e) { alert("Template lookup failed:\n" + e.message); return; }
  }
  if (!t || !(t.monsters || []).length) {
    flash(`No original line-up recorded for mission ${m.id}.`);
    return;
  }
  if (!confirm(
      `Add a boss wave with ${t.monsters.length} enemy(ies) from “${t.quest}”?\n\n` +
      `${t.monsters.map((x) => `• ${x.name || "#" + x.unit_id}` +
        (x.hp ? ` (${x.hp} HP)` : "")).join("\n")}\n\n` +
      `The wiki records only the boss wave — the regular waves are not preserved ` +
      `anywhere and are left for you to author.`)) return;

  await ensureAreaDrops();          // so the boss's chest comes filled
  if (cur() !== m) return;
  m.stages.push(bossStage(t));
  S.si = m.stages.length - 1; S.ei = 0;
  // Rewards are authoritative in the MST; only fill what is still at zero so a
  // template never overwrites values the author already set.
  if (!m.energy_cost && t.energy) m.energy_cost = t.energy;
  if (!m.exp && t.exp) m.exp = t.exp;
  markDirty();
  renderHeader(); renderStages(); renderCanvas(); renderEnemyInspector();
  flash(`Added the “${t.quest}” boss wave.`);
}

async function applyAreaDefaults(m) {
  const ad = await ensureAreaDrops();
  if (!ad) return;
  if (!ad.items.length) {
    flash(ad.note || "No drop data for this mission's area.");
    return;
  }
  const have = new Set(m.treasure_drops
    .filter((d) => Number(d.target_type) === 4).map((d) => String(d.target_id)));
  let added = 0;
  for (const it of ad.items) {
    if (have.has(String(it.target_id))) continue;   // never duplicate an entry
    m.treasure_drops.push({
      target_type: 4, target_id: String(it.target_id),
      weight: it.weight, amount: it.amount,
    });
    added++;
  }
  if (m.treasure_chest_chance === 0) m.treasure_chest_chance = DEFAULT_CHEST_CHANCE;
  markDirty(); renderEnemyInspector();
  flash(added
    ? `Added ${added} material${added === 1 ? "" : "s"} from ${ad.area || "this area"}.`
    : `Already has every material ${ad.area || "this area"} drops.`);
}

function typeSelect(box, label, val, options, onchange) {
  const wrap = el("label", "", label);
  const sel = el("select");
  for (const [k, name] of Object.entries(options)) {
    const o = el("option"); o.value = k; o.textContent = `${k} · ${name}`;
    if (Number(k) === Number(val)) o.selected = true; sel.appendChild(o);
  }
  sel.onchange = (e) => onchange(intOr0(e.target.value));
  wrap.appendChild(sel); box.appendChild(wrap);
}

function field(box, id, label, type, value, oninput) {
  const wrap = el("label"); wrap.textContent = label;
  const inp = el("input"); inp.id = id; inp.type = type; inp.value = value ?? "";
  inp.addEventListener("input", (e) => oninput(e.target.value));
  wrap.appendChild(inp); box.appendChild(wrap); return inp;
}
function hdr(t) { return el("h4", null, t); }

// Inline label+input (no id) for dynamically-rendered rows.
function inlineInput(parent, label, type, value, oninput) {
  const wrap = el("label"); wrap.textContent = label;
  const inp = el("input"); inp.type = type; inp.value = value ?? "";
  inp.addEventListener("input", (e) => oninput(e.target.value));
  wrap.appendChild(inp); parent.appendChild(wrap); return inp;
}
const numInline = (p, l, v, f) => inlineInput(p, l, "number", v, f);
const txtInline = (p, l, v, f) => inlineInput(p, l, "text", v, f);

// Text input with a datalist of suggestions — pick a known value or type a custom one.
function comboField(parent, label, value, suggestions, oninput) {
  const wrap = el("label"); wrap.textContent = label;
  const inp = el("input"); inp.type = "text"; inp.value = value ?? "";
  const listId = "dl_" + Math.random().toString(36).slice(2);
  inp.setAttribute("list", listId);
  const dl = el("datalist"); dl.id = listId;
  (suggestions || []).forEach((s) => { const o = el("option"); o.value = s; dl.appendChild(o); });
  inp.addEventListener("input", (e) => oninput(e.target.value));
  wrap.append(inp, dl); parent.appendChild(wrap); return inp;
}

// ---------------------------------------------------------------------------
// Validation (DATA_MODEL.md §8)
// ---------------------------------------------------------------------------
// Every issue carries WHERE it lives (stage index, enemy index) so the list
// can jump straight to it — a warning you cannot navigate to is just noise.
function validateMission(m) {
  const issues = [];
  if (!m) return issues;
  const add = (kind, msg, at) => issues.push({ kind, msg, at: at || {} });

  if (S.missions.filter((x) => x.id === m.id).length > 1) {
    add("err", `Mission id ${m.id} is used by another mission.`, { field: "fMid" });
  }
  if (!m.stages.length) {
    add("err", "Mission has no waves — add at least one.", { addWave: true });
  }
  m.stages.forEach((st, si) => {
    const n = st.battle_monsters.length;
    if (n < 1) add("err", `Wave ${si + 1} has no enemies.`, { si });
    if (n > S.meta.limits.maxMonstersPerStage) {
      add("err", `Wave ${si + 1} exceeds ${S.meta.limits.maxMonstersPerStage} enemies.`, { si });
    }
    st.battle_monsters.forEach((mon, ei) => {
      const where = `W${si + 1}·${mon.name || "enemy"}`;
      const at = { si, ei };
      if (!S.unitsById.has(mon.unit_id)) {
        add("err", `${where}: unit ${mon.unit_id} is not in the roster.`, at);
      }
      if (!S.ais.some((a) => a.id === mon.ai_id)) {
        add("err", `${where}: ai_id ${mon.ai_id} not in ai.json.`, at);
      }
      if (!/^\d+:\d+$/.test(String(mon.position))) {
        add("warn", `${where}: position "${mon.position}" isn't x:y.`, at);
      }
      for (const k of ["unit_drop_chance", "treasure_chest_chance"]) {
        if ((mon[k] || 0) > 100) add("warn", `${where}: ${k} is over 100%.`, at);
      }
      // A drop that can fire has to say what level it hands over: level 0
      // reaches the client as a level-0 unit.
      if ((mon.unit_drop_chance || 0) > 0) {
        if (!mon.unit_drop_id) {
          add("err", `${where}: drop chance is set but no unit is selected.`, at);
        } else if (!mon.unit_drop_level || mon.unit_drop_level < 1) {
          add("err", `${where}: drop level must be at least 1 when the drop can fire.`, at);
        }
      }
      // A chest that can open needs something in it, and every item entry
      // needs its item (DATA_MODEL §8 rule 5).
      if ((mon.treasure_chest_chance || 0) > 0 && !mon.treasure_drops.length) {
        add("warn", `${where}: chest can open but its table is empty.`, at);
      }
      mon.treasure_drops.forEach((d, di) => {
        if (Number(d.target_type) === 4 && !String(d.target_id || "").trim()) {
          add("err", `${where}: treasure row ${di + 1} is an item with no item picked.`, at);
        }
        if ((Number(d.weight) || 0) <= 0) {
          add("warn", `${where}: treasure row ${di + 1} has weight 0 — it can never be picked.`, at);
        }
      });
    });
  });
  return issues;
}

const validate = () => validateMission(cur());

// Worst severity per mission, for the badge in the list.
function missionStatus(m) {
  const issues = validateMission(m);
  if (issues.some((i) => i.kind === "err")) return "err";
  if (issues.length) return "warn";
  return "ok";
}

function renderValidation() {
  const ul = $("validationList"); ul.innerHTML = "";
  const issues = validate();
  if (!issues.length) { ul.appendChild(el("li", "ok", "✓ No problems.")); return; }
  issues.forEach((iss) => {
    const li = el("li", iss.kind + " jump");
    li.textContent = (iss.kind === "err" ? "⚠ " : "• ") + iss.msg;
    li.title = "Go to this problem";
    li.onclick = () => goToIssue(iss);
    ul.appendChild(li);
  });
}

// Navigate to whatever the issue is about, then flag the control so the eye
// lands on it.
function goToIssue(iss) {
  const at = iss.at || {};
  if (at.addWave) { addStage(); return; }
  if (at.field) {
    const f = $(at.field);
    if (f) { f.focus(); f.classList.add("flagged"); setTimeout(() => f.classList.remove("flagged"), 1600); }
    return;
  }
  if (at.si != null) {
    S.si = at.si;
    S.ei = at.ei != null ? at.ei : -1;
    renderStages(); renderCanvas(); renderEnemyInspector();
    const target = at.ei != null ? $("enemyInspector") : $("stageTabs");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("flagged");
      setTimeout(() => target.classList.remove("flagged"), 1600);
    }
  }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------
function renderSaveStatus() {
  const s = $("saveStatus");
  s.textContent = S.dirty ? "● Unsaved changes" : "Saved";
  s.className = "save-status " + (S.dirty ? "dirty" : "saved");
}
async function save() {
  const errs = validate().filter(([k]) => k === "err");
  if (errs.length && !confirm(`There are ${errs.length} error(s). Save anyway?`)) return;
  try {
    await api.post("/api/missions", S.missions);
    S.dirty = false; renderSaveStatus();
    flash("Saved to mission.json — restart the server (or use Test, later) to load it.");
  } catch (e) { alert("Save failed:\n" + e.message); }
}
function flash(msg) {
  const s = $("saveStatus"); s.textContent = "✓ " + msg; s.className = "save-status saved";
  setTimeout(renderSaveStatus, 4000);
}

// Newline as a value rather than an escape — keeps multi-line alert text out of
// string literals, which several of this file's edits have mangled.
const NL = String.fromCharCode(10);

async function testInGame() {
  // Standalone: there is no running game server to hot-reload here.  Saving
  // writes one file per dungeon, then the build validates every contribution
  // and refreshes PROGRESS.md — the same checks CI runs on a pull request.
  await save();
  try {
    const r = await api.post("/api/build", S.missions);
    const errs = (r.problems || []).filter((p) => p.level === "error");
    const warns = (r.problems || []).filter((p) => p.level === "warn");
    if (errs.length) {
      const lines = errs.slice(0, 12).map((p) => "• " + p.file + ": " + p.message);
      if (errs.length > 12) lines.push("…and " + (errs.length - 12) + " more");
      alert(["Build found problems that must be fixed:", ""].concat(lines).join(NL));
    } else {
      flash("Build OK — " + warns.length + " warning(s). PROGRESS.md updated.");
    }
  } catch (e) {
    alert("Build failed:" + NL + e.message);
  }
}

// ---------------------------------------------------------------------------
// AI builder (Phase 3) — edits ai.json; enemies reference an AI by ai_id.
// ---------------------------------------------------------------------------
const curAi = () => (S.aiIndex >= 0 && S.aiIndex < S.ais.length ? S.ais[S.aiIndex] : null);

function newAiAction(priority) {
  return {
    priority: priority || 1, percent: 100, act_target: 2, search_term: "random",
    self_conditions: [], party_conditions: [],
    action: { type: "attack", flag_changes: [], unknown_bool: true, unknown_int_1: 0, unknown_int_2: 0 },
  };
}

function openAiModal() {
  $("aiModal").classList.remove("hidden");
  if (S.aiIndex < 0 && S.ais.length) S.aiIndex = 0;
  renderAiSaveStatus(); renderAiList(); renderAiEditor();
}
function closeAiModal() {
  if (S.aiDirty && !confirm("Close without saving AI changes?")) return;
  $("aiModal").classList.add("hidden");
}
function markAiDirty() { S.aiDirty = true; renderAiSaveStatus(); }
function renderAiSaveStatus() {
  const s = $("aiSaveStatus");
  s.textContent = S.aiDirty ? "● Unsaved" : "Saved";
  s.className = "save-status " + (S.aiDirty ? "dirty" : "saved");
}

function renderAiList() {
  const ul = $("aiList"); ul.innerHTML = "";
  S.ais.forEach((a, i) => {
    const li = el("li", i === S.aiIndex ? "active" : "");
    li.innerHTML = `<span class="mname">${escapeHtml(a.name || "(unnamed)")}</span>
                    <span class="mid"> #${a.id} · ${(a.actions || []).length} action(s)</span>`;
    li.onclick = () => { S.aiIndex = i; renderAiList(); renderAiEditor(); };
    ul.appendChild(li);
  });
}

function newAi() {
  const nextId = S.ais.reduce((mx, a) => Math.max(mx, a.id || 0), 0) + 1;
  S.ais.push({ id: nextId, name: "New AI", actions: [newAiAction(1)] });
  S.aiIndex = S.ais.length - 1; markAiDirty(); renderAiList(); renderAiEditor();
}
function deleteAi() {
  const a = curAi(); if (!a) return;
  const used = usedByEnemies(a.id);
  const warn = used ? `\n\nWarning: ${used} enemy(ies) reference this AI and will break.` : "";
  if (!confirm(`Delete AI #${a.id} "${a.name}"?${warn}`)) return;
  S.ais.splice(S.aiIndex, 1);
  S.aiIndex = Math.min(S.aiIndex, S.ais.length - 1);
  markAiDirty(); renderAiList(); renderAiEditor();
}
function usedByEnemies(aiId) {
  let n = 0;
  S.missions.forEach((m) => (m.stages || []).forEach((st) =>
    st.battle_monsters.forEach((mon) => { if (mon.ai_id === aiId) n++; })));
  return n;
}

function renderAiEditor() {
  const a = curAi();
  $("aiEditor").classList.toggle("hidden", !a);
  $("aiNone").classList.toggle("hidden", !!a);
  if (!a) return;
  $("aiName").value = a.name || ""; $("aiId").value = a.id;
  $("aiName").oninput = (e) => { a.name = e.target.value; renderAiList(); markAiDirty(); };
  $("aiId").oninput = (e) => { a.id = intOr0(e.target.value); renderAiList(); markAiDirty(); };
  renderAiActions();
}
function renderAiActions() {
  const a = curAi(); const box = $("aiActions"); box.innerHTML = "";
  (a.actions || []).forEach((act, i) => box.appendChild(aiActionCard(a, act, i)));
}
function aiActionCard(a, act, idx) {
  const card = el("div", "ai-action");
  const top = el("div", "ai-action-top");
  numInline(top, "Priority", act.priority, (v) => { act.priority = intOr0(v); markAiDirty(); });
  numInline(top, "Chance %", act.percent, (v) => { act.percent = clamp(intOr0(v), 0, 100); markAiDirty(); });
  comboField(top, "Action", act.action.type, S.meta.aiVocab.actionTypes, (v) => { act.action.type = v; markAiDirty(); });
  comboField(top, "Target search", act.search_term, S.meta.aiVocab.searchTerms, (v) => { act.search_term = v; markAiDirty(); });
  numInline(top, "Act target", act.act_target, (v) => { act.act_target = intOr0(v); markAiDirty(); });
  const del = el("button", "chip-btn", "✕"); del.title = "Delete action";
  del.onclick = () => { a.actions.splice(idx, 1); markAiDirty(); renderAiActions(); };
  top.appendChild(del);
  card.appendChild(top);
  card.appendChild(condGroup("Self conditions (about the enemy)", act.self_conditions, "self"));
  card.appendChild(condGroup("Party conditions (about your team)", act.party_conditions, "party"));
  return card;
}
function condGroup(title, list, kind) {
  const g = el("div", "ai-cond-group");
  const h = el("h5", null, title);
  const add = el("button", "chip-btn", "+ add");
  add.onclick = () => {
    if (kind === "self") list.push({ type: "hp_pr_under", parameter: 50 });
    else list.push({ target_id: 0, target_parameter: "non", type: "non", parameters: "non" });
    markAiDirty(); renderAiActions();
  };
  h.appendChild(add); g.appendChild(h);
  list.forEach((c, ci) => {
    const row = el("div", "ai-cond-row");
    if (kind === "self") {
      comboField(row, "Type", c.type, S.meta.aiVocab.selfConditionTypes, (v) => { c.type = v; markAiDirty(); });
      numInline(row, "Param", c.parameter, (v) => { c.parameter = intOr0(v); markAiDirty(); });
    } else {
      numInline(row, "Target id", c.target_id, (v) => { c.target_id = intOr0(v); markAiDirty(); });
      txtInline(row, "Target param", c.target_parameter, (v) => { c.target_parameter = v; markAiDirty(); });
      txtInline(row, "Type", c.type, (v) => { c.type = v; markAiDirty(); });
      txtInline(row, "Params", c.parameters, (v) => { c.parameters = v; markAiDirty(); });
    }
    const del = el("button", "chip-btn", "✕");
    del.onclick = () => { list.splice(ci, 1); markAiDirty(); renderAiActions(); };
    row.appendChild(del); g.appendChild(row);
  });
  return g;
}
async function saveAis() {
  try {
    await api.post("/api/ais", S.ais);
    S.aiDirty = false; renderAiSaveStatus();
    if (cur()) renderEnemyInspector();  // AI names may have changed
    const s = $("aiSaveStatus"); s.textContent = "✓ Saved — Test in game to load.";
    s.className = "save-status saved";
  } catch (e) { alert("Save AIs failed:\n" + e.message); }
}

// ---------------------------------------------------------------------------
// Utils + wiring
// ---------------------------------------------------------------------------
function intOr0(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function wire() {
  $("btnNewMission").onclick = newMission;
  $("btnNewMission2").onclick = newMission;
  $("btnDupMission").onclick = duplicateMission;
  $("btnDeleteMission").onclick = deleteMission;
  $("btnAddStage").onclick = addStage;
  $("btnTemplate").onclick = applyTemplate;
  $("btnFromMst").onclick = newFromMst;
  $("btnSave").onclick = save;
  $("btnTest").onclick = testInGame;
  $("btnReload").onclick = () => { if (!S.dirty || confirm("Discard unsaved changes and reload?")) boot(); };
  $("btnDeleteEnemy").onclick = () => {
    const st = curStage(); if (!st || S.ei < 0) return;
    st.battle_monsters.splice(S.ei, 1); S.ei = -1; markDirty();
    renderStages(); renderCanvas(); renderEnemyInspector();
  };
  // Palette filters are bound in bindPalette() once /api/meta has supplied the
  // element names, so nothing is wired here.

  // Picker modal
  $("btnClosePick").onclick = closePicker;
  $("pickSearch").addEventListener("input", renderPickList);
  $("pickModal").addEventListener("click", (e) => {
    if (e.target === $("pickModal")) closePicker();      // click the backdrop
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("pickModal").classList.contains("hidden")) closePicker();
  });

  // AI builder
  $("btnManageAi").onclick = openAiModal;
  $("btnCloseAi").onclick = closeAiModal;
  $("btnNewAi").onclick = newAi;
  $("btnDeleteAi").onclick = deleteAi;
  $("btnSaveAis").onclick = saveAis;
  $("btnAddAiAction").onclick = () => {
    const a = curAi(); if (!a) return;
    a.actions.push(newAiAction((a.actions.length || 0) + 1));
    markAiDirty(); renderAiActions();
  };
  bindHeader();
  window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
}

wire();
boot();
