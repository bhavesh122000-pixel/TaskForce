const { forEachAsync } = require('./async');
const W = require('./workflow');

// PostgreSQL tables are installed by supabase/setup.sql. Library upgrades run once.
async function initSchema(db, opts = {}) {
  if (opts.deferLibrary) return;
  const version = await db.prepare("SELECT value FROM settings WHERE key = 'library_version'").get();
  if (version?.value === '1') return;
  await ensureLibrary(db);
  await db.prepare("INSERT INTO settings (key,value) VALUES ('library_version','1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
}

async function seedChecklists(db, onlySide) {
  for (const [side, stages] of Object.entries(W.DEFAULT_CHECKLISTS)) {
    if (onlySide && side !== onlySide) continue;
    const key = side === 'V' ? 'BC-V' : 'BC-P';
    // Count without flattening the [title, children] template structure.
    const total = Object.values(stages).reduce((n, items) => n + items.reduce((m, it) => m + 1 + (Array.isArray(it) ? it[1]?.length || 0 : 0), 0), 0);
    const ids = await db.reserveIds('checklist_templates', total), rows = [];
    let next = 0;
    for (const [stage, items] of Object.entries(stages)) items.forEach((it, i) => {
      const [title, subs] = Array.isArray(it) ? it : [it, null], id = ids[next++];
      rows.push([id, side, key, stage, null, title, i]);
      if (subs) subs.forEach((text, j) => rows.push([ids[next++], side, key, stage, id, text, j]));
    });
    await db.insertMany('checklist_templates', ['id','side','checklist_key','stage','parent_id','title','position'], rows);
    await seedMilestones(db, key, side);
  }
}
const sameTitle = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
// Mark the standard milestones (the old Readiness Board columns) on a library checklist. Returns { rk: templateId }.
async function seedMilestones(db, key, side) {
  const out = {};
  const tpl = await db.prepare('SELECT * FROM checklist_templates WHERE checklist_key = ? AND parent_id IS NULL').all(key);
  for (const d of W.defaultMilestones(side)) {
    let t = tpl.find((x) => x.stage === d.stage && sameTitle(x.title, d.title));
    if (!t && d.add) {
      const pos = ((await db.prepare('SELECT MAX(position) AS p FROM checklist_templates WHERE checklist_key = ? AND stage = ? AND parent_id IS NULL').get(key, d.stage)).p || 0) + 1;
      const r = await db.prepare('INSERT INTO checklist_templates (side, checklist_key, stage, parent_id, title, position) VALUES (?,?,?,?,?,?)').run(side, key, d.stage, null, d.title, pos);
      t = { id: Number(r.lastInsertRowid) };
    }
    if (!t) continue;
    await db.prepare('UPDATE checklist_templates SET ms = ? WHERE id = ?').run(JSON.stringify(d.ms), t.id);
    out[d.rk] = t.id;
  }
  return out;
}

// Default stages for one of the standard checklists (with any old stage-timing overrides applied)
function defaultStages(side, over = {}) {
  return W.STAGES.filter((s) => s.sides.includes(side)).map((s, i) => ({ key: s.key, label: s.label, from_kind: (over[s.key] || {}).from || s.from, days: (over[s.key] || {}).days != null ? +over[s.key].days : s.days, when_text: s.when, position: i }));
}

// Make sure the checklist library exists (BC - P, BC - V, LD, Spouse) and older data is linked to it
async function ensureLibrary(db) {
  const q1 = async (sql, ...p) => await db.prepare(sql).get(...p);
  const run = async (sql, ...p) => await db.prepare(sql).run(...p);
  const getS = async (k) => {const r = await q1('SELECT value FROM settings WHERE key = ?', k);return r ? r.value : '';};
  const setS = async (k, v) => await run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
  if ((await q1('SELECT COUNT(*) AS n FROM checklist_templates')).n === 0 && (await q1('SELECT COUNT(*) AS n FROM checklists')).n === 0) await seedChecklists(db);
  await run("UPDATE checklist_templates SET checklist_key = CASE side WHEN 'V' THEN 'BC-V' ELSE 'BC-P' END WHERE checklist_key IS NULL OR checklist_key = ''");
  if ((await q1('SELECT COUNT(*) AS n FROM checklists')).n === 0) {
    let over = {};
    try {over = JSON.parse((await getS('stage_timing')) || '{}') || {};} catch {/* ignore */}
    await forEachAsync(W.DEFAULT_LIBRARY, async (c, i) => {
      await run('INSERT INTO checklists (key, name, position) VALUES (?,?,?)', c.key, c.name, i);
      for (const st of defaultStages(c.side, over)) await run('INSERT INTO checklist_stages (checklist_key, key, label, from_kind, days, when_text, position) VALUES (?,?,?,?,?,?,?)', c.key, st.key, st.label, st.from_kind, st.days, st.when_text, st.position);
    });
    for (const c of W.DEFAULT_LIBRARY.filter((x) => x.copyOf)) {
      if ((await q1('SELECT COUNT(*) AS n FROM checklist_templates WHERE checklist_key = ?', c.key)).n === 0) {await copyTemplates(db, c.copyOf, c.key);await run('UPDATE checklist_templates SET ms = NULL WHERE checklist_key = ?', c.key);}
    }
  }
  if (!(await getS('type_checklists'))) await setS('type_checklists', JSON.stringify(W.DEFAULT_TYPE_CHECKLIST));
  if (!(await getS('milestones_v1'))) {await upgradeMilestones(db);await setS('milestones_v1', '1');}
  if (!(await getS('tax_v1'))) {await seedTaxLibrary(db);await setS('tax_v1', '1');}
  await seedHolidays(db);
}

// SA public holidays: keep the current year and the next 5 filled in (adds new years as time goes on;
// days an admin removed aren't put back, because only years not yet seeded are added)
async function seedHolidays(db) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'holidays_to'").get();
  const done = r ? parseInt(r.value, 10) || 0 : 0;
  const y0 = new Date().getFullYear(),y1 = y0 + 5;
  if (done >= y1) return;
  const existing = new Set((await db.prepare('SELECT date, name FROM holidays').all()).map(h => JSON.stringify([h.date, h.name])));
  const rows = [];
  for (let y = Math.max(y0, done + 1); y <= y1; y++) for (const h of W.saHolidays(y)) {
    const key = JSON.stringify([h.date, h.name]);
    if (!existing.has(key)) { rows.push([h.date, h.name, h.part, 'act']); existing.add(key); }
  }
  await db.insertMany('holidays', ['date','name','part_from','source'], rows);
  await db.prepare("INSERT INTO settings (key,value) VALUES ('holidays_to', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(y1));
}

// Taxation library: the DBS bookkeeping checklists (only staff with Taxation access see them)
async function seedTaxLibrary(db) {
  const q1 = async (sql, ...p) => await db.prepare(sql).get(...p);
  const run = async (sql, ...p) => await db.prepare(sql).run(...p);
  let pos = ((await q1('SELECT MAX(position) AS p FROM checklists')).p || 0) + 1;
  for (const c of W.TAX_LIBRARY) {
    if (await q1('SELECT id FROM checklists WHERE key = ?', c.key)) continue;
    await run('INSERT INTO checklists (key, name, position, area) VALUES (?,?,?,?)', c.key, c.name, pos++, 'tax');
    await forEachAsync(W.TAX_STAGES, async (st, i) => await run('INSERT INTO checklist_stages (checklist_key, key, label, from_kind, days, when_text, position) VALUES (?,?,?,?,?,?,?)', c.key, st.key, st.label, st.from, st.days, st.when, i));
    for (const [stage, items] of Object.entries(c.items)) await forEachAsync(items, async (title, i) => await run('INSERT INTO checklist_templates (side, checklist_key, stage, parent_id, title, position) VALUES (?,?,?,?,?,?)', 'T', c.key, stage, null, title, i));
  }
  const r = await q1("SELECT value FROM settings WHERE key = 'type_checklists'");
  let types = {};try {types = JSON.parse(r && r.value || '{}') || {};} catch {types = {};}
  if (!types.TAX) {types.TAX = 'DBS-ASH';await run("INSERT INTO settings (key,value) VALUES ('type_checklists', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(types));}
}

/* v5 upgrade: the Readiness Board columns become milestone items on each matter's checklist.
   Existing board values move onto those items, so nothing is entered twice from now on. */
async function upgradeMilestones(db) {
  const q1 = async (sql, ...p) => await db.prepare(sql).get(...p);
  const qa = async (sql, ...p) => await db.prepare(sql).all(...p);
  const run = async (sql, ...p) => await db.prepare(sql).run(...p);
  const stamp = () => {const d = new Date(),z = (n) => String(n).padStart(2, '0');return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;};
  const homes = {};
  for (const [key, side] of [['BC-P', 'P'], ['BC-V', 'V']]) {
    if (!(await q1('SELECT id FROM checklists WHERE key = ?', key))) continue;
    const marked = (await q1("SELECT COUNT(*) AS n FROM checklist_templates WHERE checklist_key = ? AND ms IS NOT NULL AND ms <> ''", key)).n;
    if (marked) {
      homes[side] = {};
      for (const d of W.defaultMilestones(side)) {const t = await q1('SELECT id FROM checklist_templates WHERE checklist_key = ? AND stage = ? AND parent_id IS NULL AND lower(trim(title)) = lower(trim(?))', key, d.stage, d.title);if (t) homes[side][d.rk] = t.id;}
    } else homes[side] = await seedMilestones(db, key, side);
  }
  let types = {};
  try {types = { ...W.DEFAULT_TYPE_CHECKLIST, ...(JSON.parse(((await q1("SELECT value FROM settings WHERE key = 'type_checklists'")) || {}).value || '{}') || {}) };} catch {types = { ...W.DEFAULT_TYPE_CHECKLIST };}
  for (const m of await qa('SELECT * FROM matters')) {
    const items = await qa('SELECT * FROM matter_items WHERE matter_id = ?', m.id);
    // link items to the library item they came from
    const libKey = types[m.type] || (W.sideOf(m.type) === 'V' ? 'BC-V' : W.sideOf(m.type) === 'P' ? 'BC-P' : '');
    if (libKey) {
      const tpl = await qa('SELECT * FROM checklist_templates WHERE checklist_key = ?', libKey);
      for (const it of items.filter((i) => !i.tpl_id)) {
        const parent = it.parent_id ? items.find((p) => p.id === it.parent_id) : null;
        const t = tpl.find((x) => x.stage === it.stage && sameTitle(x.title, it.title) && (!parent ? !x.parent_id : x.parent_id && sameTitle((tpl.find((y) => y.id === x.parent_id) || {}).title, parent.title)));
        if (t) {await run('UPDATE matter_items SET tpl_id = ?, ms = ? WHERE id = ?', t.id, t.ms || null, it.id);it.tpl_id = t.id;it.ms = t.ms;}
      }
    }
    const side = W.sideOf(m.type);
    if (!side || !homes[side]) continue;
    let values = {};
    try {values = JSON.parse(m.readiness || '{}') || {};} catch {values = {};}
    const hasChecklist = items.length > 0;
    for (const d of W.defaultMilestones(side)) {
      const tplId = homes[side][d.rk];
      const t = tplId ? await q1('SELECT * FROM checklist_templates WHERE id = ?', tplId) : null;
      if (!t) continue;
      const v = values[d.rk] || '';
      let it = items.find((i) => i.tpl_id === t.id) || items.find((i) => !i.parent_id && i.stage === t.stage && sameTitle(i.title, t.title));
      if (!it && (hasChecklist || v)) {
        const pos = ((await q1('SELECT MAX(position) AS p FROM matter_items WHERE matter_id = ? AND stage = ? AND parent_id IS NULL', m.id, t.stage)).p || 0) + 1;
        const r = await run('INSERT INTO matter_items (matter_id, stage, parent_id, title, position, updated_at, tpl_id, ms) VALUES (?,?,?,?,?,?,?,?)', m.id, t.stage, null, t.title, pos, stamp(), t.id, t.ms);
        it = { id: Number(r.lastInsertRowid), status: '', value: '' };
      }
      if (!it) continue;
      await run('UPDATE matter_items SET tpl_id = ?, ms = ? WHERE id = ?', t.id, t.ms, it.id);
      if (v) await run('UPDATE matter_items SET status = ?, updated_at = ? WHERE id = ?', v, stamp(), it.id);
      if (d.rk === 'bod' && values.bod_amount && !it.value) await run('UPDATE matter_items SET value = ? WHERE id = ?', String(values.bod_amount), it.id);
    }
    const keep = {};
    for (const n of W.BOARD_NOTES) if (values[n.key]) keep[n.key] = values[n.key];
    if (JSON.stringify(keep) !== JSON.stringify(values)) await run('UPDATE matters SET readiness = ? WHERE id = ?', JSON.stringify(keep), m.id);
  }
}
async function copyTemplates(db, fromKey, toKey) {
  const rows = await db.prepare('SELECT * FROM checklist_templates WHERE checklist_key = ? ORDER BY parent_id IS NOT NULL, position, id').all(fromKey);
  const ids = await db.reserveIds('checklist_templates', rows.length), mapping = new Map(), copies = [];
  for (const t of rows) {
    if (t.parent_id && !mapping.has(t.parent_id)) continue;
    const id = ids[copies.length];
    copies.push([id, t.side, toKey, t.stage, t.parent_id ? mapping.get(t.parent_id) : null, t.title, t.position, t.ms || null]);
    mapping.set(t.id, id);
  }
  await db.insertMany('checklist_templates', ['id','side','checklist_key','stage','parent_id','title','position','ms'], copies);
}

module.exports = { initSchema, seedChecklists, seedMilestones, ensureLibrary, copyTemplates, defaultStages, seedHolidays };
