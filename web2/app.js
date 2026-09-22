const accountFields = [
  ["username", "Username", "text"],
  ["level", "Level", "number"],
  ["exp", "EXP", "number"],
  ["energy", "Energy", "number"],
  ["zel", "Zel", "number"],
  ["karma", "Karma", "number"],
  ["gems", "Gems", "number"],
  ["friend_points", "Friend points", "number"],
  ["brave_coin", "Brave coins", "number"],
  ["summon_tickets", "Summon tickets", "number"],
  ["rainbow_coins", "Rainbow coins", "number"],
  ["colosseum_tickets", "Colosseum tickets", "number"],
  ["max_unit_count", "Unit capacity", "number"],
  ["max_warehouse_count", "Warehouse capacity", "number"],
  ["fight_point", "Arena orbs", "number"],
  ["max_fight_point", "Max arena orbs", "number"],
  ["hunter_orbs", "Hunter orbs", "number"],
  ["achieve_point", "Achievement points", "number"],
  ["tutorial_status", "Tutorial status", "number"],
  ["tutorial_end_flag", "Tutorial complete", "number"],
  ["debug_mode", "Debug mode", "number"],
];

const unitFields = [
  ["unit_id", "Unit ID", "number"],
  ["unit_type_id", "Type", "unit-type"],
  ["unit_lvl", "Level", "number"],
  ["base_hp", "Base HP", "number"],
  ["base_atk", "Base ATK", "number"],
  ["base_def", "Base DEF", "number"],
  ["base_rec", "Base REC", "number"],
  ["ext_hp", "Imp HP", "number"],
  ["ext_atk", "Imp ATK", "number"],
  ["ext_def", "Imp DEF", "number"],
  ["ext_rec", "Imp REC", "number"],
  ["add_hp", "Bonus HP", "number"],
  ["add_atk", "Bonus ATK", "number"],
  ["add_def", "Bonus DEF", "number"],
  ["add_rec", "Bonus REC", "number"],
  ["bb_id", "BB ID", "locked"],
  ["bb_lvl", "BB level", "number"],
  ["sbb_id", "SBB ID", "locked"],
  ["sbb_lvl", "SBB level", "number"],
  ["exp", "Current EXP", "number"],
  ["total_exp", "Total EXP", "number"],
  ["favorite_flg", "Favorite", "number"],
  ["sphere_ext", "Sphere slot", "number"],
  ["eqip_item_id", "Sphere 1", "number"],
  ["eqip_item_id2", "Sphere 2", "number"],
];

const itemFields = [
  ["item_id", "Item ID", "number"],
  ["item_num", "Quantity", "number"],
  ["favorite_flg", "Favorite", "number"],
  ["disp_order", "Display order", "number"],
];

const elements = [
  ["1", "Fire"],
  ["2", "Water"],
  ["3", "Earth"],
  ["4", "Thunder"],
  ["5", "Light"],
  ["6", "Dark"],
];
const unitTypes = [
  ["1", "Lord"],
  ["2", "Anima"],
  ["3", "Breaker"],
  ["4", "Guardian"],
  ["5", "Oracle"],
  ["6", "Rex"],
];
const numericFields = new Set([
  "unit_id", "unit_type_id", "unit_lvl", "base_hp", "base_atk", "base_def",
  "base_rec", "ext_hp", "ext_atk", "ext_def", "ext_rec", "add_hp",
  "add_atk", "add_def", "add_rec", "bb_lvl", "sbb_lvl", "exp",
  "total_exp", "favorite_flg", "sphere_ext", "eqip_item_id",
  "eqip_item_id2", "item_id", "item_num", "disp_order", "level",
  "energy", "zel", "karma", "gems", "friend_points", "brave_coin",
  "summon_tickets", "rainbow_coins", "colosseum_tickets", "max_unit_count",
  "max_warehouse_count", "fight_point", "max_fight_point", "hunter_orbs",
  "achieve_point", "tutorial_status", "tutorial_end_flag", "debug_mode",
  "max_friend_count",
]);
const CATALOG_CAP = 150;

const state = {
  mode: "account",
  addOpen: false,
  unlockFields: false,
  databasePath: "",
  addFilters: {
    units: { q: "", element: "", rarity: "", curated: false, keepSearch: true },
    items: { q: "", namedOnly: false, keepSearch: true },
  },
  account: null,
  units: [],
  items: [],
  unitCatalog: [],
  itemCatalog: [],
  selectedUnitId: null,
  selectedItemId: null,
};

const $ = (id) => document.getElementById(id);

function unitIcon(unitId) {
  return `/images/unit/unit_ills_thum_${unitId}.png`;
}

function itemIcon(item) {
  const file = typeof item === "object" && item.thumbnail
    ? item.thumbnail
    : `item_thum_${typeof item === "object" ? item.item_id || item.id : item}.png`;
  return `/images/item/${encodeURIComponent(file)}`;
}

function iconImg(src, alt, cls = "") {
  return `<img class="thumb ${cls}" src="${src}" alt="${escapeAttr(alt)}" loading="lazy" onerror="this.classList.add('missing')">`;
}

function setStatus(message, kind = "") {
  const node = $("saveStatus");
  node.textContent = message;
  node.className = "save-status " + kind;
}

async function api(path, body) {
  const options = body
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    : {};
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || response.statusText);
  }
  return payload;
}

function applyState(payload) {
  mergeState(payload);
  render();
}

function mergeState(payload) {
  state.databasePath = payload.databasePath || state.databasePath;
  state.account = payload.account || {};
  state.units = payload.units || [];
  state.items = payload.items || [];
  state.unitCatalog = payload.unitCatalog || [];
  state.itemCatalog = payload.itemCatalog || [];

  if (!state.selectedUnitId && state.units[0]) state.selectedUnitId = state.units[0].user_unit_id;
  if (!state.selectedItemId && state.items[0]) state.selectedItemId = state.items[0].instance_id;
}

async function loadState() {
  setStatus("Loading...");
  applyState(await api("/api/gme/state"));
  setStatus("Loaded", "saved");
}

function render() {
  document.querySelector(".gme-layout").classList.toggle("add-open", state.addOpen && state.mode !== "account");
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
  $("unitCount").textContent = state.units.length;
  $("itemCount").textContent = state.items.length;
  $("summaryStats").innerHTML = `
    <div><strong>${escapeHtml(state.account?.username || "Account")}</strong></div>
    <div class="muted small">${escapeHtml(state.databasePath || "web2/gme.sqlite")}</div>
    <div>Level ${state.account?.level ?? 0}</div>
    <div>${state.units.length} units</div>
    <div>${state.items.length} item stacks</div>
  `;
  $("databasePathInput").value = state.databasePath || "";

  $("listTitle").textContent = state.mode[0].toUpperCase() + state.mode.slice(1);
  $("searchInput").classList.toggle("hidden", state.mode === "account");
  $("inventoryFilters").classList.toggle("hidden", state.mode !== "units");
  $("addBtn").classList.toggle("hidden", state.mode === "account");
  $("addBtn").textContent = state.addOpen ? "Hide add" : (state.mode === "units" ? "Add unit" : "Add item");

  if (state.mode === "account") {
    renderAccount();
  } else if (state.mode === "units") {
    renderUnits();
  } else {
    renderItems();
  }
}

function renderAccount() {
  state.addOpen = false;
  clearAddPanel();
  $("recordList").innerHTML = `
    <div class="card account-card">
      <h3>${escapeHtml(state.account.username || "Player")}</h3>
      <p class="muted small">User ID: ${escapeHtml(state.account.id || "")}</p>
      <p class="muted small">Gumi ID: ${escapeHtml(state.account.gumi_user_id || "")}</p>
    </div>
  `;
  renderForm("Account info", state.account, accountFields, saveAccount);
}

function renderUnits(preserveEditor = false) {
  if (state.addOpen) renderAddPanel();
  else clearAddPanel();
  const q = $("searchInput").value.trim().toLowerCase();
  const element = $("inventoryElement").value;
  const rarity = $("inventoryRarity").value;
  const curated = $("inventoryCurated").checked;
  const catalog = new Map(state.unitCatalog.map((unit) => [String(unit.id), unit]));
  const rows = state.units.filter((unit) => {
    const text = `${unit.user_unit_id} ${unit.unit_id} ${unit.name}`.toLowerCase();
    const info = catalog.get(String(unit.unit_id)) || {};
    return (!q || text.includes(q))
      && (!element || Number(info.element ?? unit.catalog_element) === Number(element))
      && (!rarity || Number(info.rarity ?? unit.rarity) === Number(rarity))
      && (!curated || info.in_archive);
  });
  $("inventoryMatchCount").textContent = `${rows.length} of ${state.units.length}`;
  $("recordList").innerHTML = rows.map((unit) => `
    <button class="record-row ${unit.user_unit_id === state.selectedUnitId ? "active" : ""}" data-unit="${unit.user_unit_id}">
      ${iconImg(unitIcon(unit.unit_id), unit.name || "Unit", "unit-thumb")}
      <span class="record-main">
        <span class="record-name">${escapeHtml(unit.name || "Unnamed unit")}</span>
        <span class="muted small">UID ${unit.user_unit_id} | unit ${unit.unit_id} | Lv ${unit.unit_lvl}</span>
      </span>
    </button>
  `).join("") || '<div class="empty-state">No units match these filters.</div>';
  document.querySelectorAll("[data-unit]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedUnitId = Number(button.dataset.unit);
      renderUnits();
    });
  });
  if (preserveEditor) return;
  const selected = state.units.find((unit) => unit.user_unit_id === state.selectedUnitId) || state.units[0];
  if (selected) state.selectedUnitId = selected.user_unit_id;
  renderForm(selected ? selected.name || "Unit" : "Unit", selected, unitFields, saveUnit, deleteUnit);
}

function renderItems() {
  if (state.addOpen) renderAddPanel();
  else clearAddPanel();
  const q = $("searchInput").value.trim().toLowerCase();
  const rows = state.items.filter((item) => {
    const text = `${item.instance_id} ${item.item_id} ${item.name}`.toLowerCase();
    return !q || text.includes(q);
  });
  $("recordList").innerHTML = rows.map((item) => `
    <button class="record-row ${item.instance_id === state.selectedItemId ? "active" : ""}" data-item="${item.instance_id}">
      ${iconImg(itemIcon(item), item.name || "Item", "item-thumb")}
      <span class="record-main">
        <span class="record-name">${escapeHtml(item.name || "Unnamed item")}</span>
        <span class="muted small">Item ${item.item_id} | Qty ${item.item_num}</span>
      </span>
    </button>
  `).join("");
  document.querySelectorAll("[data-item]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedItemId = Number(button.dataset.item);
      renderItems();
    });
  });
  const selected = state.items.find((item) => item.instance_id === state.selectedItemId) || state.items[0];
  if (selected) state.selectedItemId = selected.instance_id;
  renderForm(selected ? selected.name || "Item" : "Item", selected, itemFields, saveItem, deleteItem);
}

function renderForm(title, row, fields, onSave, onDelete) {
  if (!row) {
    $("editor").innerHTML = `<div class="empty-state">No ${state.mode} selected.</div>`;
    return;
  }
  $("editor").innerHTML = `
    <div class="card-head">
      <h2 class="editor-title">${rowIcon(row)}<span>${escapeHtml(title)}</span></h2>
      <div class="row-actions">
        ${onDelete ? '<button id="deleteRecord" class="btn small danger">Delete</button>' : ""}
        <button id="saveRecord" class="btn small primary" type="button">Save</button>
      </div>
    </div>
    <form id="editForm" class="edit-grid">
      ${fields.map(([field, label, type]) => fieldInput(row, field, label, type)).join("")}
    </form>
  `;
  $("saveRecord").addEventListener("click", onSave);
  if (onDelete) $("deleteRecord").addEventListener("click", onDelete);
}

function rowIcon(row) {
  if (!row) return "";
  if ("unit_id" in row) return iconImg(unitIcon(row.unit_id), row.name || "Unit", "editor-thumb");
  if ("item_id" in row) return iconImg(itemIcon(row), row.name || "Item", "editor-thumb");
  return "";
}

function fieldInput(row, field, label, type) {
  const value = row[field] ?? "";
  if (type === "unit-type") {
    return `
      <label>
        ${label}
        <select data-field="${field}">
          ${unitTypes.map(([id, name]) => `<option value="${id}" ${String(value) === id ? "selected" : ""}>${name}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (type === "locked") {
    return `
      <label>
        ${label}
        <input class="${state.unlockFields ? "manual-field" : "locked-field"}" data-unlockable data-field="${field}" type="text" value="${escapeAttr(value)}" ${state.unlockFields ? "" : "readonly"}>
      </label>
    `;
  }
  return `
    <label>
      ${label}
      <input data-field="${field}" type="${type}" value="${escapeAttr(value)}">
    </label>
  `;
}

function formValues(extra = {}) {
  const values = { ...extra };
  document.querySelectorAll("#editForm [data-field]").forEach((input) => {
    const field = input.dataset.field;
    values[field] = input.type === "number" || numericFields.has(field)
      ? Number(input.value || 0)
      : input.value;
  });
  return values;
}

async function saveAccount() {
  return saveWithStatus("/api/gme/account", formValues());
}

async function saveUnit() {
  await saveWithStatus("/api/gme/unit", formValues({ user_unit_id: state.selectedUnitId, allow_manual_skill_ids: state.unlockFields }));
}

async function deleteUnit() {
  if (!confirm("Delete this unit from the account?")) return;
  await saveWithStatus("/api/gme/unit/delete", { user_unit_id: state.selectedUnitId }, () => {
    state.selectedUnitId = null;
  });
}

async function saveItem() {
  await saveWithStatus("/api/gme/item", formValues({ instance_id: state.selectedItemId }));
}

async function deleteItem() {
  if (!confirm("Delete this item stack from the account?")) return;
  await saveWithStatus("/api/gme/item/delete", { instance_id: state.selectedItemId }, () => {
    state.selectedItemId = null;
  });
}

let saving = false;

async function saveWithStatus(path, body, afterApply) {
  if (saving) return false;
  saving = true;
  const controls = [...document.querySelectorAll("button, input, select")];
  const enabledControls = controls.filter((control) => !control.disabled);
  enabledControls.forEach((control) => { control.disabled = true; });
  try {
    setStatus("Saving...", "dirty");
    const payload = await api(path, body);
    mergeState(payload);
    if (afterApply) afterApply(payload);
    render();
    setStatus("Saved", "saved");
    return true;
  } catch (error) {
    setStatus(error.message, "dirty");
    return false;
  } finally {
    saving = false;
    enabledControls.forEach((control) => { control.disabled = false; });
  }
}

function bindAddFilters(mode, bindings) {
  const filters = state.addFilters[mode];
  for (const [key, id] of Object.entries(bindings)) {
    const input = $(id);
    const property = input.type === "checkbox" ? "checked" : "value";
    input[property] = filters[key];
    input.addEventListener("input", () => { filters[key] = input[property]; });
  }
}

function clearSearchAfterAdd(mode) {
  const filters = state.addFilters[mode];
  if (filters.keepSearch) return;
  filters.q = "";
  if (mode === "units") {
    filters.element = "";
    filters.rarity = "";
    filters.curated = false;
  } else {
    filters.namedOnly = false;
  }
}

function renderAddPanel() {
  const panel = $("addPanel");
  if (!state.addOpen || state.mode === "account") {
    clearAddPanel();
    return;
  }
  $("addSection").classList.remove("hidden");
  $("addTitle").textContent = state.mode === "units" ? "Add unit" : "Add item";
  if (state.mode === "units") {
    renderUnitAdd(panel);
  } else {
    renderItemAdd(panel);
  }
}

function clearAddPanel() {
  const panel = $("addPanel");
  panel.innerHTML = "";
  $("addSection").classList.add("hidden");
  document.querySelector(".gme-layout").classList.remove("add-open");
}

function renderUnitAdd(panel) {
  panel.innerHTML = `
    <div class="catalog-picker">
      <div class="filter-row">
        <input id="newUnitSearch" class="search" type="search" placeholder="Search units by name or id..." autocomplete="off">
      </div>
      <div class="filter-row">
        <select id="newUnitElement" title="Filter by element">
          <option value="">All elements</option>
          ${elements.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
        </select>
        <select id="newUnitRarity" title="Filter by rarity">
          <option value="">Any rarity</option>
          ${[1, 2, 3, 4, 5, 6, 7, 8].map((r) => `<option value="${r}">${"*".repeat(r)}</option>`).join("")}
        </select>
        <label class="chk" title="Only units already included in unit.json">
          <input id="newUnitCurated" type="checkbox"> Curated
        </label>
      </div>
      <div class="add-config">
        <label>Level <input id="newUnitLevel" type="number" value="1" min="1"></label>
        <label>Type
          <select id="newUnitType">
            ${unitTypes.map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}
          </select>
        </label>
        <span id="newUnitCount" class="muted small"></span>
      </div>
      <div class="filter-row">
        <label class="chk search-preference">
          <input id="keepUnitSearch" type="checkbox" aria-describedby="keepUnitSearchHint">
          <span class="check-copy"><strong>Keep search &amp; filters</strong><span id="keepUnitSearchHint">Retain your selection after adding a unit.</span></span>
        </label>
      </div>
      <div id="newUnitPalette" class="palette"></div>
    </div>
  `;
  bindAddFilters("units", {
    q: "newUnitSearch", element: "newUnitElement", rarity: "newUnitRarity",
    curated: "newUnitCurated", keepSearch: "keepUnitSearch",
  });
  const updateOptions = () => {
    const q = $("newUnitSearch").value.trim().toLowerCase();
    const element = $("newUnitElement").value;
    const rarity = $("newUnitRarity").value;
    const curated = $("newUnitCurated").checked;
    const rows = state.unitCatalog
      .filter((entry) => {
        const text = `${entry.id} ${entry.name || ""}`.toLowerCase();
        if (q && !text.includes(q)) return false;
        if (element && Number(entry.element) !== Number(element)) return false;
        if (rarity && Number(entry.rarity) !== Number(rarity)) return false;
        if (curated && !entry.in_archive) return false;
        return true;
      });
    $("newUnitCount").textContent = rows.length > CATALOG_CAP
      ? `${CATALOG_CAP} of ${rows.length} shown`
      : `${rows.length} shown`;
    $("newUnitPalette").innerHTML = rows.slice(0, CATALOG_CAP).map(unitAddRow).join("");
    document.querySelectorAll("[data-add-unit]").forEach((button) => {
      button.addEventListener("click", () => addSelectedUnit(Number(button.dataset.addUnit)));
    });
  };
  ["newUnitSearch", "newUnitElement", "newUnitRarity", "newUnitCurated"]
    .forEach((id) => $(id).addEventListener("input", updateOptions));
  updateOptions();
}

function renderItemAdd(panel) {
  panel.innerHTML = `
    <div class="catalog-picker">
      <div class="filter-row">
        <input id="newItemSearch" class="search" type="search" placeholder="Search items by name or id..." autocomplete="off">
      </div>
      <div class="filter-row">
        <label class="chk" title="Only items with names in the data bundle">
          <input id="newItemNamed" type="checkbox"> Named only
        </label>
      </div>
      <div class="add-config">
        <label>Quantity <input id="newItemQty" type="number" value="1" min="1"></label>
        <span id="newItemCount" class="muted small"></span>
      </div>
      <div class="filter-row">
        <label class="chk search-preference">
          <input id="keepItemSearch" type="checkbox" aria-describedby="keepItemSearchHint">
          <span class="check-copy"><strong>Keep search &amp; filters</strong><span id="keepItemSearchHint">Retain your selection after adding an item.</span></span>
        </label>
      </div>
      <div id="newItemPalette" class="palette"></div>
    </div>
  `;
  bindAddFilters("items", {
    q: "newItemSearch", namedOnly: "newItemNamed", keepSearch: "keepItemSearch",
  });
  const updateOptions = () => {
    const q = $("newItemSearch").value.trim().toLowerCase();
    const namedOnly = $("newItemNamed").checked;
    const rows = state.itemCatalog.filter((entry) => {
      const text = `${entry.id} ${entry.name || ""}`.toLowerCase();
      if (q && !text.includes(q)) return false;
      if (namedOnly && !entry.named) return false;
      return true;
    });
    $("newItemCount").textContent = rows.length > CATALOG_CAP
      ? `${CATALOG_CAP} of ${rows.length} shown`
      : `${rows.length} shown`;
    $("newItemPalette").innerHTML = rows.slice(0, CATALOG_CAP).map(itemAddRow).join("");
    document.querySelectorAll("[data-add-item]").forEach((button) => {
      button.addEventListener("click", () => addSelectedItem(Number(button.dataset.addItem)));
    });
  };
  ["newItemSearch", "newItemNamed"].forEach((id) => $(id).addEventListener("input", updateOptions));
  updateOptions();
}

function unitAddRow(unit) {
  return `
    <button class="unit" type="button" data-add-unit="${unit.id}" title="Add this unit">
      ${iconImg(unitIcon(unit.id), unit.name || "Unit", "unit-thumb")}
      <span class="dot el-${unit.element || 0}"></span>
      <span class="uname${unit.named ? "" : " unnamed"}">${escapeHtml(unit.name || "Unnamed unit")}</span>
      <span class="star">${"*".repeat(unit.rarity || 0)}</span>
      <span class="uid">#${unit.id}</span>
      ${unit.in_archive ? '<span class="pip" title="Already in unit.json">o</span>' : '<span class="pip ghosted" title="Added from unit_records.json">o</span>'}
    </button>
  `;
}

function itemAddRow(item) {
  return `
    <button class="unit" type="button" data-add-item="${item.id}" title="Add or update this item">
      ${iconImg(itemIcon(item), item.name || "Item", "item-thumb")}
      <span class="uname${item.named ? "" : " unnamed"}">${escapeHtml(item.name || "Unnamed item")}</span>
      <span class="uid">#${item.id}</span>
    </button>
  `;
}

function addSelectedUnit(unitId) {
  const level = Number($("newUnitLevel").value || 1);
  const type = Number($("newUnitType").value || 1);
  if (!unitId) return setStatus("Choose a unit first", "dirty");
  return saveWithStatus("/api/gme/unit", { unit_id: unitId, unit_lvl: level, unit_type_id: type }, (payload) => {
    clearSearchAfterAdd("units");
    const added = newestBy(payload.units, "user_unit_id", (unit) => unit.unit_id === unitId);
    if (added) {
      state.selectedUnitId = added.user_unit_id;
      state.mode = "units";
    }
  });
}

function addSelectedItem(itemId) {
  const qty = Number($("newItemQty").value || 1);
  if (!itemId) return setStatus("Choose an item first", "dirty");
  return saveWithStatus("/api/gme/item", { item_id: itemId, item_num: qty }, (payload) => {
    clearSearchAfterAdd("items");
    const added = newestBy(payload.items, "instance_id", (item) => item.item_id === itemId);
    if (added) {
      state.selectedItemId = added.instance_id;
      state.mode = "items";
    }
  });
}

function newestBy(rows, idField, predicate) {
  return (rows || [])
    .filter(predicate)
    .sort((a, b) => Number(b[idField] || 0) - Number(a[idField] || 0))[0];
}

async function importDatabaseFile(file) {
  if (!file) return;

  try {
    setStatus("Importing gme.sqlite...", "dirty");
    const response = await fetch("/api/gme/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: await file.arrayBuffer(),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      throw new Error(payload.error || response.statusText);
    }
    state.selectedUnitId = null;
    state.selectedItemId = null;
    applyState(payload);
    setStatus("gme.sqlite imported", "saved");
  } catch (error) {
    setStatus(error.message, "dirty");
  }
}

async function uploadDatabase() {
  const input = $("databaseUpload");
  await importDatabaseFile(input.files && input.files[0]);
  input.value = "";
}

async function useDatabasePath() {
  const path = $("databasePathInput").value.trim();
  if (!path) return setStatus("Enter a gme.sqlite file path", "dirty");
  try {
    setStatus("Opening database path...", "dirty");
    state.selectedUnitId = null;
    state.selectedItemId = null;
    applyState(await api("/api/gme/use-path", { path }));
    setStatus("Editing selected gme.sqlite", "saved");
  } catch (error) {
    setStatus(error.message, "dirty");
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

async function switchMode(nextMode) {
  if (saving || state.mode === nextMode) return;
  if (state.mode === "account" && state.account) {
    const values = formValues();
    const changed = accountFields.some(([field, , type]) => {
      const previous = type === "number" ? Number(state.account[field] || 0) : String(state.account[field] ?? "");
      return values[field] !== previous;
    });
    if (changed && !await saveAccount()) return;
  }
  state.addOpen = false;
  state.mode = nextMode;
  render();
}

document.querySelectorAll(".nav-tab").forEach((button) => {
  button.addEventListener("click", () => switchMode(button.dataset.mode));
});

$("reloadBtn").addEventListener("click", loadState);
$("useDatabasePathBtn").addEventListener("click", useDatabasePath);
$("searchInput").addEventListener("input", () => state.mode === "units" ? renderUnits(true) : render());
$("inventoryElement").innerHTML += elements.map(([id, name]) => `<option value="${id}">${name}</option>`).join("");
$("inventoryRarity").innerHTML += [1, 2, 3, 4, 5, 6, 7, 8].map((rarity) => `<option value="${rarity}">${"*".repeat(rarity)}</option>`).join("");
["inventoryElement", "inventoryRarity", "inventoryCurated"].forEach((id) => {
  $(id).addEventListener("input", () => renderUnits(true));
});
$("resetInventoryFilters").addEventListener("click", () => {
  $("searchInput").value = "";
  $("inventoryElement").value = "";
  $("inventoryRarity").value = "";
  $("inventoryCurated").checked = false;
  renderUnits(true);
});
$("settingsBtn").addEventListener("click", () => $("settingsDialog").showModal());
$("closeSettingsBtn").addEventListener("click", () => $("settingsDialog").close());
$("unlockFields").addEventListener("change", () => {
  state.unlockFields = $("unlockFields").checked;
  $("settingsBtn").setAttribute("aria-pressed", String(state.unlockFields));
  document.querySelectorAll("[data-unlockable]").forEach((input) => {
    input.readOnly = !state.unlockFields;
    input.classList.toggle("locked-field", !state.unlockFields);
    input.classList.toggle("manual-field", state.unlockFields);
  });
});
$("addBtn").addEventListener("click", () => {
  state.addOpen = !state.addOpen;
  render();
  if (state.addOpen) $(state.mode === "units" ? "newUnitSearch" : "newItemSearch").focus();
});
$("closeAddBtn").addEventListener("click", () => {
  state.addOpen = false;
  clearAddPanel();
  render();
});
$("uploadDatabaseBtn").addEventListener("click", () => $("databaseUpload").click());
$("databaseUpload").addEventListener("change", uploadDatabase);
$("dbDropZone").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("dbDropZone").classList.add("dragging");
});
$("dbDropZone").addEventListener("dragleave", () => {
  $("dbDropZone").classList.remove("dragging");
});
$("dbDropZone").addEventListener("drop", async (event) => {
  event.preventDefault();
  $("dbDropZone").classList.remove("dragging");
  await importDatabaseFile(event.dataTransfer.files && event.dataTransfer.files[0]);
});

loadState().catch((error) => {
  setStatus(error.message, "dirty");
  $("editor").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});
