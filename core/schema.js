const { forEachAsync } = require('./async');
// Database tables, upgrades from earlier versions, and default data.
// Works with Node's built-in SQLite and with sql.js in the browser test version.
const W = require('./workflow');

const MATTERS_SQL = `CREATE TABLE IF NOT EXISTS matters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL COLLATE NOCASE,
  type TEXT NOT NULL DEFAULT 'P',
  client TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  other_side TEXT NOT NULL DEFAULT '',
  settlement_date TEXT,
  finance_date TEXT,
  responsible_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT NOT NULL DEFAULT '',
  gst_applies INTEGER NOT NULL DEFAULT 0,
  sdr_claimed INTEGER NOT NULL DEFAULT 0,
  readiness TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (code, type)
)`;

async function hasTable(db, t) {return !!(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(t));}
async function hasColumn(db, t, c) {return (await db.prepare(`PRAGMA table_info(${t})`).all()).some((r) => r.name === c);}

async function initSchema(db, opts = {}) {
  if (db.dialect === 'postgres') { if (!opts.deferLibrary) await ensureLibrary(db); return; }

  await db.exec('PRAGMA foreign_keys = ON;');
  const hadMatters = await hasTable(db, 'matters');

  await db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  initials TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'blue',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  active INTEGER NOT NULL DEFAULT 1,
  email_alerts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
${MATTERS_SQL};
CREATE TABLE IF NOT EXISTS matter_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id INTEGER NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  parent_id INTEGER REFERENCES matter_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  person_id INTEGER REFERENCES users(id),
  date TEXT,
  value TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_matter ON matter_items(matter_id);
CREATE TABLE IF NOT EXISTS checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  side TEXT NOT NULL,
  stage TEXT NOT NULL,
  parent_id INTEGER REFERENCES checklist_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  matter_id INTEGER REFERENCES matters(id) ON DELETE SET NULL,
  item_id INTEGER REFERENCES matter_items(id) ON DELETE SET NULL,
  assignee_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'todo',
  position REAL NOT NULL DEFAULT 0,
  offset_from TEXT,
  offset_days INTEGER,
  overdue_notified INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_matter ON tasks(matter_id);
CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  matter_id INTEGER REFERENCES matters(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  email_meta TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  matter_id INTEGER REFERENCES matters(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
CREATE TABLE IF NOT EXISTS checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS checklist_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_key TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  from_kind TEXT NOT NULL DEFAULT 'opened',
  days INTEGER NOT NULL DEFAULT 0,
  when_text TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS matter_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id INTEGER NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  from_kind TEXT NOT NULL DEFAULT 'opened',
  days INTEGER NOT NULL DEFAULT 0,
  when_text TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mstages ON matter_stages(matter_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS email_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  stored_name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_parts_att ON email_parts(attachment_id);
CREATE TABLE IF NOT EXISTS file_tokens (
  token TEXT PRIMARY KEY,
  stored_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS callbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  matter_id INTEGER REFERENCES matters(id) ON DELETE SET NULL,
  message TEXT NOT NULL DEFAULT '',
  for_user_id INTEGER REFERENCES users(id),
  assignee_id INTEGER REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'normal',
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  attempts INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT '',
  overdue_notified INTEGER NOT NULL DEFAULT 0,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  completed_at TEXT,
  completed_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_cb_status ON callbacks(status, assignee_id);
CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  part_from TEXT,
  source TEXT NOT NULL DEFAULT 'act',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_hol_date ON holidays(date);
CREATE TABLE IF NOT EXISTS leave (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Annual leave',
  part TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_leave_dates ON leave(start_date, end_date);
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  note TEXT NOT NULL DEFAULT '',
  edited_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id, clock_in);
CREATE TABLE IF NOT EXISTS work_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id INTEGER REFERENCES time_entries(id) ON DELETE SET NULL,
  at TEXT NOT NULL,
  since TEXT,
  text TEXT NOT NULL,
  task_ids TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'checkin',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_wlog_user ON work_logs(user_id, at);
CREATE TABLE IF NOT EXISTS login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login',
  expires_at TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS callback_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  callback_id INTEGER NOT NULL REFERENCES callbacks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);`);

  // ---- upgrade a version 1 database ----
  if (hadMatters && !(await hasColumn(db, 'matters', 'readiness'))) {
    await db.exec('PRAGMA foreign_keys = OFF;');
    await db.exec('BEGIN');
    await db.exec(MATTERS_SQL.replace('IF NOT EXISTS matters', 'matters_v2'));
    await db.exec(`INSERT INTO matters_v2 (id, code, type, client, address, other_side, settlement_date, finance_date, responsible_id, status, notes, created_by, created_at, updated_at)
      SELECT id, code, type, client, address, other_side, settlement_date, finance_date, responsible_id, status, notes, created_by, created_at, updated_at FROM matters`);
    await db.exec('DROP TABLE matters');
    await db.exec('ALTER TABLE matters_v2 RENAME TO matters');
    await db.exec('COMMIT');
    await db.exec('PRAGMA foreign_keys = ON;');
  }
  if (!(await hasColumn(db, 'tasks', 'item_id'))) await db.exec('ALTER TABLE tasks ADD COLUMN item_id INTEGER REFERENCES matter_items(id) ON DELETE SET NULL');
  if (!(await hasColumn(db, 'users', 'claude_id'))) await db.exec('ALTER TABLE users ADD COLUMN claude_id TEXT');
  if (!(await hasColumn(db, 'attachments', 'parts_done'))) await db.exec('ALTER TABLE attachments ADD COLUMN parts_done INTEGER NOT NULL DEFAULT 0');
  if (!(await hasColumn(db, 'notifications', 'callback_id'))) await db.exec('ALTER TABLE notifications ADD COLUMN callback_id INTEGER REFERENCES callbacks(id) ON DELETE CASCADE');
  if (!(await hasColumn(db, 'checklist_templates', 'checklist_key'))) await db.exec('ALTER TABLE checklist_templates ADD COLUMN checklist_key TEXT');
  for (const [c, def] of [['due_time', 'TEXT'], ['repeat', 'TEXT'], ['repeat_until', 'TEXT'], ['series_id', 'INTEGER'], ['repeat_next_id', 'INTEGER']]) if (!(await hasColumn(db, 'tasks', c))) await db.exec(`ALTER TABLE tasks ADD COLUMN ${c} ${def}`);
  if (!(await hasColumn(db, 'notifications', 'matter_id'))) await db.exec('ALTER TABLE notifications ADD COLUMN matter_id INTEGER REFERENCES matters(id) ON DELETE CASCADE');
  // v5: milestones, task length (calendar), sign-in codes
  if (!(await hasColumn(db, 'checklist_templates', 'ms'))) await db.exec('ALTER TABLE checklist_templates ADD COLUMN ms TEXT');
  if (!(await hasColumn(db, 'matter_items', 'ms'))) await db.exec('ALTER TABLE matter_items ADD COLUMN ms TEXT');
  if (!(await hasColumn(db, 'matter_items', 'tpl_id'))) await db.exec('ALTER TABLE matter_items ADD COLUMN tpl_id INTEGER');
  if (!(await hasColumn(db, 'tasks', 'duration'))) await db.exec('ALTER TABLE tasks ADD COLUMN duration INTEGER');
  // v5.1: unconditional contracts (UNFIN reminder) and automatic tasks
  if (!(await hasColumn(db, 'matters', 'unconditional'))) await db.exec('ALTER TABLE matters ADD COLUMN unconditional INTEGER NOT NULL DEFAULT 0');
  if (!(await hasColumn(db, 'tasks', 'auto_kind'))) await db.exec('ALTER TABLE tasks ADD COLUMN auto_kind TEXT');
  // v5.2: taxation area – library checklists belong to an area; staff need Taxation access to see tax jobs
  if (!(await hasColumn(db, 'checklists', 'area'))) await db.exec("ALTER TABLE checklists ADD COLUMN area TEXT NOT NULL DEFAULT 'conv'");
  if (!(await hasColumn(db, 'users', 'tax_access'))) await db.exec('ALTER TABLE users ADD COLUMN tax_access INTEGER NOT NULL DEFAULT 0');

  // ---- default checklists ----
  if (!opts.deferLibrary) await ensureLibrary(db); // the shared Claude page does this once the shared copy has loaded
}

async function seedChecklists(db, onlySide) {
  const ins = db.prepare('INSERT INTO checklist_templates (side, checklist_key, stage, parent_id, title, position) VALUES (?,?,?,?,?,?)');
  for (const [side, stages] of Object.entries(W.DEFAULT_CHECKLISTS)) {
    if (onlySide && side !== onlySide) continue;
    const key = side === 'V' ? 'BC-V' : 'BC-P';
    for (const [stage, items] of Object.entries(stages)) {
      await forEachAsync(items, async (it, i) => {
        const [title, subs] = Array.isArray(it) ? it : [it, null];
        const r = await ins.run(side, key, stage, null, title, i);
        if (subs) await forEachAsync(subs, async (s, j) => await ins.run(side, key, stage, Number(r.lastInsertRowid), s, j));
      });
    }
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
  const has = db.prepare("SELECT id FROM holidays WHERE date = ? AND name = ?");
  const ins = db.prepare("INSERT INTO holidays (date, name, part_from, source) VALUES (?,?,?, 'act')");
  for (let y = Math.max(y0, done + 1); y <= y1; y++) for (const h of W.saHolidays(y)) if (!(await has.get(h.date, h.name))) await ins.run(h.date, h.name, h.part);
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
  const ins = db.prepare('INSERT INTO checklist_templates (side, checklist_key, stage, parent_id, title, position, ms) VALUES (?,?,?,?,?,?,?)');
  const map = new Map();
  for (const t of rows) {
    if (t.parent_id && !map.has(t.parent_id)) continue;
    const r = await ins.run(t.side, toKey, t.stage, t.parent_id ? map.get(t.parent_id) : null, t.title, t.position, t.ms || null);
    map.set(t.id, Number(r.lastInsertRowid));
  }
}

module.exports = { initSchema, seedChecklists, seedMilestones, ensureLibrary, copyTemplates, defaultStages, seedHolidays };
