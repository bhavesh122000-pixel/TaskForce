const { mapAsync, forEachAsync } = require('./async');
// TaskForce engine: every rule and API route lives here.
// Shared application rules backed by PostgreSQL.
const W = require('./workflow');
const { dateMath } = require('./dates');
const { initSchema, seedChecklists, seedMilestones, ensureLibrary, copyTemplates, defaultStages, seedHolidays } = require('./schema');

const STATUS_LABEL = { todo: 'To do', progress: 'In progress', waiting: 'Waiting on', done: 'Done' };
const STATUSES = Object.keys(STATUS_LABEL);
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const COLORS = ['blue', 'green', 'violet', 'orange', 'magenta', 'aqua', 'red', 'yellow'];
const SESSION_DAYS = 30;
const SETTING_KEYS = ['firm_name', 'app_url', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from', 'backup_dir', 'backup_time', 'backup_keep', 'login_mode', 'checkin_minutes'];
// How people sign in: password, a code emailed to them, either, or both (two-step)
const LOGIN_MODES = ['password', 'either', 'code', 'both'];
const CODE_MINUTES = 10;

/* ---------- date helpers (local time) ---------- */
const pad = (n) => String(n).padStart(2, '0');
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
function addDays(s, n) {if (!s) return null;const [y, m, d] = s.split('-').map(Number);return dstr(new Date(y, m - 1, d + n));}
function now() {const d = new Date();return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;}
function daysBetween(a, b) {const p = (s) => {const [y, m, d] = s.split('-').map(Number);return new Date(y, m - 1, d);};return Math.round((p(b) - p(a)) / 864e5);}
function nowMin() {const d = new Date();return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;}
function validDT(s) {if (s == null || s === '') return null;const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s));return m ? `${m[1]} ${m[2]}` : undefined;}
function fmtDue(s) {
  if (!s) return 'as soon as possible';
  const [d, t] = s.split(' ');const [h, mi] = t.split(':').map(Number);
  const time = new Date(2000, 0, 1, h, mi).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  return d === today() ? `today ${time}` : `${fmtDate(d)} ${time}`;
}
function addMinutes(min) {const d = new Date(Date.now() + min * 60e3);return `${dstr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;}
function mimeFor(name, given) {
  if (given && given !== 'application/octet-stream') return given;
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  return { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', msg: 'application/vnd.ms-outlook', eml: 'message/rfc822', htm: 'text/html', html: 'text/html' }[ext] || 'application/octet-stream';
}
function validDate(s) {return s == null || s === '' ? null : /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;}
function fmtDate(s) {if (!s) return 'no date';const [y, m, d] = s.split('-').map(Number);return new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });}
function weekEnd(s) {const [y, m, d] = s.split('-').map(Number);const dt = new Date(y, m - 1, d);return addDays(s, (7 - dt.getDay()) % 7);} // Sunday
function businessDay(s, dir) {
  const [y, m, d] = s.split('-').map(Number);const dow = new Date(y, m - 1, d).getDay();
  if (dow === 6) return addDays(s, dir < 0 ? -1 : 2);
  if (dow === 0) return addDays(s, dir < 0 ? -2 : 1);
  return s;
}
function initialsFor(name) {
  const p = String(name).trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}
function err(msg, status = 400) {const e = new Error(msg);e.status = status;return e;}

async function createCore({ db, platform }) {
  await initSchema(db, { deferLibrary: !!platform.deferLibrary });
  const q1 = async (sql, ...p) => await db.prepare(sql).get(...p);
  const qa = async (sql, ...p) => await db.prepare(sql).all(...p);
  const run = async (sql, ...p) => await db.prepare(sql).run(...p);
  async function tx(fn) {await db.exec('BEGIN');try {const r = await fn();await db.exec('COMMIT');return r;} catch (e) {await db.exec('ROLLBACK');throw e;}}
  const settings = () => db.memo('settings', async () => new Map((await qa('SELECT key, value FROM settings')).map(r => [r.key, r.value])));
  const getSetting = async (k, d = '') => { const rows = await settings(); return rows.has(k) ? rows.get(k) : d; };
  const setSetting = async (k, v) => await run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v == null ? '' : String(v));

  /* ---------- shared helpers ---------- */
  const userById = async (id) => id ? await q1('SELECT * FROM users WHERE id = ?', id) : null;
  const pub = (u) => u && { id: u.id, name: u.name, email: u.email, initials: u.initials, color: u.color, role: u.role, active: !!u.active, email_alerts: !!u.email_alerts, tax_access: !!u.tax_access, can_tax: u.role === 'admin' || !!u.tax_access };

  /* ---------- Taxation access: tax jobs, their tasks, call-backs and the taxation library are only for admins and staff with Taxation access ---------- */
  const canTax = (u) => !!u && (u.role === 'admin' || !!u.tax_access);
  const isTax = (type) => W.areaOf(type) === 'tax';
  const TAX_IN = `(${W.MATTER_TYPES.filter((t) => t.area === 'tax').map((t) => `'${t.key}'`).join(',')})`;
  const TAX_DENIED = 'That’s in Taxation, which you don’t have access to. Ask an admin for Taxation access.';
  const matterIsTax = async (mid) => {if (!mid) return false;const m = await q1('SELECT type FROM matters WHERE id = ?', +mid);return !!(m && isTax(m.type));};
  const checklistIsTax = async (key) => {const c = key ? await q1('SELECT area FROM checklists WHERE key = ?', String(key)) : null;return !!(c && c.area === 'tax');};
  // a person who can't see Taxation can't be given tax work
  async function taxPersonCheck(userId, matterId) {
    if (!userId || !(await matterIsTax(matterId))) return;
    const u = await userById(+userId);
    if (u && !canTax(u)) throw err(`${u.name} doesn’t have Taxation access, so they can’t be given work on a taxation job.`);
  }
  // checked on every request, before the route runs
  async function guardRoute(me, path, params, body) {
    if (canTax(me)) return;
    const id = params.id;
    const deny = () => {throw err(TAX_DENIED, 403);};
    const chk = async (mid) => {if (await matterIsTax(mid)) deny();};
    const taskMatter = async (tid) => ((await q1('SELECT matter_id FROM tasks WHERE id = ?', +tid)) || {}).matter_id;
    if (/^\/api\/matters\/[^/]+/.test(path)) await chk(id);else
    if (/^\/api\/tasks\/[^/]+/.test(path)) await chk(await taskMatter(id));else
    if (/^\/api\/items\//.test(path)) await chk(((await q1('SELECT matter_id FROM matter_items WHERE id = ?', +id)) || {}).matter_id);else
    if (/^\/api\/attachments\//.test(path)) await chk(await taskMatter(((await q1('SELECT task_id FROM attachments WHERE id = ?', +id)) || {}).task_id));else
    if (/^\/api\/parts\//.test(path)) {const r = await q1('SELECT a.task_id FROM email_parts e JOIN attachments a ON a.id = e.attachment_id WHERE e.id = ?', +id);await chk(r && (await taskMatter(r.task_id)));} else
    if (/^\/api\/checklist\//.test(path)) await chk(await taskMatter(((await q1('SELECT task_id FROM checklist_items WHERE id = ?', +id)) || {}).task_id));else
    if (/^\/api\/notes\//.test(path)) await chk(await taskMatter(((await q1('SELECT task_id FROM notes WHERE id = ?', +id)) || {}).task_id));else
    if (/^\/api\/callbacks\/[^/]+/.test(path)) await chk(((await q1('SELECT matter_id FROM callbacks WHERE id = ?', +id)) || {}).matter_id);else
    if (path === '/api/open-link') {const tid = body.kind === 'part' ? ((await q1('SELECT a.task_id FROM email_parts e JOIN attachments a ON a.id = e.attachment_id WHERE e.id = ?', +body.id)) || {}).task_id : ((await q1('SELECT task_id FROM attachments WHERE id = ?', +body.id)) || {}).task_id;await chk(tid && (await taskMatter(tid)));} else
    if (/^\/api\/library\/[^/]+/.test(path) && params.key) {if (await checklistIsTax(params.key)) deny();} else
    if (/^\/api\/library-stages\//.test(path)) {if (await checklistIsTax(((await q1('SELECT checklist_key FROM checklist_stages WHERE id = ?', +id)) || {}).checklist_key)) deny();} else
    if (/^\/api\/checklist-templates\/[^/]+/.test(path)) {if (await checklistIsTax(((await q1('SELECT checklist_key FROM checklist_templates WHERE id = ?', +id)) || {}).checklist_key)) deny();}
    if (body && body.matter_id) await chk(body.matter_id);
    if (body && body.type && isTax(body.type) && path.startsWith('/api/matters')) deny();
    if (body && ((await checklistIsTax(body.checklist_key)) || (await checklistIsTax(body.copy_from)) || body.area === 'tax')) deny();
  }
  const log = async ({ taskId = null, matterId = null, userId, action }) => await run('INSERT INTO activity (task_id, matter_id, user_id, action, created_at) VALUES (?,?,?,?,?)', taskId, matterId, userId, action, now());
  const touchTask = async (id) => await run('UPDATE tasks SET updated_at = ? WHERE id = ?', now(), id);
  const touchMatter = async (id) => await run('UPDATE matters SET updated_at = ? WHERE id = ?', now(), id);
  const matterName = (m) => m ? `${m.code} ${(W.TYPE[m.type] || { short: m.type }).short}${m.client ? ' ' + m.client : ''}` : '';
  async function taskLabel(t) {const m = t.matter_id ? await q1('SELECT code, type FROM matters WHERE id = ?', t.matter_id) : null;return (m ? `${m.code} ${W.TYPE[m.type] ? W.TYPE[m.type].short : m.type} – ` : '') + t.title;}
  async function notify(userId, actorId, taskId, kind, text, emailSubject, matterId = null, callbackId = null) {
    if (!userId || userId === actorId) return;
    const u = await userById(userId);
    if (!u || !u.active) return;
    await run('INSERT INTO notifications (user_id, task_id, matter_id, callback_id, kind, text, created_at) VALUES (?,?,?,?,?,?,?)', userId, taskId, matterId, callbackId, kind, text, now());
    if (u.email_alerts && (await platform.mailConfigured(getSetting))) {
      const link = callbackId ? `/#/callbacks/${callbackId}` : taskId ? `/#/task/${taskId}` : matterId ? `/#/matters/${matterId}` : '/';
      const options = { to: u.email, subject: emailSubject || text, text, link };
      if (platform.queueMail) await platform.queueMail(getSetting, options);
      else Promise.resolve(platform.sendMail(getSetting, options)).catch(e => console.error('[mail]', e.message));
    }
  }
  const nextPos = async (status) => ((await q1('SELECT MAX(position) AS p FROM tasks WHERE status = ?', status)).p || 0) + 1;

  /* ---------- working days: weekends and full-day public holidays are skipped ---------- */
  const dates = () => db.memo('date-math', async () => dateMath(new Set((await qa("SELECT date FROM holidays WHERE part_from IS NULL OR part_from = ''")).map(row => row.date))));
  const businessDay = async (value, direction) => (await dates()).businessDay(value, direction);

  /* ---------- stages and checklists (from the checklist library) ---------- */
  async function legacyTiming() {
    let over = {};
    try {over = JSON.parse(await getSetting('stage_timing', '{}')) || {};} catch {/* ignore */}
    return over;
  }
  const stageRow = (r) => ({ key: r.key, label: r.label, from: r.from_kind, days: r.days, when: r.when_text });
  async function dueFrom(from, days, m) {
    return (await dates()).dueFrom(from, days, m);
  }
  const stageDue = async (stage, m) => await dueFrom(stage.from, stage.days, m);
  // Milestones on a matter, with their due dates worked out from the matter's dates (for the board, Gantt chart and calendar)
  async function milestonesOf(m, items, stages, values) {
    const math = await dates();
    const sdr = W.sdrClaimed(m, values || {});
    const opened = (m.created_at || '').slice(0, 10) || null;
    const dues = stages.map(s => ({ key: s.key, label: s.label, due: math.stageDue(s, m) }));
    const known = new Set(stages.map((s) => s.key));
    const order = new Map(stages.map((s, i) => [s.key, i]));
    const td = today();
    const windowStart = (due) => {if (!due) return null;let st = opened && opened <= due ? opened : null;for (const d of dues) if (d.due && d.due < due && (!st || d.due > st)) st = d.due;return st || due;};
    const tops = items.filter((i) => !i.parent_id);
    const rank = (it) => {const top = it.parent_id ? items.find((x) => x.id === it.parent_id) || it : it;return [order.has(top.stage) ? order.get(top.stage) : 999, top.position || 0, top.id, it.parent_id ? 1 : 0, it.position || 0];};
    const cmp = (a, b) => {const x = rank(a),y = rank(b);for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];return 0;};
    return items.filter((i) => i.ms).map(it => {
      const ms = W.parseMs(it.ms);
      if (!ms) return null;
      const stageKey = it.parent_id ? (tops.find((t) => t.id === it.parent_id) || {}).stage || it.stage : it.stage;
      const st = dues.find((d) => d.key === stageKey) || { key: stageKey, label: (W.STAGES.find((x) => x.key === stageKey) || { label: stageKey }).label, due: null };
      const due = ms.from ? math.dueFrom(ms.from, ms.days || 0, m) : st.due;
      let start = due ? ms.lead != null ? addDays(due, -Math.abs(ms.lead)) : windowStart(due) : null;
      if (start && due && start > due) start = due;
      const done = W.itemDone(it, sdr);
      return { id: it.id, item_id: it.id, title: it.title, label: ms.label || it.title, stage: stageKey, stage_label: st.label, known: known.has(stageKey), status: it.status || '', value: it.value || '', person_id: it.person_id || null,
        ms, due, start, done, applies: !(ms.gstOnly && !m.gst_applies), overdue: !!(due && due < td && !done), statuses: W.statusOptions(it, W.sideOf(m.type) || 'P', !!it.parent_id) };
    }).filter(Boolean).sort((a, b) => cmp(items.find((i) => i.id === a.id), items.find((i) => i.id === b.id)));
  }
  // A matter's stages: its own copy (made when a library checklist was added), or for older matters the standard ones
  async function stagesFor(m, rows) {
    const own = rows || (await qa('SELECT * FROM matter_stages WHERE matter_id = ? ORDER BY position, id', m.id));
    if (own.length) return own.map(stageRow);
    const side = W.sideOf(m.type);
    if (!side || side === 'T') return [];
    const allStages = await db.memo('library-stages', () => qa('SELECT * FROM checklist_stages ORDER BY position, id'));
    const lib = allStages.filter(row => row.checklist_key === (side === 'V' ? 'BC-V' : 'BC-P'));
    if (lib.length) return lib.map(stageRow);
    return defaultStages(side, await legacyTiming()).map(stageRow);
  }
  async function typeChecklists() {
    try {return { ...W.DEFAULT_TYPE_CHECKLIST, ...(JSON.parse(await getSetting('type_checklists', '{}')) || {}) };} catch {return { ...W.DEFAULT_TYPE_CHECKLIST };}
  }

  // Summarise a matter's checklist: progress, current stage, overdue and stuck items
  async function checklistSummary(m, items, stageRows) {
    const stages = await stagesFor(m, stageRows);
    const math = await dates();
    const sdr = W.sdrClaimed(m, parseReadiness(m));
    const byParent = new Map();
    items.forEach((i) => {if (i.parent_id) {if (!byParent.has(i.parent_id)) byParent.set(i.parent_id, []);byParent.get(i.parent_id).push(i);}});
    const out = { total: 0, done: 0, stages: [], current: null, overdue: [], stuck: [] };
    const td = today();
    const known = new Set(stages.map((s) => s.key));
    // items in a stage the matter no longer lists still show, under their own heading
    for (const it of items) if (!it.parent_id && !known.has(it.stage)) {known.add(it.stage);stages.push({ key: it.stage, label: (W.STAGES.find((s) => s.key === it.stage) || { label: it.stage }).label, from: 'opened', days: 0, when: '' });}
    for (const s of stages) {
      const tops = items.filter((i) => i.stage === s.key && !i.parent_id);
      let total = 0,done = 0;
      for (const t of tops) {
        const kids = byParent.get(t.id) || [];
        if (kids.length) {for (const k of kids) {total++;if (W.itemDone(t, sdr) || W.itemDone(k, sdr)) done++;}} else
        {total++;if (W.itemDone(t, sdr)) done++;}
        [t, ...kids].forEach((x) => {if (/stuck/i.test(x.status)) out.stuck.push({ stage: s.label, title: x.title });});
      }
      const due = math.stageDue(s, m);
      const st = { key: s.key, label: s.label, when: s.when, due, total, done, complete: total > 0 && done === total, overdue: !!(due && due < td && done < total) };
      out.stages.push(st);
      out.total += total;out.done += done;
      if (!out.current && total > done) out.current = st;
      if (st.overdue) out.overdue.push(st.label);
    }
    return out;
  }
  // Copy a library checklist (its stages and items) onto a matter
  async function applyChecklist(m, actorId, checklistKey) {
    const key = checklistKey === undefined ? (await typeChecklists())[m.type] : checklistKey;
    if (!key) return 0;
    const lib = await q1('SELECT * FROM checklists WHERE key = ?', key);
    const libStages = await qa('SELECT * FROM checklist_stages WHERE checklist_key = ? ORDER BY position, id', key);
    if (!lib || !libStages.length) return 0;
    let own = await qa('SELECT * FROM matter_stages WHERE matter_id = ? ORDER BY position, id', m.id);
    if (!own.length && (await q1('SELECT id FROM matter_items WHERE matter_id = ? LIMIT 1', m.id))) {
      // an older matter: keep its existing stages before adding more
      await db.insertMany('matter_stages', ['matter_id','key','label','from_kind','days','when_text','position'], (await stagesFor(m, [])).map((s, i) => [m.id, s.key, s.label, s.from, s.days, s.when || '', i]));
      own = await qa('SELECT * FROM matter_stages WHERE matter_id = ? ORDER BY position, id', m.id);
    }
    const have = new Set(own.map((s) => s.key));
    let pos = own.length;
    await db.insertMany('matter_stages', ['matter_id','key','label','from_kind','days','when_text','position'], libStages.filter(s => !have.has(s.key)).map(s => [m.id, s.key, s.label, s.from_kind, s.days, s.when_text, pos++]));
    const allowed = new Set(libStages.map((s) => s.key));
    const tpl = await qa('SELECT * FROM checklist_templates WHERE checklist_key = ? ORDER BY parent_id IS NOT NULL, position, id', key);
    const map = new Map();
    let n = 0;
    const existing = await qa('SELECT id, stage, parent_id, title FROM matter_items WHERE matter_id = ?', m.id);
    const same = (stage, parentId, title) => existing.find((e) => e.stage === stage && (e.parent_id || null) === (parentId || null) && e.title.trim().toLowerCase() === title.trim().toLowerCase());
    const ids = await db.reserveIds('matter_items', tpl.length), additions = [], updates = [];
    for (const t of tpl) {
      if (!allowed.has(t.stage)) continue;
      const parent = t.parent_id ? map.get(t.parent_id) : null;
      if (t.parent_id && !parent) continue;
      const dup = same(t.stage, parent, t.title);
      if (dup) {map.set(t.id, dup.id);if (t.ms && !updates.some(row => row.id === dup.id)) updates.push({ id: dup.id, tpl_id: t.id, ms: t.ms });continue;} // already on the matter
      const id = ids[n];
      additions.push([id, m.id, t.stage, parent || null, t.title, t.position, now(), t.id, t.ms || null]);
      map.set(t.id, id);n++;
    }
    await db.insertMany('matter_items', ['id','matter_id','stage','parent_id','title','position','updated_at','tpl_id','ms'], additions);
    if (updates.length) await run('UPDATE matter_items AS item SET tpl_id = COALESCE(item.tpl_id, v.tpl_id), ms = COALESCE(item.ms, v.ms) FROM jsonb_to_recordset(?::jsonb) AS v(id bigint, tpl_id bigint, ms text) WHERE item.id = v.id', JSON.stringify(updates));
    await log({ matterId: m.id, userId: actorId, action: `added the “${lib.name}” checklist (${n} items)` });
    return n || 1;
  }

  /* ---------- readiness + escalation ---------- */
  function parseReadiness(m) {try {return JSON.parse(m.readiness || '{}') || {};} catch {return {};}}
  function escalationsFor(m, rd, cl) {
    if (m.status !== 'active' || !m.settlement_date || !rd.applies) return [];
    const td = today(),d = daysBetween(td, m.settlement_date),reasons = [];
    if (m.settlement_date < td && !rd.ready) reasons.push('Settlement date has passed and the file isn’t ready');else
    if (m.settlement_date <= weekEnd(td) && !rd.ready) reasons.push('Settles this week and isn’t ready');
    if (d <= 14) {
      const stuck = [...rd.stuck, ...cl.stuck.map((s) => `${s.stage}: ${s.title}`)];
      if (stuck.length) reasons.push('Stuck within 2 weeks of settlement – ' + stuck.join(', '));
    }
    if (d <= 7 && rd.blockers.length) reasons.push('Still blocked in the final week – ' + rd.blockers.join('; '));
    return reasons;
  }
  const jsonRows = sql => `(SELECT COALESCE(jsonb_agg(rows), '[]'::jsonb) FROM (${sql}) rows)`;
  function groupBy(rows, key) {
    const groups = new Map();
    for (const row of rows) { if (!groups.has(row[key])) groups.set(row[key], []); groups.get(row[key]).push(row); }
    return groups;
  }
  async function enrichMatters(list, loaded) {
    if (!list.length) return list;
    const ids = list.map(m => m.id);
    const data = loaded || await q1(`SELECT
      ${jsonRows('SELECT * FROM matter_items WHERE matter_id = ANY(?::bigint[])')} AS items,
      ${jsonRows('SELECT matter_id, status, due_date FROM tasks WHERE matter_id = ANY(?::bigint[])')} AS tasks,
      ${jsonRows('SELECT * FROM matter_stages WHERE matter_id = ANY(?::bigint[]) ORDER BY position, id')} AS stages`, ids, ids, ids);
    const itemGroups = groupBy(data.items, 'matter_id'), taskGroups = groupBy(data.tasks, 'matter_id'), stageGroups = groupBy(data.stages, 'matter_id');
    const td = today();
    return await mapAsync(list, async m => {
      const its = itemGroups.get(m.id) || [], ts = taskGroups.get(m.id) || [], ms = stageGroups.get(m.id) || [];
      const values = parseReadiness(m);
      const cl = await checklistSummary(m, its, ms);
      const miles = await milestonesOf(m, its, await stagesFor(m, ms), values);
      const rd = W.readinessOf(m, values, miles);
      const open = ts.filter(t => t.status !== 'done');
      return {
        ...m, name: matterName(m), side: W.sideOf(m.type), readiness: values, ready: rd, milestones: miles,
        checklist: { total: cl.total, done: cl.done, current: cl.current, overdue: cl.overdue, stuck: cl.stuck.length, has: its.length > 0 },
        open_tasks: open.length, done_tasks: ts.length - open.length,
        overdue_tasks: open.filter(t => t.due_date && t.due_date < td).length,
        escalations: escalationsFor(m, rd, cl)
      };
    });
  }

  /* ---------- attached emails ---------- */
  const isEmail = (n) => /\.(eml|msg)$/i.test(n || '');
  async function ensureParts(a, upload) {
    const res = await platform.readEmail({ upload, stored_name: a.stored_name }, a.filename);
    if (res) {
      let i = 0;
      for (const p of res.parts) {
        const stored = await platform.storeBytes(p.bytes, p.filename);
        const size = p.bytes.byteLength != null ? p.bytes.byteLength : p.bytes.size || 0;
        await run('INSERT INTO email_parts (attachment_id, filename, mime, size, stored_name, position) VALUES (?,?,?,?,?,?)', a.id, p.filename, mimeFor(p.filename, p.mime), size, stored, i++);
      }
      await run('UPDATE attachments SET email_meta = ?, parts_done = 1 WHERE id = ?', JSON.stringify(res.meta), a.id);
      return res.meta;
    }
    await run('UPDATE attachments SET parts_done = 1 WHERE id = ?', a.id);
    return null;
  }

  /* ---------- tasks ---------- */
  const TASK_SELECT = `
    SELECT t.*, m.code AS matter_code, m.type AS matter_type, m.address AS matter_address, m.client AS matter_client, m.settlement_date AS matter_settlement,
      i.stage AS item_stage, i.title AS item_title,
      (SELECT COUNT(*) FROM notes n WHERE n.task_id = t.id) AS note_count,
      (SELECT COUNT(*) FROM attachments a WHERE a.task_id = t.id) AS attachment_count,
      (SELECT COUNT(*) FROM checklist_items c WHERE c.task_id = t.id) AS check_total,
      (SELECT COUNT(*) FROM checklist_items c WHERE c.task_id = t.id AND c.done = 1) AS check_done
    FROM tasks t LEFT JOIN matters m ON m.id = t.matter_id LEFT JOIN matter_items i ON i.id = t.item_id`;
  async function taskFull(id) {
    const t = await q1(`SELECT detail.*,
      ${jsonRows('SELECT * FROM checklist_items WHERE task_id = detail.id ORDER BY position, id')} AS checklist,
      ${jsonRows('SELECT * FROM notes WHERE task_id = detail.id ORDER BY id')} AS notes,
      ${jsonRows('SELECT * FROM activity WHERE task_id = detail.id ORDER BY id')} AS activity,
      ${jsonRows('SELECT id, filename, mime, size, email_meta, uploaded_by, created_at FROM attachments WHERE task_id = detail.id ORDER BY id')} AS attachments
      FROM (${TASK_SELECT} WHERE t.id = ?) detail`, id);
    if (!t) return null;
    t.attachments = t.attachments.map(a => ({ ...a, email_meta: a.email_meta ? JSON.parse(a.email_meta) : null }));
    return t;
  }
  // When a task linked to a checklist item is finished, tick the item (and the other way round)
  async function syncItemFromTask(t, actorId) {
    if (!t.item_id) return;
    const it = await q1('SELECT * FROM matter_items WHERE id = ?', t.item_id);
    if (!it || W.itemDone(it)) return;
    const ms = W.parseMs(it.ms);
    const doneLabel = ms && ms.statuses.length ? W.readyLabels(ms).find((x) => x !== 'Not Required') || W.readyLabels(ms)[0] || 'Done' : 'Done';
    await run('UPDATE matter_items SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?', doneLabel, actorId, now(), it.id);
    await log({ matterId: it.matter_id, userId: actorId, action: `marked “${it.title}” ${doneLabel} (task finished)` });
    await touchMatter(it.matter_id);
  }
  async function syncTasksFromItem(it, actorId) {
    const open = await qa("SELECT * FROM tasks WHERE item_id = ? AND status <> 'done'", it.id);
    for (const t of open) {
      await run("UPDATE tasks SET status = 'done', completed_at = ?, position = ?, updated_at = ? WHERE id = ?", now(), await nextPos('done'), now(), t.id);
      await log({ taskId: t.id, matterId: t.matter_id, userId: actorId, action: `moved this to Done (checklist item marked ${it.status})` });
    }
  }
  async function statusChangeNotify(t, me, status) {
    const who = t.created_by !== me.id ? t.created_by : t.assignee_id !== me.id ? t.assignee_id : null;
    if (who) await notify(who, me.id, t.id, 'status', `${me.name} moved “${await taskLabel(t)}” to ${STATUS_LABEL[status]}`);
  }

  /* ---------- matter detail ---------- */
  async function matterFull(id) {
    const data = await q1(`SELECT outer_m.*,
      ${jsonRows('SELECT * FROM matter_items WHERE matter_id = outer_m.id ORDER BY position, id')} AS _items,
      ${jsonRows('SELECT * FROM matter_stages WHERE matter_id = outer_m.id ORDER BY position, id')} AS _stages,
      ${jsonRows(`${TASK_SELECT} WHERE t.matter_id = outer_m.id ORDER BY (t.status = 'done'), (t.due_date IS NULL), t.due_date, t.id`)} AS _tasks,
      ${jsonRows('SELECT a.*, t.title AS task_title FROM activity a LEFT JOIN tasks t ON t.id = a.task_id WHERE a.matter_id = outer_m.id ORDER BY a.id DESC LIMIT 80')} AS _activity,
      ${jsonRows('SELECT r.id, r.code, r.type, r.client FROM matters r WHERE lower(r.code) = lower(outer_m.code) AND r.id <> outer_m.id')} AS _related,
      ${jsonRows("SELECT * FROM callbacks WHERE matter_id = outer_m.id ORDER BY (status = 'open') DESC, COALESCE(completed_at, created_at) DESC")} AS _callbacks
      FROM matters outer_m WHERE outer_m.id = ?`, id);
    if (!data) return null;
    const { _items: items, _stages: stageRows, _tasks: tasks, _activity: activity, _related: related, _callbacks: callbacks, ...m0 } = data;
    const [m] = await enrichMatters([m0], { items, stages: stageRows, tasks });
    const linked = tasks.filter(t => t.item_id != null).map(({ id, item_id, status, assignee_id }) => ({ id, item_id, status, assignee_id }));
    const cl = await checklistSummary(m0, items, stageRows);
    const msById = new Map(m.milestones.map(x => [x.id, x]));
    items.forEach(i => { i.ms = W.parseMs(i.ms); const x = msById.get(i.id); if (x) { i.due = x.due; i.overdue = x.overdue; i.ms_label = x.label; } });
    m.timeline = { opened: (m0.created_at || '').slice(0, 10), stages: await mapAsync(await stagesFor(m0, stageRows), async s => ({ key: s.key, label: s.label, due: await stageDue(s, m0) })) };
    m.checklist_name = ((await q1('SELECT name FROM checklists WHERE key = ?', (await typeChecklists())[m0.type] || '')) || {}).name || null;
    m.stages = cl.stages.map(s => ({ ...s, items: items.filter(i => i.stage === s.key && !i.parent_id).map(i => ({
      ...i, tasks: linked.filter(t => t.item_id === i.id),
      children: items.filter(c => c.parent_id === i.id).map(c => ({ ...c, tasks: linked.filter(t => t.item_id === c.id) }))
    })) }));
    m.tasks = tasks; m.activity = activity; m.related = related; m.callbacks = callbacks;
    return m;
  }
  function matterFields(b) {
    const out = {};
    if (b.code != null) out.code = String(b.code).replace(/\s+/g, '').toUpperCase();
    if (b.type != null) {if (!W.TYPE[b.type]) throw err('Choose a matter type.');out.type = b.type;}
    for (const k of ['address', 'client', 'other_side', 'notes']) if (b[k] != null) out[k] = String(b[k]).trim();
    for (const k of ['settlement_date', 'finance_date']) if (b[k] !== undefined) {const v = validDate(b[k]);if (v === undefined) throw err('A date isn’t valid.');out[k] = v;}
    if (b.responsible_id !== undefined) out.responsible_id = b.responsible_id ? +b.responsible_id : null;
    if (b.status != null) {if (!['active', 'settled', 'archived'].includes(b.status)) throw err('Unknown matter status.');out.status = b.status;}
    for (const k of ['gst_applies', 'sdr_claimed', 'unconditional']) if (b[k] !== undefined) out[k] = b[k] === true || b[k] === 1 || b[k] === '1' || b[k] === 'on' ? 1 : 0;
    return out;
  }

  /* ---------- UNFIN reminder: unconditional contract with no finance date ---------- */
  // A task "UNFIN - BC1234" 10 days before settlement (previous business day), for the person responsible.
  // It follows the settlement date, and goes away if a finance date is added or the contract isn't unconditional any more.
  const UNFIN_DAYS = 10;
  async function syncUnfin(matterId, actor) {
    const m = await q1('SELECT * FROM matters WHERE id = ?', matterId);if (!m) return;
    const t = await q1("SELECT * FROM tasks WHERE matter_id = ? AND auto_kind = 'unfin' ORDER BY id DESC LIMIT 1", m.id);
    const want = m.status === 'active' && m.unconditional && !m.finance_date && m.settlement_date;
    if (!want) {
      if (t && t.status !== 'done') {await run('DELETE FROM tasks WHERE id = ?', t.id);await log({ matterId: m.id, userId: actor && actor.id, action: `removed the reminder “${t.title}” (${!m.unconditional ? 'not unconditional' : m.finance_date ? 'finance date added' : !m.settlement_date ? 'no settlement date' : 'matter closed'})` });}
      return;
    }
    const due = await businessDay(addDays(m.settlement_date, -UNFIN_DAYS), -1);
    const title = `UNFIN - ${m.code}`;
    if (!t) {
      const who = actor || (await userById(m.responsible_id)) || (await q1("SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1"));
      if (!who) return;
      const nt = await createTask(who, { title, matter_id: m.id, assignee_id: m.responsible_id || who.id, due_date: due, priority: 'high',
        description: `Unconditional contract – no finance date. Reminder ${UNFIN_DAYS} days before settlement (${fmtDate(m.settlement_date)}).` });
      await run("UPDATE tasks SET auto_kind = 'unfin' WHERE id = ?", nt.id);
      await log({ matterId: m.id, userId: who.id, action: `added the reminder “${title}” for ${fmtDate(due)} (unconditional – no finance date)` });
    } else if (t.status !== 'done' && (t.due_date !== due || t.title !== title)) {
      await run('UPDATE tasks SET due_date = ?, title = ?, overdue_notified = 0, updated_at = ? WHERE id = ?', due, title, now(), t.id);
      await log({ taskId: t.id, matterId: m.id, userId: actor && actor.id, action: `moved the UNFIN reminder to ${fmtDate(due)} (settlement ${fmtDate(m.settlement_date)})` });
    }
  }

  /* ---------- background jobs: overdue tasks + escalations ---------- */
  async function runJobs({ transaction = async callback => callback() } = {}) {
    let changed = false;
    const td = today();
    for (const candidate of await qa(`SELECT id FROM tasks WHERE status <> 'done' AND due_date IS NOT NULL AND due_date < ? AND overdue_notified = 0 AND assignee_id IS NOT NULL`, td)) {
      await transaction(async () => {
        const t = await q1('SELECT * FROM tasks WHERE id = ?', candidate.id);
        if (!t || t.status === 'done' || !t.due_date || t.due_date >= td || t.overdue_notified || !t.assignee_id) return;
        await notify(t.assignee_id, null, t.id, 'overdue', `Overdue: “${await taskLabel(t)}” was due ${fmtDate(t.due_date)}`, `Overdue: ${await taskLabel(t)}`);
        await run('UPDATE tasks SET overdue_notified = 1 WHERE id = ?', t.id);changed = true;
      }, {taskId:candidate.id});
    }
    for (const candidate of await qa("SELECT id FROM matters WHERE status = 'active' AND settlement_date IS NOT NULL AND settlement_date <= ?", addDays(td, 21))) {
      await transaction(async () => {
        const row = await q1("SELECT * FROM matters WHERE id = ? AND status = 'active' AND settlement_date IS NOT NULL AND settlement_date <= ?", candidate.id, addDays(td,21));
        if (!row) return;
        const [m] = await enrichMatters([row]);
        if (!m.escalations.length) return;
        for (const a of await qa("SELECT id FROM users WHERE role = 'admin' AND active = 1")) {
          const sent = await q1("SELECT id FROM notifications WHERE user_id = ? AND matter_id = ? AND kind = 'escalation' AND substr(created_at,1,10) = ?", a.id, m.id, td);
          if (sent) continue;
          const text = `Escalation – ${m.name} (settles ${fmtDate(m.settlement_date)}): ${m.escalations.join('. ')}`;
          await notify(a.id, null, null, 'escalation', text, `Escalation: ${m.name}`, m.id);
          changed = true;
        }
      }, {matterId:candidate.id});
    }
    await transaction(async () => {
      await run('DELETE FROM sessions WHERE expires_at < ?', now());
      await run('DELETE FROM file_tokens WHERE expires_at < ?', now());
      await run('DELETE FROM login_codes WHERE created_at < ?', addDays(today(), -1) + ' 00:00:00');
      if (!platform.deferLibrary) {try {await seedHolidays(db);} catch (e) {/* next run */}}
    });
    // call-backs that are past their call-back time
    for (const candidate of await qa("SELECT id FROM callbacks WHERE status = 'open' AND due_at IS NOT NULL AND due_at < ? AND overdue_notified = 0", nowMin())) {
      await transaction(async () => {
        const c = await q1('SELECT * FROM callbacks WHERE id = ?', candidate.id);
        if (!c || c.status !== 'open' || !c.due_at || c.due_at >= nowMin() || c.overdue_notified) return;
        const text = `Call-back overdue: ${c.caller_name}${c.phone ? ' (' + c.phone + ')' : ''} – was due ${fmtDue(c.due_at)}`;
        await notify(c.assignee_id, null, null, 'callback', text, text, c.matter_id, c.id);
        if (c.for_user_id && c.for_user_id !== c.assignee_id) await notify(c.for_user_id, null, null, 'callback', text, text, c.matter_id, c.id);
        await run('UPDATE callbacks SET overdue_notified = 1 WHERE id = ?', c.id);changed = true;
      }, {callbackId:candidate.id});
    }
    return changed;
  }

  /* ---------- routes ---------- */
  const routes = [];
  const on = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });

  // auth
  // The sign-in method in force. Emailed codes need working email; without it everyone uses passwords.
  async function loginMode() {
    if (platform.loginModeOverride) return platform.loginModeOverride;
    if (!platform.supportsLoginCodes || !(await platform.mailConfigured(getSetting))) return 'password';
    const m = await getSetting('login_mode', 'either');
    return LOGIN_MODES.includes(m) ? m : 'either';
  }
  on('GET', '/api/setup-status', async () => ({ needsSetup: (await q1('SELECT COUNT(*) AS n FROM users')).n === 0, firm: await getSetting('firm_name', ''), loginMode: await loginMode() }), { open: true });
  on('POST', '/api/setup', async ({ body }) => {
    if ((await q1('SELECT COUNT(*) AS n FROM users')).n > 0) throw err('Setup is already done.');
    const { name, email, password, firm } = body;
    if (!name || !email || !password) throw err('Enter your name, email and a password.');
    if (String(password).length < 8) throw err('Use at least 8 characters for the password.');
    const r = await run('INSERT INTO users (name,email,initials,color,password_hash,role) VALUES (?,?,?,?,?,?)', name.trim(), email.trim(), initialsFor(name), 'blue', await platform.hashPassword(password), 'admin');
    if (firm) await setSetting('firm_name', firm);
    return { ok: true, _session: await startSession(Number(r.lastInsertRowid)) };
  }, { open: true });
  async function startSession(userId) {
    const token = platform.randomToken();
    const exp = new Date(Date.now() + SESSION_DAYS * 864e5);
    await run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', token, userId, `${dstr(exp)} ${pad(exp.getHours())}:${pad(exp.getMinutes())}:00`);
    return token;
  }
  const attempts = new Map();
  function guard(ip) {
    const a = attempts.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 15 * 60e3) {a.n = 0;a.t = Date.now();}
    if (a.n >= 10) throw err('Too many attempts. Wait 15 minutes and try again.', 429);
    attempts.set(ip, a); // Share the counter before concurrent password checks yield.
    return { fail() {a.n++;attempts.set(ip, a);}, ok() {attempts.delete(ip);} };
  }
  // Email a 6-digit sign-in code
  async function sendCode(u, purpose) {
    const recent = (await q1("SELECT COUNT(*) AS n FROM login_codes WHERE user_id = ? AND created_at >= ?", u.id, (() => {const d = new Date(Date.now() - 15 * 60e3);return `${dstr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;})())).n;
    if (recent >= 5) throw err('Several codes have been sent already. Wait 15 minutes, or use the latest code in your email.', 429);
    const code = String(parseInt(platform.randomToken().replace(/[^0-9a-f]/gi, '').slice(0, 10) || '0', 16) % 1000000).padStart(6, '0');
    const exp = new Date(Date.now() + CODE_MINUTES * 60e3);
    await run('UPDATE login_codes SET used = 1 WHERE user_id = ? AND used = 0', u.id);
    await run('INSERT INTO login_codes (user_id, code_hash, purpose, expires_at, created_at) VALUES (?,?,?,?,?)', u.id, await platform.hashPassword(code), purpose, `${dstr(exp)} ${pad(exp.getHours())}:${pad(exp.getMinutes())}:${pad(exp.getSeconds())}`, now());
    try {
      await platform.sendMail(getSetting, { to: u.email, subject: `${code} is your TaskForce sign-in code`, text: `Your TaskForce sign-in code is ${code}.\n\nIt works once and expires in ${CODE_MINUTES} minutes. If you didn’t try to sign in, you can ignore this email.`, link: '/' });
    } catch (e) {console.error('[mail]', e.message);throw err('The sign-in code couldn’t be emailed. Check the email settings, or ask your admin.', 502);}
  }
  on('POST', '/api/login', async ({ body, ip }) => {
    const g = guard(ip);
    const mode = await loginMode();
    if (mode === 'code') throw err('Sign in with a code sent to your email.');
    const u = await q1('SELECT * FROM users WHERE lower(email) = lower(?)', String(body.email || '').trim());
    if (!u || !u.active || !(await platform.checkPassword(String(body.password || ''), u.password_hash))) {g.fail();throw err('That email and password don’t match.', 401);}
    g.ok();
    if (mode === 'both') {await sendCode(u, 'login2');return { needCode: true, email: u.email };}
    return { user: pub(u), _session: await startSession(u.id) };
  }, { open: true });
  on('POST', '/api/login/send-code', async ({ body, ip }) => {
    const g = guard(ip);
    const mode = await loginMode();
    if (!['either', 'code'].includes(mode)) throw err(mode === 'both' ? 'Enter your password first – the code is emailed after that.' : 'Emailed codes aren’t turned on. Sign in with your password.');
    const u = await q1('SELECT * FROM users WHERE lower(email) = lower(?)', String(body.email || '').trim());
    if (!u || !u.active) {g.fail();return { ok: true };} // don't reveal who has an account
    await sendCode(u, 'login');
    return { ok: true };
  }, { open: true });
  on('POST', '/api/login/code', async ({ body, ip }) => {
    const g = guard(ip);
    const mode = await loginMode();
    const u = await q1('SELECT * FROM users WHERE lower(email) = lower(?)', String(body.email || '').trim());
    const code = String(body.code || '').replace(/\D/g, '');
    const purpose = mode === 'both' ? 'login2' : 'login';
    const row = u ? await q1('SELECT * FROM login_codes WHERE user_id = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1', u.id, purpose) : null;
    if (!u || !u.active || !row || row.expires_at < now()) {g.fail();throw err('That code has expired or isn’t right. Ask for a new one.', 401);}
    if (row.tries >= 5) {await run('UPDATE login_codes SET used = 1 WHERE id = ?', row.id);throw Object.assign(err('Too many wrong codes. Ask for a new one.', 429), { commitOnError: true });}
    if (code.length !== 6 || !(await platform.checkPassword(code, row.code_hash))) {await run('UPDATE login_codes SET tries = tries + 1 WHERE id = ?', row.id);g.fail();throw Object.assign(err('That code isn’t right. Check the latest email and try again.', 401), { commitOnError: true });}
    await run('UPDATE login_codes SET used = 1 WHERE id = ?', row.id);
    g.ok();
    return { user: pub(u), _session: await startSession(u.id) };
  }, { open: true });
  on('POST', '/api/logout', async ({ token }) => {await run('DELETE FROM sessions WHERE token = ?', token);return { ok: true, _clearSession: true };});
  on('GET', '/api/me', async ({ me }) => ({ user: pub(me), firm: await getSetting('firm_name', ''), mailConfigured: await platform.mailConfigured(getSetting), testVersion: !!platform.testVersion }));
  on('PUT', '/api/me', async ({ me, body }) => {
    if (body.name != null) {if (!String(body.name).trim()) throw err('Enter your name.');await run('UPDATE users SET name = ?, initials = ? WHERE id = ?', String(body.name).trim(), initialsFor(body.name), me.id);}
    if (body.email_alerts != null) await run('UPDATE users SET email_alerts = ? WHERE id = ?', body.email_alerts ? 1 : 0, me.id);
    if (body.new_password) {
      if (!(await platform.checkPassword(String(body.current_password || ''), me.password_hash))) throw err('Your current password is wrong.');
      if (String(body.new_password).length < 8) throw err('Use at least 8 characters for the new password.');
      await run('UPDATE users SET password_hash = ? WHERE id = ?', await platform.hashPassword(body.new_password), me.id);
    }
    return { user: pub(await userById(me.id)) };
  });

  // users
  const adminOnly = (me) => {if (me.role !== 'admin') throw err('Only an admin can do that.', 403);};
  on('GET', '/api/users', async () => (await qa('SELECT * FROM users ORDER BY active DESC, name')).map(pub));
  on('POST', '/api/users', async ({ me, body }) => {
    adminOnly(me);
    const { name, email, password, role, color } = body;
    if (!name || !email || !password) throw err('Enter a name, email and starting password.');
    if (String(password).length < 8) throw err('Use at least 8 characters for the password.');
    if (await q1('SELECT id FROM users WHERE lower(email) = lower(?)', email.trim())) throw err('Someone already uses that email.');
    const used = (await qa('SELECT color FROM users')).map((r) => r.color);
    const c = COLORS.includes(color) ? color : COLORS.find((x) => !used.includes(x)) || 'blue';
    const r = await run('INSERT INTO users (name,email,initials,color,password_hash,role,tax_access) VALUES (?,?,?,?,?,?,?)', name.trim(), email.trim(), initialsFor(name), c, await platform.hashPassword(password), role === 'admin' ? 'admin' : 'staff', body.tax_access ? 1 : 0);
    return pub(await userById(Number(r.lastInsertRowid)));
  });
  on('PUT', '/api/users/:id', async ({ me, body, params }) => {
    adminOnly(me);
    const u = await userById(+params.id);if (!u) throw err('User not found.', 404);
    if (u.id === me.id && (body.active === false || body.role === 'staff')) throw err('You can’t remove your own admin access.');
    if (body.name != null) await run('UPDATE users SET name = ?, initials = ? WHERE id = ?', String(body.name).trim(), initialsFor(body.name), u.id);
    if (body.email != null) {
      if (await q1('SELECT id FROM users WHERE lower(email) = lower(?) AND id <> ?', String(body.email).trim(), u.id)) throw err('Someone already uses that email.');
      await run('UPDATE users SET email = ? WHERE id = ?', String(body.email).trim(), u.id);
    }
    if (body.role != null) await run('UPDATE users SET role = ? WHERE id = ?', body.role === 'admin' ? 'admin' : 'staff', u.id);
    if (body.tax_access != null) await run('UPDATE users SET tax_access = ? WHERE id = ?', body.tax_access ? 1 : 0, u.id);
    if (body.color && COLORS.includes(body.color)) await run('UPDATE users SET color = ? WHERE id = ?', body.color, u.id);
    if (body.active != null) {await run('UPDATE users SET active = ? WHERE id = ?', body.active ? 1 : 0, u.id);if (!body.active) await run('DELETE FROM sessions WHERE user_id = ?', u.id);}
    if (body.password) {
      if (String(body.password).length < 8) throw err('Use at least 8 characters for the password.');
      await run('UPDATE users SET password_hash = ? WHERE id = ?', await platform.hashPassword(body.password), u.id);
      await run('DELETE FROM sessions WHERE user_id = ?', u.id);
    }
    return pub(await userById(u.id));
  });

  // tasks
  on('GET', '/api/tasks', async ({ me, query: q }) => {
    const where = [],p = [];
    if (q.assignee) {where.push('t.assignee_id = ?');p.push(+q.assignee);}
    if (q.created_by) {where.push('t.created_by = ?');p.push(+q.created_by);}
    if (q.matter) {where.push('t.matter_id = ?');p.push(+q.matter);}
    if (q.status && STATUSES.includes(q.status)) {where.push('t.status = ?');p.push(q.status);}
    if (q.overdue === '1') {where.push("t.status <> 'done' AND t.due_date IS NOT NULL AND t.due_date < ?");p.push(today());}
    if (q.from) {where.push('t.due_date >= ?');p.push(q.from);}
    if (q.to) {where.push('t.due_date <= ?');p.push(q.to);}
    if (q.q) {where.push('(t.title ILIKE ? OR t.description ILIKE ? OR m.code ILIKE ? OR m.address ILIKE ? OR m.client ILIKE ?)');const l = `%${q.q}%`;p.push(l, l, l, l, l);}
    if (q.repeating === '1') {where.push("t.repeat IS NOT NULL AND t.status <> 'done'");}
    if (!canTax(me)) where.push(`(t.matter_id IS NULL OR m.type IS NULL OR m.type NOT IN ${TAX_IN})`);
    if (q.done_days && !q.status) {where.push("(t.status <> 'done' OR t.completed_at >= ?)");p.push(addDays(today(), -parseInt(q.done_days, 10)) + ' 00:00:00');}
    return await qa(`${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.position, t.id`, ...p);
  });
  on('GET', '/api/tasks/:id', async ({ params }) => {const t = await taskFull(+params.id);if (!t) throw err('That task no longer exists.', 404);return t;});
  const validTime = (v) => v == null || v === '' ? null : /^\d{2}:\d{2}$/.test(String(v)) ? String(v) : undefined;
  const validDuration = (v) => v == null || v === '' ? null : Number.isFinite(+v) && +v >= 5 && +v <= 1440 ? Math.round(+v) : undefined;
  const validRepeat = (v) => v == null || v === '' || v === 'none' ? null : W.REPEATS.some((r) => r.key === v) ? v : undefined;
  const repeatLabel = (k) => (W.REPEATS.find((r) => r.key === k) || { label: k }).label.toLowerCase();
  // When a repeating task is finished, create the next one in the series
  async function spawnNext(t, actorId) {
    t = await q1('SELECT * FROM tasks WHERE id = ?', t.id);
    if (!t || !t.repeat || t.repeat_next_id) return null;
    let next = W.nextRepeat(t.due_date || today(), t.repeat);
    let guard = 0;
    while (next && next < today() && guard++ < 1000) next = W.nextRepeat(next, t.repeat);
    if (!next || t.repeat_until && next > t.repeat_until) {await log({ taskId: t.id, matterId: t.matter_id, userId: actorId, action: 'finished the repeating series' });return null;}
    const r = await run(`INSERT INTO tasks (title, description, matter_id, assignee_id, created_by, due_date, due_time, duration, priority, status, position, repeat, repeat_until, series_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    t.title, t.description, t.matter_id, t.assignee_id, t.created_by, next, t.due_time, t.duration, t.priority, 'todo', await nextPos('todo'), t.repeat, t.repeat_until, t.series_id || t.id, now(), now());
    const nid = Number(r.lastInsertRowid);
    await run('INSERT INTO checklist_items (task_id, text, position) SELECT ?, text, position FROM checklist_items WHERE task_id = ? ORDER BY position, id', nid, t.id);
    await run('UPDATE tasks SET repeat_next_id = ? WHERE id = ?', nid, t.id);
    await log({ taskId: t.id, matterId: t.matter_id, userId: actorId, action: `repeats ${repeatLabel(t.repeat)} – next one due ${fmtDate(next)}` });
    await log({ taskId: nid, matterId: t.matter_id, userId: actorId, action: `created this from the repeating task (${repeatLabel(t.repeat)})` });
    return nid;
  }
  async function createTask(me, b) {
    if (!b.title || !String(b.title).trim()) throw err('Give the task a title.');
    let due = validDate(b.due_date);if (due === undefined) throw err('The due date isn’t valid.');
    const dueTime = validTime(b.due_time);if (dueTime === undefined) throw err('The time isn’t valid.');
    const repeat = validRepeat(b.repeat);if (repeat === undefined) throw err('Choose how often it repeats.');
    const until = validDate(b.repeat_until);if (until === undefined) throw err('The “repeat until” date isn’t valid.');
    const duration = validDuration(b.duration);if (duration === undefined) throw err('The length isn’t valid.');
    if (repeat && !due) due = today();
    const status = STATUSES.includes(b.status) ? b.status : 'todo';
    const matterId = b.matter_id ? +b.matter_id : null;
    if (matterId && !(await q1('SELECT id FROM matters WHERE id = ?', matterId))) throw err('That matter doesn’t exist.');
    const assignee = b.assignee_id ? +b.assignee_id : me.id;
    await taxPersonCheck(assignee, matterId);
    const id = await tx(async () => {
      const r = await run(`INSERT INTO tasks (title, description, matter_id, item_id, assignee_id, created_by, due_date, due_time, duration, priority, status, position, repeat, repeat_until, completed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      String(b.title).trim(), b.description || '', matterId, b.item_id || null, assignee, me.id, due, dueTime, dueTime ? duration : null, PRIORITIES.includes(b.priority) ? b.priority : 'normal', status, await nextPos(status), repeat, until, status === 'done' ? now() : null, now(), now());
      const tid = Number(r.lastInsertRowid);
      await log({ taskId: tid, matterId, userId: me.id, action: (b.item_id ? 'created this task from the matter checklist' : 'created this task') + (repeat ? ` (repeats ${repeatLabel(repeat)})` : '') });
      if (Array.isArray(b.checklist)) await db.insertMany('checklist_items', ['task_id','text','position'], b.checklist.filter(x => String(x).trim()).map((text, i) => [tid, String(text).trim(), i]));
      return tid;
    });
    const t = await q1('SELECT * FROM tasks WHERE id = ?', id);
    const warn = await leaveWarning(assignee, due);
    await notify(assignee, me.id, id, 'assigned', `${me.name} assigned you: ${await taskLabel(t)}${due ? ' (due ' + fmtDate(due) + ')' : ''}`, `New task: ${await taskLabel(t)}`);
    const full = await taskFull(id);
    if (warn) full.warning = warn;
    return full;
  }
  on('POST', '/api/tasks', async ({ me, body }) => await createTask(me, { ...body, item_id: null }));
  on('PUT', '/api/tasks/:id', async ({ me, body: b, params }) => {
    const t = await q1('SELECT * FROM tasks WHERE id = ?', +params.id);if (!t) throw err('That task no longer exists.', 404);
    const sets = [],p = [],acts = [],after = [];
    if (b.title != null && String(b.title).trim() && b.title !== t.title) {sets.push('title = ?');p.push(String(b.title).trim());acts.push(`renamed this to “${String(b.title).trim()}”`);}
    if (b.description != null && b.description !== t.description) {sets.push('description = ?');p.push(String(b.description));acts.push('updated the description');}
    if (b.priority && PRIORITIES.includes(b.priority) && b.priority !== t.priority) {sets.push('priority = ?');p.push(b.priority);acts.push(`set priority to ${b.priority}`);}
    if (b.due_date !== undefined) {
      const due = validDate(b.due_date);if (due === undefined) throw err('The due date isn’t valid.');
      if (due !== t.due_date) {sets.push('due_date = ?', 'overdue_notified = 0');p.push(due);acts.push(due ? `changed the due date to ${fmtDate(due)}` : 'removed the due date');
        after.push(async () => await notify(t.assignee_id, me.id, t.id, 'due', `${me.name} changed the due date of “${await taskLabel(t)}” to ${fmtDate(due)}`));}
    }
    if (b.due_time !== undefined) {
      const tm = validTime(b.due_time);if (tm === undefined) throw err('The time isn’t valid.');
      if (tm !== t.due_time) {sets.push('due_time = ?');p.push(tm);acts.push(tm ? `set the time to ${tm}` : 'removed the time');}
    }
    if (b.duration !== undefined) {
      const du = validDuration(b.duration);if (du === undefined) throw err('The length isn’t valid.');
      if (du !== t.duration) {sets.push('duration = ?');p.push(du);acts.push(du ? `set the length to ${du >= 60 ? du / 60 + (du === 60 ? ' hour' : ' hours') : du + ' minutes'}` : 'cleared the length');}
    }
    if (b.repeat !== undefined) {
      const rp = validRepeat(b.repeat);if (rp === undefined) throw err('Choose how often it repeats.');
      if (rp !== t.repeat) {sets.push('repeat = ?');p.push(rp);acts.push(rp ? `set it to repeat ${repeatLabel(rp)}` : 'stopped it repeating');
        if (rp && !t.due_date && b.due_date === undefined) {sets.push('due_date = ?');p.push(today());}}
    }
    if (b.repeat_until !== undefined) {
      const u = validDate(b.repeat_until);if (u === undefined) throw err('The “repeat until” date isn’t valid.');
      if (u !== t.repeat_until) {sets.push('repeat_until = ?');p.push(u);acts.push(u ? `set the series to end ${fmtDate(u)}` : 'removed the series end date');}
    }
    if (b.matter_id !== undefined) {
      const mid = b.matter_id ? +b.matter_id : null;
      if (mid && !(await q1('SELECT id FROM matters WHERE id = ?', mid))) throw err('That matter doesn’t exist.');
      if (mid !== t.matter_id && b.assignee_id === undefined) await taxPersonCheck(t.assignee_id, mid);
      if (mid !== t.matter_id) {sets.push('matter_id = ?');p.push(mid);const m = mid ? await q1('SELECT * FROM matters WHERE id = ?', mid) : null;acts.push(m ? `linked this to ${matterName(m)}` : 'unlinked the matter');}
    }
    if (b.assignee_id !== undefined) {
      const aid = b.assignee_id ? +b.assignee_id : null;
      if (aid !== t.assignee_id) {
        const u = await userById(aid);if (aid && !u) throw err('That person doesn’t exist.');
        await taxPersonCheck(aid, b.matter_id !== undefined ? b.matter_id : t.matter_id);
        sets.push('assignee_id = ?');p.push(aid);acts.push(u ? `assigned this to ${u.name}` : 'unassigned this');
        after.push(async () => await notify(aid, me.id, t.id, 'assigned', `${me.name} assigned you: ${await taskLabel(t)}${t.due_date ? ' (due ' + fmtDate(t.due_date) + ')' : ''}`, `Task assigned: ${await taskLabel(t)}`));
      }
    }
    if (b.status && STATUSES.includes(b.status) && b.status !== t.status) {
      sets.push('status = ?', 'completed_at = ?', 'position = ?');p.push(b.status, b.status === 'done' ? now() : null, await nextPos(b.status));
      acts.push(`moved this from ${STATUS_LABEL[t.status]} to ${STATUS_LABEL[b.status]}`);
      after.push(async () => await statusChangeNotify(t, me, b.status));
      if (b.status === 'done') after.push(async () => {await syncItemFromTask(t, me.id);await spawnNext(t, me.id);});
    }
    if (!sets.length) return await taskFull(t.id);
    sets.push('updated_at = ?');p.push(now());
    await tx(async () => {await run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, ...p, t.id);await forEachAsync(acts, async (a) => await log({ taskId: t.id, matterId: t.matter_id, userId: me.id, action: a }));});
    await forEachAsync(after, async (f) => await f());
    const full = await taskFull(t.id);
    if ((b.assignee_id !== undefined || b.due_date !== undefined) && full.status !== 'done') {const w = await leaveWarning(full.assignee_id, full.due_date);if (w) full.warning = w;}
    return full;
  });
  // copy a task (calendar copy & paste / Ctrl+drag): same details and checklist, new date / time / person
  on('POST', '/api/tasks/:id/copy', async ({ me, body: b, params }) => {
    const t = await q1('SELECT * FROM tasks WHERE id = ?', +params.id);if (!t) throw err('That task no longer exists.', 404);
    const nt = await createTask(me, { title: t.title, description: t.description, matter_id: t.matter_id, priority: t.priority,
      assignee_id: b.assignee_id !== undefined ? b.assignee_id : t.assignee_id,
      due_date: b.due_date !== undefined ? b.due_date : t.due_date, due_time: b.due_time !== undefined ? b.due_time : t.due_time,
      duration: b.duration !== undefined ? b.duration : t.duration,
      checklist: (await qa('SELECT text FROM checklist_items WHERE task_id = ? ORDER BY position, id', t.id)).map((c) => c.text) });
    await log({ taskId: nt.id, matterId: t.matter_id, userId: me.id, action: `copied this from “${t.title}”` });
    return await taskFull(nt.id);
  });
  on('POST', '/api/tasks/:id/move', async ({ me, body, params }) => {
    const t = await q1('SELECT * FROM tasks WHERE id = ?', +params.id);if (!t) throw err('That task no longer exists.', 404);
    const { status, before_id, after_id } = body;
    if (!STATUSES.includes(status)) throw err('Unknown status.');
    const bf = before_id ? await q1('SELECT position FROM tasks WHERE id = ?', +before_id) : null;
    const af = after_id ? await q1('SELECT position FROM tasks WHERE id = ?', +after_id) : null;
    const pos = bf && af ? (bf.position + af.position) / 2 : af ? af.position - 1 : bf ? bf.position + 1 : await nextPos(status);
    await tx(async () => {
      await run('UPDATE tasks SET status = ?, position = ?, completed_at = ?, updated_at = ? WHERE id = ?', status, pos, status === 'done' ? t.completed_at || now() : null, now(), t.id);
      if (status !== t.status) await log({ taskId: t.id, matterId: t.matter_id, userId: me.id, action: `moved this from ${STATUS_LABEL[t.status]} to ${STATUS_LABEL[status]}` });
    });
    if (status !== t.status) {await statusChangeNotify(t, me, status);if (status === 'done') {await syncItemFromTask(t, me.id);await spawnNext(t, me.id);}}
    return { ok: true };
  });
  on('DELETE', '/api/tasks/:id', async ({ me, params }) => {
    const t = await q1('SELECT * FROM tasks WHERE id = ?', +params.id);if (!t) throw err('That task no longer exists.', 404);
    if (me.role !== 'admin' && t.created_by !== me.id) throw err('Only the person who created this task, or an admin, can delete it.', 403);
    const files = await qa('SELECT stored_name FROM attachments WHERE task_id = ?', t.id);
    await run('DELETE FROM tasks WHERE id = ?', t.id);
    for (const f of files) await platform.deleteFile(f.stored_name);
    if (t.matter_id) await log({ matterId: t.matter_id, userId: me.id, action: `deleted the task “${t.title}”` });
    return { ok: true };
  });
  on('POST', '/api/tasks/:id/checklist', async ({ body, params }) => {
    const t = await q1('SELECT id FROM tasks WHERE id = ?', +params.id);if (!t) throw err('That task no longer exists.', 404);
    const text = String(body.text || '').trim();if (!text) throw err('Enter the checklist item.');
    await run(`WITH added AS (INSERT INTO checklist_items (task_id,text,position)
      SELECT ?,?,COALESCE(MAX(position),0)+1 FROM checklist_items WHERE task_id = ? RETURNING id)
      UPDATE tasks SET updated_at = ? WHERE id = ?`, t.id,text,t.id,now(),t.id);
    return await taskFull(t.id);
  });
  on('PUT', '/api/checklist/:id', async ({ me, body, params }) => {
    const c = await q1('SELECT * FROM checklist_items WHERE id = ?', +params.id);if (!c) throw err('Item not found.', 404);
    const sets = [], values = [], changes = [];
    if (body.done != null) {sets.push('done = ?');values.push(body.done ? 1 : 0);}
    if (body.text != null && String(body.text).trim()) {sets.push('text = ?');values.push(String(body.text).trim());}
    if (sets.length) {changes.push(`edited AS (UPDATE checklist_items SET ${sets.join(',')} WHERE id = ? RETURNING id)`);values.push(c.id);}
    if (body.done != null && !!body.done !== !!c.done) {
      changes.push('recorded AS (INSERT INTO activity (task_id,user_id,action,created_at) VALUES (?,?,?,?) RETURNING id)');
      values.push(c.task_id,me.id,`${body.done ? 'ticked' : 'unticked'} “${c.text}”`,now());
    }
    await run(`${changes.length ? 'WITH '+changes.join(',')+' ' : ''}UPDATE tasks SET updated_at = ? WHERE id = ?`, ...values,now(),c.task_id);
    return await taskFull(c.task_id);
  });
  on('DELETE', '/api/checklist/:id', async ({ params }) => {
    const c = await q1('SELECT * FROM checklist_items WHERE id = ?', +params.id);if (!c) throw err('Item not found.', 404);
    await run('WITH removed AS (DELETE FROM checklist_items WHERE id = ? RETURNING id) UPDATE tasks SET updated_at = ? WHERE id = ?', c.id,now(),c.task_id);
    return await taskFull(c.task_id);
  });
  on('POST', '/api/tasks/:id/notes', async ({ me, body, params }) => {
    const t = await q1('SELECT * FROM tasks WHERE id = ?', +params.id);if (!t) throw err('That task no longer exists.', 404);
    const text = String(body.body || '').trim();if (!text) throw err('Write a note first.');
    await run('WITH added AS (INSERT INTO notes (task_id,user_id,body,created_at) VALUES (?,?,?,?) RETURNING id) UPDATE tasks SET updated_at = ? WHERE id = ?', t.id,me.id,text,now(),now(),t.id);
    const mentioned = new Set();
    const activeUsers = await qa('SELECT * FROM users WHERE active = 1');
    for (const u of activeUsers) {
      const first = u.name.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`@(${first}|${u.initials})\\b`, 'i').test(text)) mentioned.add(u.id);
    }
    const snip = text.length > 140 ? text.slice(0, 140) + '…' : text;
    await forEachAsync(mentioned, async (uid) => await notify(uid, me.id, t.id, 'mention', `${me.name} mentioned you on “${await taskLabel(t)}”: ${snip}`, `${me.name} mentioned you: ${await taskLabel(t)}`));
    await forEachAsync([t.assignee_id, t.created_by].filter((v, i, a) => v && a.indexOf(v) === i && !mentioned.has(v) && v !== me.id), async (uid) => {
      const u = activeUsers.find(user => user.id === uid);if (!u) return;
      await run('INSERT INTO notifications (user_id, task_id, kind, text, created_at) VALUES (?,?,?,?,?)', uid, t.id, 'note', `${me.name} added a note on “${await taskLabel(t)}”: ${snip}`, now());
    });
    return await taskFull(t.id);
  });
  on('DELETE', '/api/notes/:id', async ({ me, params }) => {
    const n = await q1('SELECT * FROM notes WHERE id = ?', +params.id);if (!n) throw err('Note not found.', 404);
    if (n.user_id !== me.id && me.role !== 'admin') throw err('You can only delete your own notes.', 403);
    await run('DELETE FROM notes WHERE id = ?', n.id);await touchTask(n.task_id);return await taskFull(n.task_id);
  });

  // attachments
  on('POST', '/api/tasks/:id/attachments', async ({ me, files, params }) => {
    const t = await q1('SELECT * FROM tasks WHERE id = ?', +params.id);
    if (!t) {for (const f of files || []) await platform.discardUpload(f);throw err('That task no longer exists.', 404);}
    if (!files || !files.length) throw err('No files received.');
    for (const f of files) {
      if (f.size > 100 * 1024 * 1024) throw err('Files can be up to 100 MB each.');
      const stored = await platform.storeFile(f);
      const r = await run('INSERT INTO attachments (task_id, filename, stored_name, mime, size, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?)',
      t.id, f.name, stored, guessMime(f.name, f.type), f.size, me.id, now());
      const meta = isEmail(f.name) ? await ensureParts(await q1('SELECT * FROM attachments WHERE id = ?', Number(r.lastInsertRowid)), f) : null;
      await log({ taskId: t.id, matterId: t.matter_id, userId: me.id, action: meta ? `attached email “${meta.subject || f.name}”${meta.attachments.length ? ` (with ${meta.attachments.length} attachment${meta.attachments.length > 1 ? 's' : ''})` : ''}` : `attached ${f.name}` });
    }
    await touchTask(t.id);return await taskFull(t.id);
  }, { upload: 'files' });
  on('POST', '/api/parse-email', async ({ files }) => {
    const f = files && files[0];if (!f) throw err('No file received.');
    const res = isEmail(f.name) ? await platform.readEmail({ upload: f }, f.name) : null;
    await platform.discardUpload(f);
    const meta = res ? res.meta : null;
    return { meta };
  }, { upload: 'file' });
  on('GET', '/api/attachments/:id', async ({ params, query }) => {
    const a = await q1('SELECT * FROM attachments WHERE id = ?', +params.id);if (!a) throw err('File not found.', 404);
    const inline = query.inline === '1' && /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/.test(a.mime);
    return { _download: { stored_name: a.stored_name, filename: a.filename, mime: a.mime, inline } };
  });
  // files inside an attached email
  on('GET', '/api/attachments/:id/parts', async ({ params }) => {
    const a = await q1('SELECT * FROM attachments WHERE id = ?', +params.id);if (!a) throw err('File not found.', 404);
    if (isEmail(a.filename) && !a.parts_done) await ensureParts(a, null);
    const fresh = await q1('SELECT email_meta FROM attachments WHERE id = ?', a.id);
    return { meta: fresh.email_meta ? JSON.parse(fresh.email_meta) : null, parts: await qa('SELECT id, filename, mime, size FROM email_parts WHERE attachment_id = ? ORDER BY position, id', a.id) };
  });
  on('GET', '/api/parts/:id', async ({ params, query }) => {
    const p = await q1('SELECT * FROM email_parts WHERE id = ?', +params.id);if (!p) throw err('File not found.', 404);
    const inline = query.inline === '1' && /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/.test(p.mime);
    return { _download: { stored_name: p.stored_name, filename: p.filename, mime: p.mime, inline } };
  });
  // short-lived link so the "Open in Outlook / Word" helper on each PC can fetch the file
  on('POST', '/api/open-link', async ({ body }) => {
    const src = body.kind === 'part' ? await q1('SELECT stored_name, filename, mime FROM email_parts WHERE id = ?', +body.id) : await q1('SELECT stored_name, filename, mime FROM attachments WHERE id = ?', +body.id);
    if (!src) throw err('File not found.', 404);
    if (!platform.supportsOpenLinks) throw err('Opening files straight in Outlook works on the office version, not this test file. Use Download instead.');
    const token = platform.randomToken().slice(0, 40);
    const exp = new Date(Date.now() + 5 * 60e3);
    await run('INSERT INTO file_tokens (token, stored_name, filename, mime, expires_at) VALUES (?,?,?,?,?)', token, src.stored_name, src.filename, src.mime, `${dstr(exp)} ${pad(exp.getHours())}:${pad(exp.getMinutes())}:${pad(exp.getSeconds())}`);
    return { token, filename: src.filename };
  });
  on('GET', '/api/open/:token/:name', async ({ params }) => {
    const t = await q1('SELECT * FROM file_tokens WHERE token = ?', params.token);
    if (!t || t.expires_at < now()) throw err('This link has expired. Click Open again in TaskForce.', 410);
    return { _download: { stored_name: t.stored_name, filename: t.filename, mime: t.mime, inline: false } };
  }, { open: true });
  on('GET', '/api/opener-installer', ({ origin }) => {
    if (!platform.supportsOpenLinks || !origin) throw err('The Outlook helper is set up from the office version of TaskForce.');
    return { _file: { filename: 'TaskForce-Open-in-Outlook-setup.bat', mime: 'application/octet-stream', content: openerInstaller(origin) } };
  });
  on('DELETE', '/api/attachments/:id', async ({ me, params }) => {
    const a = await q1('SELECT * FROM attachments WHERE id = ?', +params.id);if (!a) throw err('File not found.', 404);
    if (a.uploaded_by !== me.id && me.role !== 'admin') throw err('Only the person who attached this, or an admin, can remove it.', 403);
    for (const p of await qa('SELECT stored_name FROM email_parts WHERE attachment_id = ?', a.id)) await platform.deleteFile(p.stored_name);
    await run('DELETE FROM attachments WHERE id = ?', a.id);await platform.deleteFile(a.stored_name);
    await log({ taskId: a.task_id, userId: me.id, action: `removed ${a.filename}` });await touchTask(a.task_id);
    return await taskFull(a.task_id);
  });

  // matters
  on('GET', '/api/matters', async ({ me, query: q }) => {
    const where = [],p = [];
    if (!canTax(me) || q.area === 'conv') where.push(`m.type NOT IN ${TAX_IN}`);
    if (q.area === 'tax') where.push(`m.type IN ${TAX_IN}`);
    if (q.status && q.status !== 'all') {where.push('m.status = ?');p.push(q.status);}
    if (q.type) {const ts = String(q.type).split(',').filter((t) => W.TYPE[t]);if (ts.length) {where.push(`m.type IN (${ts.map(() => '?').join(',')})`);p.push(...ts);}}
    if (q.responsible) {where.push('m.responsible_id = ?');p.push(+q.responsible);}
    if (q.q) {where.push('(m.code ILIKE ? OR m.address ILIKE ? OR m.client ILIKE ? OR m.other_side ILIKE ?)');const l = `%${q.q}%`;p.push(l, l, l, l);}
    const list = await qa(`SELECT * FROM matters m ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (m.settlement_date IS NULL), m.settlement_date, m.code, m.type`, ...p);
    if (q.brief === '1') return list.map((m) => ({ id: m.id, code: m.code, type: m.type, client: m.client, address: m.address, status: m.status, settlement_date: m.settlement_date, finance_date: m.finance_date, responsible_id: m.responsible_id, name: matterName(m) }));
    return await enrichMatters(list);
  });
  on('GET', '/api/matters/:id', async ({ me, params }) => {const m = await matterFull(+params.id);if (!m) throw err('That matter no longer exists.', 404);if (!canTax(me)) m.related = m.related.filter((r) => !isTax(r.type));return m;});
  // milestone due dates for the calendar
  on('GET', '/api/calendar/milestones', async ({ me, query: q }) => {
    const out = [];
    for (const m of await enrichMatters(await qa(`SELECT * FROM matters WHERE status = 'active'${canTax(me) ? '' : ` AND type NOT IN ${TAX_IN}`}`))) {
      for (const x of m.milestones) {
        if (!x.due || !x.applies) continue;
        if (q.from && x.due < q.from || q.to && x.due > q.to) continue;
        out.push({ matter_id: m.id, matter: m.name, code: m.code, type: m.type, responsible_id: m.responsible_id, item_id: x.id, label: x.label, title: x.title, status: x.status, due: x.due, done: x.done, overdue: x.overdue, person_id: x.person_id });
      }
    }
    return out;
  });
  on('POST', '/api/matters', async ({ me, body }) => {
    const f = matterFields(body);
    if (!f.code) throw err('Enter the matter code, like BC1234.');
    f.type = f.type || 'P';
    if (await q1('SELECT id FROM matters WHERE lower(code) = lower(?) AND type = ?', f.code, f.type)) throw err(`${f.code} ${W.TYPE[f.type].short} already exists.`);
    f.responsible_id = f.responsible_id || me.id;
    if (isTax(f.type)) {const u = await userById(f.responsible_id);if (u && !canTax(u)) throw err(`${u.name} doesn’t have Taxation access, so they can’t be responsible for a taxation job.`);}
    const id = await tx(async () => {
      const keys = Object.keys(f);
      const r = await run(`INSERT INTO matters (${keys.join(',')}, created_by, created_at, updated_at) VALUES (${keys.map(() => '?').join(',')}, ?, ?, ?)`, ...keys.map((k) => f[k]), me.id, now(), now());
      const mid = Number(r.lastInsertRowid);
      const m = await q1('SELECT * FROM matters WHERE id = ?', mid);
      await log({ matterId: mid, userId: me.id, action: `opened matter ${matterName(m)}` });
      if (body.apply_checklist !== false) await applyChecklist(m, me.id, body.checklist_key === undefined ? undefined : String(body.checklist_key || ''));
      return mid;
    });
    const m = await q1('SELECT * FROM matters WHERE id = ?', id);
    await notify(m.responsible_id, me.id, null, 'matter', `${me.name} made you responsible for ${matterName(m)}`, `Matter ${matterName(m)} assigned to you`, id);
    await syncUnfin(id, me);
    return { id };
  });
  on('PUT', '/api/matters/:id', async ({ me, body, params }) => {
    const m = await q1('SELECT * FROM matters WHERE id = ?', +params.id);if (!m) throw err('That matter no longer exists.', 404);
    const f = matterFields(body);
    const code = f.code || m.code,type = f.type || m.type;
    if ((code !== m.code || type !== m.type) && (await q1('SELECT id FROM matters WHERE lower(code) = lower(?) AND type = ? AND id <> ?', code, type, m.id))) throw err(`${code} ${W.TYPE[type].short} already exists.`);
    const keys = Object.keys(f).filter((k) => f[k] !== m[k]);
    if (!keys.length) return { ok: true };
    if (isTax(type)) {const u = await userById(f.responsible_id !== undefined ? f.responsible_id : m.responsible_id);if (u && !canTax(u)) throw err(`${u.name} doesn’t have Taxation access, so they can’t be responsible for a taxation job.`);}
    const labels = { settlement_date: 'settlement date', finance_date: 'finance date', responsible_id: 'responsible person', other_side: 'other side', gst_applies: 'GST applies', sdr_claimed: 'SDR (Stamp Duty Relief) claimed', unconditional: 'unconditional contract' };
    await tx(async () => {
      await run(`UPDATE matters SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => f[k]), now(), m.id);
      for (const k of keys) {
        let v = f[k];
        if (k === 'notes') {await log({ matterId: m.id, userId: me.id, action: 'updated the matter notes' });continue;}
        if (k.endsWith('_date')) v = v ? fmtDate(v) : 'not fixed';
        if (k === 'responsible_id') v = ((await userById(v)) || {}).name || 'nobody';
        if (k === 'gst_applies' || k === 'sdr_claimed' || k === 'unconditional') v = v ? 'yes' : 'no';
        if (k === 'type') v = W.TYPE[v].short;
        await log({ matterId: m.id, userId: me.id, action: `changed ${labels[k] || k} to ${v || 'blank'}` });
      }
    });
    if (keys.includes('responsible_id')) {const mm = await q1('SELECT * FROM matters WHERE id = ?', m.id);await notify(f.responsible_id, me.id, null, 'matter', `${me.name} made you responsible for ${matterName(mm)}`, `Matter ${matterName(mm)} assigned to you`, m.id);}
    if (keys.some((k) => ['unconditional', 'finance_date', 'settlement_date', 'status', 'code'].includes(k))) await syncUnfin(m.id, me);
    return { ok: true };
  });
  on('DELETE', '/api/matters/:id', async ({ me, params }) => {
    adminOnly(me);
    const m = await q1('SELECT * FROM matters WHERE id = ?', +params.id);if (!m) throw err('That matter no longer exists.', 404);
    const files = await qa('SELECT a.stored_name FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE t.matter_id = ?', m.id);
    await tx(async () => {await run('DELETE FROM tasks WHERE matter_id = ?', m.id);await run('DELETE FROM matters WHERE id = ?', m.id);});
    for (const f of files) await platform.deleteFile(f.stored_name);
    return { ok: true };
  });

  // readiness board cells
  on('PUT', '/api/matters/:id/readiness', async ({ me, body, params }) => {
    const m = await q1('SELECT * FROM matters WHERE id = ?', +params.id);if (!m) throw err('That matter no longer exists.', 404);
    const col = W.BOARD_NOTES.find((c) => c.key === body.key);
    if (!col) throw err('Board statuses now live on the matter’s milestone checklist items. Refresh the page.');
    const v = (body.value == null ? '' : String(body.value).trim()).slice(0, 500);
    const values = parseReadiness(m);
    if ((values[col.key] || '') === v) return (await enrichMatters([m]))[0];
    if (v) values[col.key] = v;else delete values[col.key];
    await run('UPDATE matters SET readiness = ?, updated_at = ? WHERE id = ?', JSON.stringify(values), now(), m.id);
    await log({ matterId: m.id, userId: me.id, action: `updated ${col.label} on the Readiness Board: “${v}”` });
    const [en] = await enrichMatters([await q1('SELECT * FROM matters WHERE id = ?', m.id)]);
    return en;
  });

  // matter checklist items
  on('POST', '/api/matters/:id/checklist/apply', async ({ me, body, params }) => {
    const m = await q1('SELECT * FROM matters WHERE id = ?', +params.id);if (!m) throw err('That matter no longer exists.', 404);
    const key = body.checklist_key || (await typeChecklists())[m.type];
    if (!key) throw err('Choose a checklist from the library.');
    await libKey(key);
    if (!(await applyChecklist(m, me.id, key))) throw err('That checklist has no stages yet. Add some in Admin → Checklist library.');
    await touchMatter(m.id);return await matterFull(m.id);
  });
  on('POST', '/api/matters/:id/items', async ({ me, body, params }) => {
    const m = await q1('SELECT * FROM matters WHERE id = ?', +params.id);if (!m) throw err('That matter no longer exists.', 404);
    const title = String(body.title || '').trim();if (!title) throw err('Enter the checklist item.');
    const stage = (await stagesFor(m)).find((s) => s.key === body.stage);if (!stage) throw err('Choose a stage.');
    const parent = body.parent_id ? await q1('SELECT * FROM matter_items WHERE id = ? AND matter_id = ?', +body.parent_id, m.id) : null;
    const pos = ((await q1('SELECT MAX(position) AS p FROM matter_items WHERE matter_id = ? AND stage = ? AND parent_id IS NOT DISTINCT FROM ?', m.id, stage.key, parent ? parent.id : null)).p || 0) + 1;
    await run('INSERT INTO matter_items (matter_id, stage, parent_id, title, position, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)', m.id, stage.key, parent ? parent.id : null, title, pos, me.id, now());
    await log({ matterId: m.id, userId: me.id, action: `added “${title}” to ${stage.label}` });
    await touchMatter(m.id);return await matterFull(m.id);
  });
  on('PUT', '/api/items/:id', async ({ me, body, params }) => {
    const it = await q1('SELECT * FROM matter_items WHERE id = ?', +params.id);if (!it) throw err('Item not found.', 404);
    const m = await q1('SELECT * FROM matters WHERE id = ?', it.matter_id);
    const side = W.sideOf(m.type) || 'P';
    const allowed = W.statusOptions(it, side, !!it.parent_id);
    const sets = [],p = [],acts = [];
    const stageLabel = ((await stagesFor(m)).find((s) => s.key === it.stage) || W.STAGES.find((s) => s.key === it.stage) || {}).label || it.stage;
    if (body.status !== undefined && body.status !== it.status) {
      if (body.status && !allowed.includes(body.status) && !W.ITEM_STATUS.P.concat(W.ITEM_STATUS.V, W.SUB_STATUS.P).includes(body.status)) throw err('Unknown status.');
      if (String(body.status).length > 60) throw err('Unknown status.');
      sets.push('status = ?');p.push(body.status || '');acts.push(`${stageLabel} · “${it.title}”: ${body.status || 'cleared'}`);
    }
    if (body.person_id !== undefined) {const pid = body.person_id ? +body.person_id : null;if (pid !== it.person_id) {sets.push('person_id = ?');p.push(pid);acts.push(`${stageLabel} · “${it.title}”: person ${((await userById(pid)) || { name: 'cleared' }).name}`);}}
    if (body.date !== undefined) {const d = validDate(body.date);if (d === undefined) throw err('The date isn’t valid.');if (d !== it.date) {sets.push('date = ?');p.push(d);}}
    if (body.value !== undefined && String(body.value) !== it.value) {sets.push('value = ?');p.push(String(body.value).slice(0, 300));}
    if (body.note !== undefined && String(body.note) !== it.note) {sets.push('note = ?');p.push(String(body.note).slice(0, 5000));}
    if (body.title !== undefined && String(body.title).trim() && body.title !== it.title) {sets.push('title = ?');p.push(String(body.title).trim());}
    if (body.ms !== undefined) {
      // mark / unmark this one matter's item as a milestone (the library sets the default for new matters)
      let v = null;
      if (body.ms) {const base = W.parseMs(it.ms) || (it.tpl_id ? W.parseMs(((await q1('SELECT ms FROM checklist_templates WHERE id = ?', it.tpl_id)) || {}).ms) : null) || W.cleanMs({ label: it.title });v = JSON.stringify(W.cleanMs({ ...base, ...(typeof body.ms === 'object' ? body.ms : {}) }));}
      if (v !== (it.ms || null)) {sets.push('ms = ?');p.push(v);acts.push(v ? `marked “${it.title}” as a milestone` : `unmarked “${it.title}” as a milestone`);}
    }
    if (!sets.length) return { ok: true };
    sets.push('updated_by = ?', 'updated_at = ?');p.push(me.id, now());
    await tx(async () => {
      await run(`UPDATE matter_items SET ${sets.join(', ')} WHERE id = ?`, ...p, it.id);
      await forEachAsync(acts, async (a) => await log({ matterId: it.matter_id, userId: me.id, action: a }));
      await touchMatter(it.matter_id);
      if (body.status !== undefined && W.itemDone({ ...it, status: body.status }, W.sdrClaimed(m, parseReadiness(m)))) await syncTasksFromItem({ ...it, status: body.status }, me.id);
    });
    if (body.person_id && +body.person_id !== it.person_id) await notify(+body.person_id, me.id, null, 'item', `${me.name} put you on “${it.title}” (${stageLabel}) for ${matterName(m)}`, null, m.id);
    const fresh = await q1('SELECT * FROM matter_items WHERE id = ?', it.id);
    const [en] = await enrichMatters([await q1('SELECT * FROM matters WHERE id = ?', m.id)]);
    return { ok: true, item: { ...fresh, ms: W.parseMs(fresh.ms) }, matter: en };
  });
  on('DELETE', '/api/items/:id', async ({ me, params }) => {
    const it = await q1('SELECT * FROM matter_items WHERE id = ?', +params.id);if (!it) throw err('Item not found.', 404);
    await run('DELETE FROM matter_items WHERE id = ?', it.id);
    await log({ matterId: it.matter_id, userId: me.id, action: `removed “${it.title}” from the checklist` });
    await touchMatter(it.matter_id);return await matterFull(it.matter_id);
  });
  on('POST', '/api/items/:id/assign', async ({ me, body, params }) => {
    const it = await q1('SELECT * FROM matter_items WHERE id = ?', +params.id);if (!it) throw err('Item not found.', 404);
    const m = await q1('SELECT * FROM matters WHERE id = ?', it.matter_id);
    const stage = (await stagesFor(m)).find((s) => s.key === it.stage) || { label: it.stage };
    const parent = it.parent_id ? await q1('SELECT title FROM matter_items WHERE id = ?', it.parent_id) : null;
    const t = await createTask(me, {
      title: parent ? `${parent.title}: ${it.title}` : it.title,
      description: body.description || `${stage.label} checklist item for ${matterName(m)}.`,
      matter_id: m.id, item_id: it.id, assignee_id: body.assignee_id, due_date: body.due_date || (it.ms ? ((await milestonesOf(m, await qa('SELECT * FROM matter_items WHERE matter_id = ?', m.id), await stagesFor(m), parseReadiness(m))).find((x) => x.id === it.id) || {}).due : null) || (await stageDue(stage, m)), priority: body.priority
    });
    if (body.assignee_id) await run('UPDATE matter_items SET person_id = COALESCE(person_id, ?) WHERE id = ?', +body.assignee_id, it.id);
    await log({ matterId: m.id, userId: me.id, action: `assigned “${it.title}” to ${((await userById(+body.assignee_id || me.id)) || {}).name} as a task` });
    await touchMatter(m.id);
    return t;
  });

  // checklist library (admin): checklists, their stages and items, and which checklist each matter type gets
  const libKey = async (k) => {const c = await q1('SELECT * FROM checklists WHERE key = ?', String(k || ''));if (!c) throw err('That checklist no longer exists.', 404);return c;};
  const newKey = () => 'cl' + platform.randomToken().slice(0, 8);
  on('GET', '/api/library', async ({ me }) => {
    const lists = (await qa(`SELECT c.*,
      (SELECT COUNT(*) FROM checklist_stages s WHERE s.checklist_key = c.key) AS stages,
      (SELECT COUNT(*) FROM checklist_templates t WHERE t.checklist_key = c.key) AS items,
      (SELECT COUNT(*) FROM checklist_templates t WHERE t.checklist_key = c.key AND t.ms IS NOT NULL AND t.ms <> '') AS milestones
      FROM checklists c ORDER BY c.position, c.id`)).filter(c => c.area !== 'tax' || canTax(me));
    const types = await typeChecklists();
    if (!canTax(me)) W.MATTER_TYPES.filter((t) => t.area === 'tax').forEach((t) => delete types[t.key]);
    return { checklists: lists, types, areas: W.AREAS.filter((a) => a.key !== 'tax' || canTax(me)) };
  });
  on('GET', '/api/library/:key', async ({ params }) => {
    const c = await libKey(params.key);
    return { checklist: c, stages: await qa('SELECT * FROM checklist_stages WHERE checklist_key = ? ORDER BY position, id', c.key),
      items: (await qa('SELECT * FROM checklist_templates WHERE checklist_key = ? ORDER BY position, id', c.key)).map((t) => ({ ...t, ms: W.parseMs(t.ms) })), resettable: ['BC-P', 'BC-V'].includes(c.key),
      open_matters: (await q1(`SELECT COUNT(DISTINCT i.matter_id) AS n FROM matter_items i JOIN matters m ON m.id = i.matter_id WHERE m.status = 'active' AND i.tpl_id IN (SELECT id FROM checklist_templates WHERE checklist_key = ?)`, c.key)).n };
  });
  on('POST', '/api/library', async ({ me, body }) => {
    adminOnly(me);
    const name = String(body.name || '').trim();if (!name) throw err('Give the checklist a name.');
    if (await q1('SELECT id FROM checklists WHERE name = ?', name)) throw err('There’s already a checklist with that name.');
    const key = newKey();
    await tx(async () => {
      const src0 = body.copy_from ? await libKey(body.copy_from) : null;
      const area = src0 ? src0.area || 'conv' : body.area === 'tax' ? 'tax' : 'conv';
      await run('INSERT INTO checklists (key, name, position, area) VALUES (?,?,?,?)', key, name, ((await q1('SELECT MAX(position) AS p FROM checklists')).p || 0) + 1, area);
      if (body.copy_from) {
        const src = src0;
        for (const s of await qa('SELECT * FROM checklist_stages WHERE checklist_key = ? ORDER BY position, id', src.key))
        await run('INSERT INTO checklist_stages (checklist_key, key, label, from_kind, days, when_text, position) VALUES (?,?,?,?,?,?,?)', key, s.key, s.label, s.from_kind, s.days, s.when_text, s.position);
        await copyTemplates(db, src.key, key);
      }
    });
    return { key };
  });
  on('PUT', '/api/library/:key', async ({ me, body, params }) => {
    adminOnly(me);
    const c = await libKey(params.key);
    if (body.name != null) {const n = String(body.name).trim();if (!n) throw err('Give the checklist a name.');await run('UPDATE checklists SET name = ? WHERE id = ?', n, c.id);}
    return { ok: true };
  });
  on('DELETE', '/api/library/:key', async ({ me, params }) => {
    adminOnly(me);
    const c = await libKey(params.key);
    await tx(async () => {
      await run('DELETE FROM checklist_templates WHERE checklist_key = ?', c.key);
      await run('DELETE FROM checklist_stages WHERE checklist_key = ?', c.key);
      await run('DELETE FROM checklists WHERE id = ?', c.id);
      const types = await typeChecklists();
      for (const k of Object.keys(types)) if (types[k] === c.key) types[k] = '';
      await setSetting('type_checklists', JSON.stringify(types));
    });
    return { ok: true };
  });
  on('PUT', '/api/library-types', async ({ me, body }) => {
    adminOnly(me);
    const types = await typeChecklists();
    for (const t of W.MATTER_TYPES) if (body[t.key] !== undefined) {
      const v = String(body[t.key] || '');
      if (v && !(await q1('SELECT id FROM checklists WHERE key = ?', v))) throw err('That checklist no longer exists.');
      types[t.key] = v;
    }
    await setSetting('type_checklists', JSON.stringify(types));
    return types;
  });
  const stageFields = (b) => {
    const out = {};
    if (b.label != null) {const v = String(b.label).trim();if (!v) throw err('Give the stage a name.');out.label = v;}
    if (b.from != null) {if (!W.STAGE_FROM.some((f) => f.key === b.from)) throw err('Choose when the stage is counted from.');out.from_kind = b.from;}
    if (b.days != null) out.days = parseInt(b.days, 10) || 0;
    if (b.when != null) out.when_text = String(b.when).trim().slice(0, 120);
    return out;
  };
  on('POST', '/api/library/:key/stages', async ({ me, body, params }) => {
    adminOnly(me);
    const c = await libKey(params.key);
    const f = { from_kind: 'opened', days: 0, when_text: '', ...stageFields(body) };
    if (!f.label) throw err('Give the stage a name.');
    await run('INSERT INTO checklist_stages (checklist_key, key, label, from_kind, days, when_text, position) VALUES (?,?,?,?,?,?,?)', c.key, 'st' + platform.randomToken().slice(0, 8), f.label, f.from_kind, f.days, f.when_text,
    ((await q1('SELECT MAX(position) AS p FROM checklist_stages WHERE checklist_key = ?', c.key)).p || 0) + 1);
    return { ok: true };
  });
  on('PUT', '/api/library-stages/:id', async ({ me, body, params }) => {
    adminOnly(me);
    const st = await q1('SELECT * FROM checklist_stages WHERE id = ?', +params.id);if (!st) throw err('That stage no longer exists.', 404);
    const f = stageFields(body);
    const keys = Object.keys(f);
    if (keys.length) await run(`UPDATE checklist_stages SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), st.id);
    if (body.move) {
      const sibs = await qa('SELECT * FROM checklist_stages WHERE checklist_key = ? ORDER BY position, id', st.checklist_key);
      const i = sibs.findIndex((s) => s.id === st.id),j = i + (body.move < 0 ? -1 : 1);
      if (j >= 0 && j < sibs.length) {[sibs[i], sibs[j]] = [sibs[j], sibs[i]];await forEachAsync(sibs, async (s, k) => await run('UPDATE checklist_stages SET position = ? WHERE id = ?', k, s.id));}
    }
    return { ok: true };
  });
  on('DELETE', '/api/library-stages/:id', async ({ me, params }) => {
    adminOnly(me);
    const st = await q1('SELECT * FROM checklist_stages WHERE id = ?', +params.id);if (!st) throw err('That stage no longer exists.', 404);
    await tx(async () => {await run('DELETE FROM checklist_templates WHERE checklist_key = ? AND stage = ?', st.checklist_key, st.key);await run('DELETE FROM checklist_stages WHERE id = ?', st.id);});
    return { ok: true };
  });
  on('POST', '/api/library/:key/reset', async ({ me, params }) => {
    adminOnly(me);
    const c = await libKey(params.key);
    const side = c.key === 'BC-V' ? 'V' : c.key === 'BC-P' ? 'P' : null;
    if (!side) throw err('Only BC - P and BC - V can be reset to the Raikan defaults.');
    await tx(async () => {
      await run('DELETE FROM checklist_templates WHERE checklist_key = ?', c.key);
      await run('DELETE FROM checklist_stages WHERE checklist_key = ?', c.key);
      for (const st of defaultStages(side)) await run('INSERT INTO checklist_stages (checklist_key, key, label, from_kind, days, when_text, position) VALUES (?,?,?,?,?,?,?)', c.key, st.key, st.label, st.from_kind, st.days, st.when_text, st.position);
      await seedChecklists(db, side);
    });
    return { ok: true };
  });
  on('GET', '/api/checklist-templates', async ({ me, query }) => (await checklistIsTax(query.checklist)) && !canTax(me) ? [] : await qa('SELECT * FROM checklist_templates WHERE checklist_key = ? ORDER BY position, id', String(query.checklist || 'BC-P')));
  on('POST', '/api/checklist-templates', async ({ me, body }) => {
    adminOnly(me);
    const c = await libKey(body.checklist_key);
    if (!(await q1('SELECT id FROM checklist_stages WHERE checklist_key = ? AND key = ?', c.key, String(body.stage || '')))) throw err('Choose a stage.');
    const title = String(body.title || '').trim();if (!title) throw err('Enter the item.');
    const parent = body.parent_id ? +body.parent_id : null;
    const pos = ((await q1('SELECT MAX(position) AS p FROM checklist_templates WHERE checklist_key = ? AND stage = ? AND parent_id IS NOT DISTINCT FROM ?', c.key, body.stage, parent)).p || 0) + 1;
    await run('INSERT INTO checklist_templates (side, checklist_key, stage, parent_id, title, position) VALUES (?,?,?,?,?,?)', c.area === 'tax' ? 'T' : c.key === 'BC-V' ? 'V' : 'P', c.key, body.stage, parent, title, pos);
    return { ok: true };
  });
  on('PUT', '/api/checklist-templates/:id', async ({ me, body, params }) => {
    adminOnly(me);
    const t = await q1('SELECT * FROM checklist_templates WHERE id = ?', +params.id);if (!t) throw err('Item not found.', 404);
    if (body.title != null && String(body.title).trim()) await run('UPDATE checklist_templates SET title = ? WHERE id = ?', String(body.title).trim(), t.id);
    let added = 0,updated = 0;
    if (body.ms !== undefined) {
      // milestone settings: saved on the library item and copied to the matters that already have this item
      const v = body.ms ? JSON.stringify(W.cleanMs(typeof body.ms === 'object' ? body.ms : { label: t.title })) : null;
      await tx(async () => {
        await run('UPDATE checklist_templates SET ms = ? WHERE id = ?', v, t.id);
        updated = (await run('UPDATE matter_items SET ms = ? WHERE tpl_id = ?', v, t.id)).changes || 0;
        if (v && body.add_to_open) {
          // add it to open matters that use this checklist but don't have the item yet
          const mids = (await qa(`SELECT DISTINCT i.matter_id AS id FROM matter_items i JOIN matters m ON m.id = i.matter_id WHERE m.status = 'active' AND i.tpl_id IN (SELECT id FROM checklist_templates WHERE checklist_key = ?)`, t.checklist_key)).map((r) => r.id);
          for (const mid of mids) {
            if (await q1('SELECT id FROM matter_items WHERE matter_id = ? AND tpl_id = ?', mid, t.id)) continue;
            let parentId = null;
            if (t.parent_id) {const pi = await q1('SELECT id FROM matter_items WHERE matter_id = ? AND tpl_id = ?', mid, t.parent_id);if (!pi) continue;parentId = pi.id;}
            const same = await q1('SELECT id FROM matter_items WHERE matter_id = ? AND stage = ? AND parent_id IS NOT DISTINCT FROM ? AND lower(trim(title)) = lower(trim(?))', mid, t.stage, parentId, t.title);
            if (same) {await run('UPDATE matter_items SET tpl_id = ?, ms = ? WHERE id = ?', t.id, v, same.id);updated++;continue;}
            const pos = ((await q1('SELECT MAX(position) AS p FROM matter_items WHERE matter_id = ? AND stage = ? AND parent_id IS NOT DISTINCT FROM ?', mid, t.stage, parentId)).p || 0) + 1;
            await run('INSERT INTO matter_items (matter_id, stage, parent_id, title, position, updated_by, updated_at, tpl_id, ms) VALUES (?,?,?,?,?,?,?,?,?)', mid, t.stage, parentId, t.title, pos, me.id, now(), t.id, v);
            await log({ matterId: mid, userId: me.id, action: `added the milestone “${t.title}” from the checklist library` });
            added++;
          }
        }
      });
    }
    if (body.move) {
      const sibs = await qa('SELECT * FROM checklist_templates WHERE checklist_key = ? AND stage = ? AND parent_id IS NOT DISTINCT FROM ? ORDER BY position, id', t.checklist_key, t.stage, t.parent_id);
      const i = sibs.findIndex((s) => s.id === t.id),j = i + (body.move < 0 ? -1 : 1);
      if (j >= 0 && j < sibs.length) {[sibs[i], sibs[j]] = [sibs[j], sibs[i]];await forEachAsync(sibs, async (s, k) => await run('UPDATE checklist_templates SET position = ? WHERE id = ?', k, s.id));}
    }
    return { ok: true, added, updated };
  });
  on('DELETE', '/api/checklist-templates/:id', async ({ me, params }) => {
    adminOnly(me);
    await tx(async () => {await run('DELETE FROM checklist_templates WHERE parent_id = ?', +params.id);await run('DELETE FROM checklist_templates WHERE id = ?', +params.id);});
    return { ok: true };
  });

  // call-backs: missed calls someone needs to return
  const CB_RESULTS = ['No answer', 'Left voicemail', 'Busy / call back later', 'Wrong number', 'Spoke – resolved', 'Spoke – follow-up needed'];
  const cbSelect = `SELECT c.*, m.code AS matter_code, m.type AS matter_type, m.client AS matter_client,
      (SELECT COUNT(*) FROM callback_log l WHERE l.callback_id = c.id) AS log_count
    FROM callbacks c LEFT JOIN matters m ON m.id = c.matter_id`;
  const cbLabel = (c) => `${c.caller_name}${c.phone ? ' (' + c.phone + ')' : ''}`;
  const cbLog = async (id, userId, kind, text) => await run('INSERT INTO callback_log (callback_id, user_id, kind, text, created_at) VALUES (?,?,?,?,?)', id, userId, kind, text || '', now());
  const touchCb = async (id) => await run('UPDATE callbacks SET updated_at = ? WHERE id = ?', now(), id);
  async function cbFull(id) {
    const c = await q1(`${cbSelect} WHERE c.id = ?`, id);
    if (!c) return null;
    c.log = await qa('SELECT * FROM callback_log WHERE callback_id = ? ORDER BY id', id);
    return c;
  }
  function cbFields(b) {
    const out = {};
    for (const k of ['caller_name', 'phone', 'email', 'company', 'message']) if (b[k] != null) out[k] = String(b[k]).trim().slice(0, k === 'message' ? 4000 : 200);
    for (const k of ['matter_id', 'for_user_id', 'assignee_id']) if (b[k] !== undefined) out[k] = b[k] ? +b[k] : null;
    if (b.priority != null) out.priority = b.priority === 'urgent' ? 'urgent' : 'normal';
    if (b.due_at !== undefined) {const v = validDT(b.due_at);if (v === undefined) throw err('The call-back time isn’t valid.');out.due_at = v;}
    return out;
  }
  on('GET', '/api/callbacks', async ({ me, query: q }) => {
    const where = [],p = [];
    if (!canTax(me)) where.push(`(c.matter_id IS NULL OR m.type IS NULL OR m.type NOT IN ${TAX_IN})`);
    const scope = q.scope || 'mine';
    if (scope === 'done') {where.push("c.status <> 'open'");} else
    {
      where.push("c.status = 'open'");
      if (scope === 'mine') {where.push('c.assignee_id = ?');p.push(me.id);}
      if (scope === 'forme') {where.push('c.for_user_id = ?');p.push(me.id);}
    }
    if (q.matter) {where.push('c.matter_id = ?');p.push(+q.matter);}
    if (q.q) {where.push('(c.caller_name ILIKE ? OR c.phone ILIKE ? OR c.company ILIKE ? OR c.message ILIKE ? OR m.code ILIKE ?)');const l = `%${q.q}%`;p.push(l, l, l, l, l);}
    const order = scope === 'done' ? 'c.completed_at DESC LIMIT 200' : "(c.priority = 'urgent') DESC, (c.due_at IS NULL) DESC, c.due_at, c.id";
    return await qa(`${cbSelect} WHERE ${where.join(' AND ')} ORDER BY ${order}`, ...p);
  });
  on('GET', '/api/callbacks/:id', async ({ params }) => {const c = await cbFull(+params.id);if (!c) throw err('That call-back no longer exists.', 404);return c;});
  on('GET', '/api/callers', async ({ query }) => {
    const s = String(query.q || '').trim();if (s.length < 2) return [];
    const l = `%${s}%`;
    return await qa(`SELECT * FROM (SELECT DISTINCT ON (caller_name, phone) caller_name, phone, email, company, matter_id, created_at AS last FROM callbacks WHERE caller_name ILIKE ? OR phone ILIKE ? ORDER BY caller_name, phone, created_at DESC, id ASC) recent ORDER BY last DESC LIMIT 8`, l, l);
  });
  on('POST', '/api/callbacks', async ({ me, body }) => {
    const f = cbFields(body);
    if (!f.caller_name) throw err('Enter who called.');
    if (!f.phone && !f.email) throw err('Enter a phone number (or email) to call back.');
    if (f.matter_id && !(await q1('SELECT id FROM matters WHERE id = ?', f.matter_id))) throw err('That matter doesn’t exist.');
    f.assignee_id = f.assignee_id || me.id;
    f.for_user_id = f.for_user_id || me.id;
    await taxPersonCheck(f.assignee_id, f.matter_id);
    if (f.due_at === undefined) f.due_at = nowMin();
    const keys = Object.keys(f);
    const r = await run(`INSERT INTO callbacks (${keys.join(',')}, created_by, created_at, updated_at) VALUES (${keys.map(() => '?').join(',')}, ?, ?, ?)`, ...keys.map((k) => f[k]), me.id, now(), now());
    const id = Number(r.lastInsertRowid);
    const forU = await userById(f.for_user_id);
    await cbLog(id, me.id, 'created', `Took the message${forU && forU.id !== me.id ? ' for ' + forU.name : ''}`);
    const c = await q1('SELECT * FROM callbacks WHERE id = ?', id);
    const text = `${c.priority === 'urgent' ? 'URGENT ' : ''}Call back ${cbLabel(c)}${f.message ? ' – ' + f.message.slice(0, 120) : ''} (by ${fmtDue(c.due_at)})`;
    await notify(c.assignee_id, me.id, null, 'callback', text, `${c.priority === 'urgent' ? 'URGENT: ' : ''}Call back ${cbLabel(c)}`, c.matter_id, id);
    if (c.for_user_id !== c.assignee_id && c.for_user_id !== me.id) await notify(c.for_user_id, me.id, null, 'callback', `${me.name} took a call for you from ${cbLabel(c)} – ${((await userById(c.assignee_id)) || {}).name || 'someone'} will call back`, null, c.matter_id, id);
    return await cbFull(id);
  });
  on('PUT', '/api/callbacks/:id', async ({ me, body, params }) => {
    const c = await q1('SELECT * FROM callbacks WHERE id = ?', +params.id);if (!c) throw err('That call-back no longer exists.', 404);
    const f = cbFields(body);
    const keys = Object.keys(f).filter((k) => f[k] !== c[k]);
    if (!keys.length) return await cbFull(c.id);
    await taxPersonCheck(f.assignee_id !== undefined ? f.assignee_id : c.assignee_id, f.matter_id !== undefined ? f.matter_id : c.matter_id);
    await run(`UPDATE callbacks SET ${keys.map((k) => k + ' = ?').join(', ')}${keys.includes('due_at') ? ', overdue_notified = 0' : ''}, updated_at = ? WHERE id = ?`, ...keys.map((k) => f[k]), now(), c.id);
    if (keys.includes('assignee_id')) {
      const u = await userById(f.assignee_id);
      await cbLog(c.id, me.id, 'assigned', `Passed to ${u ? u.name : 'nobody'}`);
      const cc = await q1('SELECT * FROM callbacks WHERE id = ?', c.id);
      await notify(f.assignee_id, me.id, null, 'callback', `${me.name} passed you a call-back: ${cbLabel(cc)}${cc.message ? ' – ' + cc.message.slice(0, 120) : ''}`, `Call back ${cbLabel(cc)}`, cc.matter_id, c.id);
    }
    if (keys.includes('due_at')) await cbLog(c.id, me.id, 'rescheduled', `Call back ${fmtDue(f.due_at)}`);
    if (keys.some((k) => !['assignee_id', 'due_at'].includes(k))) await cbLog(c.id, me.id, 'edited', 'Updated the details');
    return await cbFull(c.id);
  });
  async function cbFinish(c, me, outcome, kind) {
    await run("UPDATE callbacks SET status = 'done', outcome = ?, completed_at = ?, completed_by = ?, updated_at = ? WHERE id = ?", outcome, now(), me.id, now(), c.id);
    const text = `${me.name} called back ${cbLabel(c)}: ${outcome}`;
    await forEachAsync([c.for_user_id, c.created_by].filter((v, i, a) => v && a.indexOf(v) === i), async (uid) => await notify(uid, me.id, null, 'callback_done', text, null, c.matter_id, c.id));
    if (c.matter_id) await log({ matterId: c.matter_id, userId: me.id, action: `called back ${c.caller_name}: ${outcome}` });
  }
  on('POST', '/api/callbacks/:id/attempt', async ({ me, body, params }) => {
    const c = await q1('SELECT * FROM callbacks WHERE id = ?', +params.id);if (!c) throw err('That call-back no longer exists.', 404);
    if (c.status !== 'open') throw err('This call-back is already closed.');
    const result = String(body.result || '');
    if (!CB_RESULTS.includes(result)) throw err('Choose what happened on the call.');
    const note = String(body.note || '').trim().slice(0, 2000);
    await run('UPDATE callbacks SET attempts = attempts + 1, updated_at = ? WHERE id = ?', now(), c.id);
    await cbLog(c.id, me.id, 'attempt', result + (note ? ' – ' + note : ''));
    let task = null;
    if (result.startsWith('Spoke')) {
      await cbFinish(c, me, note ? `${result} – ${note}` : result);
      if (result === 'Spoke – follow-up needed' && body.task_title) {
        task = await createTask(me, { title: String(body.task_title), description: `From a call with ${cbLabel(c)}.${note ? '\n' + note : ''}`, matter_id: c.matter_id, assignee_id: body.task_assignee_id || me.id, due_date: body.task_due || null, priority: c.priority === 'urgent' ? 'high' : 'normal' });
        await run('UPDATE callbacks SET task_id = ? WHERE id = ?', task.id, c.id);
        await cbLog(c.id, me.id, 'task', `Created task “${task.title}”`);
      }
    } else if (result === 'Wrong number') {
      await cbFinish(c, me, note ? `Wrong number – ${note}` : 'Wrong number');
    } else {
      const next = validDT(body.next_due_at) || addMinutes(parseInt(body.retry_minutes, 10) || 60);
      await run('UPDATE callbacks SET due_at = ?, overdue_notified = 0 WHERE id = ?', next, c.id);
      await cbLog(c.id, me.id, 'rescheduled', `Try again ${fmtDue(next)}`);
    }
    await touchCb(c.id);
    return { callback: await cbFull(c.id), task };
  });
  on('POST', '/api/callbacks/:id/done', async ({ me, body, params }) => {
    const c = await q1('SELECT * FROM callbacks WHERE id = ?', +params.id);if (!c) throw err('That call-back no longer exists.', 404);
    if (c.status !== 'open') return await cbFull(c.id);
    const outcome = String(body.outcome || '').trim() || 'Marked done';
    await cbLog(c.id, me.id, 'done', outcome);
    await cbFinish(c, me, outcome);
    return await cbFull(c.id);
  });
  on('POST', '/api/callbacks/:id/reopen', async ({ me, params }) => {
    const c = await q1('SELECT * FROM callbacks WHERE id = ?', +params.id);if (!c) throw err('That call-back no longer exists.', 404);
    await run("UPDATE callbacks SET status = 'open', completed_at = NULL, completed_by = NULL, due_at = ?, overdue_notified = 0, updated_at = ? WHERE id = ?", nowMin(), now(), c.id);
    await cbLog(c.id, me.id, 'reopened', 'Reopened');
    return await cbFull(c.id);
  });
  on('POST', '/api/callbacks/:id/note', async ({ me, body, params }) => {
    const c = await q1('SELECT * FROM callbacks WHERE id = ?', +params.id);if (!c) throw err('That call-back no longer exists.', 404);
    const text = String(body.text || '').trim();if (!text) throw err('Write a note first.');
    await cbLog(c.id, me.id, 'note', text.slice(0, 2000));await touchCb(c.id);
    return await cbFull(c.id);
  });
  on('DELETE', '/api/callbacks/:id', async ({ me, params }) => {
    const c = await q1('SELECT * FROM callbacks WHERE id = ?', +params.id);if (!c) throw err('That call-back no longer exists.', 404);
    if (me.role !== 'admin' && c.created_by !== me.id) throw err('Only the person who logged this call, or an admin, can delete it.', 403);
    await run('DELETE FROM callbacks WHERE id = ?', c.id);
    return { ok: true };
  });

  // notifications, poll, search
  on('GET', '/api/notifications', async ({ me }) => await qa(`SELECT n.* FROM notifications n LEFT JOIN tasks t ON t.id = n.task_id LEFT JOIN matters m ON m.id = COALESCE(n.matter_id, t.matter_id)
    WHERE n.user_id = ? ${canTax(me) ? '' : `AND (m.type IS NULL OR m.type NOT IN ${TAX_IN})`} ORDER BY n.id DESC LIMIT 50`, me.id));
  on('POST', '/api/notifications/read', async ({ me, body }) => {
    if (Array.isArray(body.ids) && body.ids.length) await forEachAsync(body.ids, async (id) => await run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', +id, me.id));else
    await run('UPDATE notifications SET read = 1 WHERE user_id = ?', me.id);
    return { ok: true };
  });
  on('GET', '/api/poll', async ({ me }) => {
    if (platform.runJobsOnPoll) await runJobs();
    // xmin changes on every committed update, including edits within the same
    // second. Return only hashes, never row contents or transaction identifiers.
    const stamp = (table, key = 'id', where = '') => `(SELECT md5(COALESCE(string_agg(${key}::text || ':' || xmin::text, ',' ORDER BY ${key}), '')) FROM ${table}${where})`;
    const r = await q1(`SELECT
      (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = 0) AS unread,
      ${stamp('tasks')} AS _tasks,
      ${stamp('matters')} AS _matter_refs,
      ${stamp('matter_items')} || ${stamp('matter_stages')} AS _items,
      ${stamp('callbacks')} || ${stamp('callback_log')} AS _callbacks,
      ${stamp('leave')} || ${stamp('holidays')} AS _people,
      ${stamp('users')} AS _users,
      ${stamp('time_entries')} || ${stamp('work_logs')} AS _time,
      ${stamp('checklists')} || ${stamp('checklist_stages')} || ${stamp('checklist_templates')} AS _library,
      ${stamp('settings', 'key', " WHERE key NOT IN ('scheduler_last_run','last_backup')")} AS _settings,
      COUNT(*) AS callbacks_open,
      COALESCE(SUM(CASE WHEN due_at IS NULL OR due_at <= ? THEN 1 ELSE 0 END),0) AS callbacks_due
      FROM callbacks WHERE status = 'open' AND assignee_id = ?`, me.id, nowMin(), me.id);
    r.versions = { tasks:r._tasks, matterRefs:r._matter_refs, matters:r._matter_refs + r._items, callbacks:r._callbacks, people:r._people, users:r._users, time:r._time, library:r._library, settings:r._settings };
    r.version = Object.values(r.versions).join('|'); // Opaque fallback for older browser tabs.
    for (const key of Object.keys(r)) if (key.startsWith('_')) delete r[key];
    return r;
  });
  on('GET', '/api/search', async ({ me, query }) => {
    const s = String(query.q || '').trim();if (!s) return { tasks: [], matters: [] };
    const l = `%${s}%`;
    const hideM = canTax(me) ? '' : ` AND type NOT IN ${TAX_IN}`,hideT = canTax(me) ? '' : ` AND (m.type IS NULL OR m.type NOT IN ${TAX_IN})`;
    return {
      matters: (await qa(`SELECT id, code, type, address, client, status, settlement_date FROM matters WHERE (code ILIKE ? OR address ILIKE ? OR client ILIKE ?)${hideM} ORDER BY code, type LIMIT 12`, l, l, l)).map((m) => ({ ...m, name: matterName(m) })),
      tasks: await qa(`${TASK_SELECT} WHERE (t.title ILIKE ? OR t.description ILIKE ? OR m.code ILIKE ? OR m.client ILIKE ?)${hideT} ORDER BY (t.status = 'done'), t.due_date LIMIT 20`, l, l, l, l)
    };
  });

  /* ---------- public holidays ---------- */
  on('GET', '/api/holidays', async ({ query: q }) => {
    const where = [],p = [];
    if (q.from) {where.push('date >= ?');p.push(q.from);}
    if (q.to) {where.push('date <= ?');p.push(q.to);}
    return await qa(`SELECT * FROM holidays ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date, id`, ...p);
  });
  on('POST', '/api/holidays', async ({ me, body }) => {
    adminOnly(me);
    const date = validDate(body.date);if (!date) throw err('Choose the date.');
    const name = String(body.name || '').trim().slice(0, 80);if (!name) throw err('Give the holiday a name.');
    const part = body.part_from ? /^\d{2}:\d{2}$/.test(String(body.part_from)) ? String(body.part_from) : undefined : null;
    if (part === undefined) throw err('The part-day start time isn’t valid.');
    await run("INSERT INTO holidays (date, name, part_from, source, created_at) VALUES (?,?,?, 'admin', ?)", date, name, part, now());
    return { ok: true };
  });
  on('DELETE', '/api/holidays/:id', async ({ me, params }) => {adminOnly(me);await run('DELETE FROM holidays WHERE id = ?', +params.id);return { ok: true };});

  /* ---------- leave: who isn't working when ---------- */
  const LEAVE_PARTS = ['', 'am', 'pm'];
  // everyone sees who is away; the kind of leave and the note are only shown to the person and admins
  const pubLeave = (l, me) => me.role === 'admin' || l.user_id === me.id ? l : { ...l, kind: 'Leave', note: '' };
  async function leaveOn(userId, date) {return userId && date ? await q1('SELECT * FROM leave WHERE user_id = ? AND start_date <= ? AND end_date >= ? ORDER BY id LIMIT 1', userId, date, date) : null;}
  async function leaveWarning(userId, date) {
    const l = await leaveOn(userId, date);if (!l) return null;
    const u = await userById(userId);
    return `${u ? u.name : 'They'} ${l.part ? `is away (${l.part === 'am' ? 'morning' : 'afternoon'})` : 'is on leave'} on ${fmtDate(date)}.`;
  }
  on('GET', '/api/leave', async ({ me, query: q }) => {
    const from = validDate(q.from) || addDays(today(), -31),to = validDate(q.to) || addDays(today(), 400);
    return (await qa('SELECT * FROM leave WHERE end_date >= ? AND start_date <= ? ORDER BY start_date, user_id', from, to)).map((l) => pubLeave(l, me));
  });
  async function leaveFields(b, me, cur) {
    const out = {};
    if (b.user_id !== undefined) {const uid = +b.user_id || me.id;if (uid !== me.id && me.role !== 'admin') throw err('Only an admin can mark leave for someone else.', 403);if (!(await userById(uid))) throw err('That person doesn’t exist.');out.user_id = uid;}
    for (const k of ['start_date', 'end_date']) if (b[k] !== undefined) {const v = validDate(b[k]);if (!v) throw err('Choose the leave dates.');out[k] = v;}
    const s0 = out.start_date || cur && cur.start_date,e0 = out.end_date || cur && cur.end_date || s0;
    if (!out.end_date && !(cur && cur.end_date)) out.end_date = e0;
    if (s0 && e0 && e0 < s0) throw err('The last day of leave is before the first day.');
    if (s0 && e0 && daysBetween(s0, e0) > 366) throw err('Leave can be marked up to a year at a time.');
    if (b.kind !== undefined) out.kind = W.LEAVE_KINDS.includes(b.kind) ? b.kind : 'Other';
    if (b.part !== undefined) {if (!LEAVE_PARTS.includes(b.part || '')) throw err('Choose all day, morning or afternoon.');out.part = b.part || '';}
    if (b.note !== undefined) out.note = String(b.note || '').slice(0, 300);
    if ((out.part || cur && cur.part) && (out.start_date || cur && cur.start_date) !== (out.end_date || cur && cur.end_date)) out.part = '';
    return out;
  }
  on('POST', '/api/leave', async ({ me, body }) => {
    const f = { user_id: me.id, kind: 'Annual leave', part: '', note: '', ...(await leaveFields({ user_id: me.id, ...body }, me)) };
    if (!f.start_date) throw err('Choose the leave dates.');
    const r = await run('INSERT INTO leave (user_id, start_date, end_date, kind, part, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', f.user_id, f.start_date, f.end_date, f.kind, f.part, f.note, me.id, now());
    const u = await userById(f.user_id);
    const when = f.start_date === f.end_date ? fmtDate(f.start_date) + (f.part ? ` (${f.part === 'am' ? 'morning' : 'afternoon'})` : '') : `${fmtDate(f.start_date)} – ${fmtDate(f.end_date)}`;
    const msg = u.id === me.id ? `${me.name} marked leave: ${when} – ${f.kind}` : `${me.name} marked leave for ${u.name}: ${when} – ${f.kind}`;
    for (const a of await qa("SELECT id FROM users WHERE role = 'admin' AND active = 1")) if (a.id !== u.id) await notify(a.id, me.id, null, 'leave', msg, null);
    if (u.id !== me.id) await notify(u.id, me.id, null, 'leave', `${me.name} marked leave for you: ${when}`, null);
    // tasks already due while they're away
    const clash = (await qa("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status <> 'done' AND due_date BETWEEN ? AND ?", f.user_id, f.start_date, f.end_date))[0].n;
    return { id: Number(r.lastInsertRowid), clash };
  });
  on('PUT', '/api/leave/:id', async ({ me, body, params }) => {
    const l = await q1('SELECT * FROM leave WHERE id = ?', +params.id);if (!l) throw err('That leave no longer exists.', 404);
    if (l.user_id !== me.id && me.role !== 'admin') throw err('Only the person, or an admin, can change this leave.', 403);
    const f = await leaveFields(body, me, l);delete f.user_id;
    const keys = Object.keys(f);if (keys.length) await run(`UPDATE leave SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), l.id);
    return { ok: true };
  });
  on('DELETE', '/api/leave/:id', async ({ me, params }) => {
    const l = await q1('SELECT * FROM leave WHERE id = ?', +params.id);if (!l) return { ok: true };
    if (l.user_id !== me.id && me.role !== 'admin') throw err('Only the person, or an admin, can remove this leave.', 403);
    await run('DELETE FROM leave WHERE id = ?', l.id);return { ok: true };
  });

  /* ---------- clock in / out and work check-ins ---------- */
  const toDate = (s) => {const [d, t = '00:00:00'] = String(s).split(' ');const [y, m, dd] = d.split('-').map(Number);const [h, mi, se] = t.split(':').map(Number);return new Date(y, m - 1, dd, h || 0, mi || 0, se || 0);};
  const minsBetween = (a, b) => Math.max(0, Math.round((toDate(b) - toDate(a)) / 60000));
  const openEntry = async (uid) => await q1('SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1', uid);
  const checkinMinutes = async () => {const v = parseInt(await getSetting('checkin_minutes', '60'), 10);return W.CHECKIN_CHOICES.includes(v) ? v : 60;};
  async function lastLogAt(uid, e) {const l = e ? await q1('SELECT at FROM work_logs WHERE user_id = ? AND at >= ? ORDER BY at DESC LIMIT 1', uid, e.clock_in) : null;return l ? l.at : e ? e.clock_in : null;}
  // what someone has touched since their last check-in, offered as one-click answers
  async function touchedSince(me, since) {
    if (!since) return [];
    const hide = canTax(me) ? '' : ` AND (m.type IS NULL OR m.type NOT IN ${TAX_IN})`;
    const tasks = (await qa(`SELECT t.id, t.title, t.status, m.code, m.type, MAX(a.created_at) AS at FROM activity a JOIN tasks t ON t.id = a.task_id LEFT JOIN matters m ON m.id = t.matter_id
      WHERE a.user_id = ? AND a.created_at >= ?${hide} GROUP BY t.id, m.code, m.type ORDER BY at DESC LIMIT 12`, me.id, since)).
    map((t) => ({ task_id: t.id, label: `${t.code ? t.code + ' ' + ((W.TYPE[t.type] || {}).short || '') + ' – ' : ''}${t.title}${t.status === 'done' ? ' (done)' : ''}` }));
    const matters = (await qa(`SELECT m.id, m.code, m.type, m.client, COUNT(*) AS n, MAX(a.created_at) AS at FROM activity a JOIN matters m ON m.id = a.matter_id WHERE a.user_id = ? AND a.created_at >= ? AND a.task_id IS NULL${hide} GROUP BY m.id ORDER BY at DESC LIMIT 8`, me.id, since)).
    map((m) => ({ label: `${m.code} ${(W.TYPE[m.type] || {}).short || ''} ${m.client || ''} – checklist updates (${m.n})`.replace(/\s+/g, ' ') }));
    const calls = (await qa(`SELECT caller_name, kind, at FROM (SELECT DISTINCT ON (c.id) c.caller_name, l.kind, l.created_at AS at FROM callback_log l JOIN callbacks c ON c.id = l.callback_id WHERE l.user_id = ? AND l.created_at >= ? AND l.kind IN ('attempt','done') ORDER BY c.id, l.created_at DESC, l.id ASC) recent ORDER BY at DESC LIMIT 6`, me.id, since)).
    map((c) => ({ label: `Called back ${c.caller_name}` }));
    return [...tasks, ...matters, ...calls];
  }
  async function timeStatus(me) {
    const e = await openEntry(me.id);
    const since = await lastLogAt(me.id, e);
    const dayStart = today() + ' 00:00:00';
    const todayMin = (await qa('SELECT clock_in, clock_out FROM time_entries WHERE user_id = ? AND (clock_out IS NULL OR clock_out >= ?) AND clock_in <= ?', me.id, dayStart, now())).
    reduce((n, r) => n + minsBetween(r.clock_in < dayStart ? dayStart : r.clock_in, r.clock_out || now()), 0);
    return { open: e || null, since, interval: await checkinMinutes(), stale: !!(e && e.clock_in.slice(0, 10) < today()), touched: e ? await touchedSince(me, since) : [], today_minutes: todayMin, now: now() };
  }
  on('GET', '/api/time/status', async ({ me }) => await timeStatus(me));
  on('GET', '/api/time/who', async () => await qa('SELECT user_id, clock_in FROM time_entries WHERE clock_out IS NULL ORDER BY clock_in'));
  on('POST', '/api/time/clock-in', async ({ me }) => {
    const e = await openEntry(me.id);
    if (e) {if (e.clock_in.slice(0, 10) < today()) throw err('You’re still clocked in from ' + fmtDate(e.clock_in.slice(0, 10)) + '. Clock out of that day first.');return await timeStatus(me);}
    await run('INSERT INTO time_entries (user_id, clock_in, created_at) VALUES (?,?,?)', me.id, now(), now());
    return await timeStatus(me);
  });
  const validAt = (v) => {const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/.exec(String(v || ''));return m ? `${m[1]} ${m[2]}:00` : null;};
  async function addLog(me, e, text, taskIds, kind, at) {
    const t = String(text || '').trim().slice(0, 4000);
    if (!t) return;
    const ids = (Array.isArray(taskIds) ? taskIds : []).map(Number).filter(Boolean).slice(0, 30).join(',');
    await run('INSERT INTO work_logs (user_id, entry_id, at, since, text, task_ids, kind, created_at) VALUES (?,?,?,?,?,?,?,?)', me.id, e ? e.id : null, at || now(), await lastLogAt(me.id, e), t, ids, kind, now());
  }
  on('POST', '/api/time/log', async ({ me, body }) => {
    if (!String(body.text || '').trim()) throw err('Write a line about what you worked on.');
    await addLog(me, await openEntry(me.id), body.text, body.task_ids, 'checkin');
    return await timeStatus(me);
  });
  on('POST', '/api/time/clock-out', async ({ me, body }) => {
    const e = await openEntry(me.id);if (!e) return await timeStatus(me);
    let at = body.at ? validAt(body.at) : now();
    if (!at) throw err('The finish time isn’t valid.');
    if (at < e.clock_in) throw err('The finish time is before you clocked in.');
    if (at > now()) at = now();
    await addLog(me, e, body.text, body.task_ids, 'clockout', at);
    await run('UPDATE time_entries SET clock_out = ? WHERE id = ?', at, e.id);
    return await timeStatus(me);
  });
  // timesheet: staff see their own; admins see everyone
  on('GET', '/api/time/sheet', async ({ me, query: q }) => {
    const from = validDate(q.from) || addDays(today(), -6),to = validDate(q.to) || today();
    const uid = me.role === 'admin' ? q.user ? +q.user : null : me.id;
    const users = await qa(`SELECT id, name FROM users WHERE ${uid ? 'id = ?' : 'active = 1 OR id IN (SELECT user_id FROM time_entries WHERE clock_in BETWEEN ? AND ?)'} ORDER BY name`, ...(uid ? [uid] : [from + ' 00:00:00', to + ' 23:59:59']));
    const ids = users.map(u => u.id), start = from + ' 00:00:00', end = to + ' 23:59:59';
    const data = await q1(`SELECT
      ${jsonRows('SELECT * FROM time_entries WHERE user_id = ANY(?::bigint[]) AND clock_in BETWEEN ? AND ? ORDER BY clock_in')} AS entries,
      ${jsonRows('SELECT id, user_id, at, since, text, kind, task_ids FROM work_logs WHERE user_id = ANY(?::bigint[]) AND at BETWEEN ? AND ? ORDER BY at')} AS logs,
      ${jsonRows('SELECT * FROM leave WHERE user_id = ANY(?::bigint[]) AND end_date >= ? AND start_date <= ?')} AS leaves,
      ${jsonRows('SELECT * FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date')} AS holidays`, ids, start, end, ids, start, end, ids, from, to, from, to);
    const entryGroups = groupBy(data.entries, 'user_id'), logGroups = groupBy(data.logs, 'user_id'), leaveGroups = groupBy(data.leaves, 'user_id');
    const out = await mapAsync(users, async u => {
      const entries = entryGroups.get(u.id) || [];
      const logs = (logGroups.get(u.id) || []).map(({ user_id, ...row }) => row);
      const leaves = (leaveGroups.get(u.id) || []).map(l => pubLeave(l, me));
      const days = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const es = entries.filter((x) => x.clock_in.slice(0, 10) === d).map((x) => ({ ...x, minutes: minsBetween(x.clock_in, x.clock_out || now()), open: !x.clock_out }));
        const ls = logs.filter((x) => x.at.slice(0, 10) === d);
        const lv = leaves.find((l) => l.start_date <= d && l.end_date >= d) || null;
        if (es.length || ls.length || lv) days.push({ date: d, entries: es, logs: ls, leave: lv, minutes: es.reduce((n, x) => n + x.minutes, 0) });
      }
      return { user_id: u.id, name: u.name, days, minutes: days.reduce((n, x) => n + x.minutes, 0) };
    });
    return { from, to, users: out, holidays: data.holidays };
  });
  function entryFields(b) {
    const o = {};
    if (b.clock_in !== undefined) {o.clock_in = validAt(b.clock_in);if (!o.clock_in) throw err('The start time isn’t valid.');}
    if (b.clock_out !== undefined) {o.clock_out = b.clock_out ? validAt(b.clock_out) : null;if (b.clock_out && !o.clock_out) throw err('The finish time isn’t valid.');}
    if (b.note !== undefined) o.note = String(b.note || '').slice(0, 300);
    return o;
  }
  on('POST', '/api/time/entries', async ({ me, body }) => {
    adminOnly(me);
    const f = entryFields(body);if (!f.clock_in) throw err('Enter the start time.');
    if (f.clock_out && f.clock_out < f.clock_in) throw err('The finish time is before the start time.');
    const uid = +body.user_id;if (!(await userById(uid))) throw err('Choose the person.');
    await run('INSERT INTO time_entries (user_id, clock_in, clock_out, note, edited_by, created_at) VALUES (?,?,?,?,?,?)', uid, f.clock_in, f.clock_out || null, f.note || '', me.id, now());
    return { ok: true };
  });
  on('PUT', '/api/time/entries/:id', async ({ me, body, params }) => {
    adminOnly(me);
    const e = await q1('SELECT * FROM time_entries WHERE id = ?', +params.id);if (!e) throw err('That entry no longer exists.', 404);
    const f = entryFields(body);
    const ci = f.clock_in || e.clock_in,co = f.clock_out !== undefined ? f.clock_out : e.clock_out;
    if (co && co < ci) throw err('The finish time is before the start time.');
    const keys = Object.keys(f);if (keys.length) await run(`UPDATE time_entries SET ${keys.map((k) => k + ' = ?').join(', ')}, edited_by = ? WHERE id = ?`, ...keys.map((k) => f[k]), me.id, e.id);
    return { ok: true };
  });
  on('DELETE', '/api/time/entries/:id', async ({ me, params }) => {adminOnly(me);await run('DELETE FROM time_entries WHERE id = ?', +params.id);return { ok: true };});

  // admin settings
  on('GET', '/api/settings', async ({ me }) => {
    adminOnly(me);
    const out = {};await forEachAsync(SETTING_KEYS, async (k) => out[k] = await getSetting(k, ''));
    out.smtp_pass_set = !!(await getSetting('smtp_pass', ''));
    out.storage_mode = platform.storageMode || 'local';
    out.default_backup_dir = platform.defaultBackupDir ? platform.defaultBackupDir() : '';
    out.last_backup = await getSetting('last_backup', '');
    out.login_mode = (await getSetting('login_mode', 'either')) || 'either';
    out.checkin_minutes = String(await checkinMinutes());
    out.login_mode_active = await loginMode();
    out.login_codes_supported = !!platform.supportsLoginCodes;
    return out;
  });
  on('PUT', '/api/settings', async ({ me, body }) => {
    adminOnly(me);
    if (body.login_mode !== undefined && !LOGIN_MODES.includes(body.login_mode)) throw err('Choose how people sign in.');
    if (body.checkin_minutes !== undefined && !W.CHECKIN_CHOICES.includes(parseInt(body.checkin_minutes, 10))) throw err('Choose how often to ask.');
    await forEachAsync(SETTING_KEYS, async (k) => {if (body[k] !== undefined) await setSetting(k, String(body[k]).trim());});
    if (body.smtp_pass) await setSetting('smtp_pass', body.smtp_pass);
    return { ok: true };
  });
  on('POST', '/api/settings/test-email', async ({ me }) => {
    adminOnly(me);
    if (!(await platform.mailConfigured(getSetting))) throw err(platform.testVersion ? 'Emails can’t be sent from the test version. They will work once TaskForce runs on the office PC.' : 'Enter the SMTP server and sender address first.');
    try {await platform.sendMail(getSetting, { to: me.email, subject: 'Test email', text: 'Email alerts from TaskForce are working.', link: '/' });}
    catch (e) {throw err('The email server refused: ' + e.message);}
    return { ok: true, to: me.email };
  });
  on('POST', '/api/backup', async ({ me }) => {
    adminOnly(me);
    try {const dir = await platform.backup(getSetting, setSetting);return { ok: true, dir };}
    catch (e) {throw err('Backup failed: ' + e.message);}
  });

  /* ---------- dispatcher ---------- */
  async function handle({ method, path, query = {}, body = {}, files = [], token = null, ip = '', origin = '' }) {
    const r = routes.find((x) => x.method === method && x.re.test(path));
    if (!r) return { status: 404, body: { error: 'Not found.' } };
    const params = path.match(r.re).groups || {};
    try {
      let me = null;
      if (!r.open) {
        me = token ? await q1('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at >= ?', token, now()) : null;
        if (!me || !me.active) return { status: 401, body: { error: 'Your session expired. Sign in again.' } };
      }
      if (me) await guardRoute(me, path, params, body || {});
      const out = await r.handler({ me, body: body || {}, query, files, params, token, ip, origin });
      return { status: 200, body: out };
    } catch (e) {
      if (!e.status) console.error(e);
      return { status: e.status || 500, commitOnError: !!e.commitOnError, body: { error: e.status ? e.message : 'Something went wrong. Try again.' } };
    }
  }
  function guessMime(name, given) {
    if (/\.msg$/i.test(name)) return 'application/vnd.ms-outlook';
    if (/\.eml$/i.test(name)) return 'message/rfc822';
    return given || 'application/octet-stream';
  }

  const isReadOnly = (method, path) => (method === 'GET' && !/^\/api\/attachments\/[^/]+\/parts$/.test(path)) || path === '/api/backup';
  return { isReadOnly, handle, runJobs, getSetting, setSetting, routes, ensureLibrary: async () => await ensureLibrary(db), uploadField: (path) => {const r = routes.find((x) => x.method === 'POST' && x.re.test(path));return r && r.upload;} };
}


// Windows helper that lets a click in TaskForce open an email or document straight in Outlook / Word.
// Installs a "taskforce-open:" link handler for the current Windows user (no admin rights needed).
function openerInstaller(origin) {
  const ps1 = String.raw`param([string]$link)
$ErrorActionPreference = 'Stop'
$allowed = '__ORIGIN__'
$okExt = @('.msg','.eml','.pdf','.doc','.docx','.xls','.xlsx','.csv','.txt','.rtf','.jpg','.jpeg','.png','.gif','.ppt','.pptx')
try {
  $b64 = ($link -replace '^taskforce-open:(//)?', '').TrimEnd('/')
  $b64 = $b64.Replace('-', '+').Replace('_', '/')
  switch ($b64.Length % 4) { 2 { $b64 += '==' } 3 { $b64 += '=' } }
  $url = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
  if (-not $url.ToLower().StartsWith($allowed.ToLower() + '/api/open/')) { throw 'This link did not come from your TaskForce.' }
  $name = [Uri]::UnescapeDataString(($url -split '/')[-1]) -replace '[\\/:*?"<>|]', '_'
  $ext = [IO.Path]::GetExtension($name).ToLower()
  if ($okExt -notcontains $ext) { throw ('Files of type ' + $ext + ' must be downloaded instead.') }
  $dir = Join-Path $env:TEMP ('TaskForce\' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $file = Join-Path $dir $name
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $file
  Start-Process -FilePath $file
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(('TaskForce could not open the file.' + [Environment]::NewLine + [Environment]::NewLine + $_.Exception.Message), 'TaskForce') | Out-Null
}
`.replace('__ORIGIN__', String(origin).replace(/'/g, '').replace(/\/$/, ''));
  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(ps1, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(ps1)));
  const lines = [
  '@echo off',
  'echo.',
  'echo   Setting up "Open in Outlook" for TaskForce on this PC...',
  'set "D=%LOCALAPPDATA%\\TaskForce"',
  'if not exist "%D%" mkdir "%D%"',
  `powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText($env:LOCALAPPDATA + '\\TaskForce\\tf-open.ps1', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))"`,
  'reg add "HKCU\\Software\\Classes\\taskforce-open" /ve /d "URL:TaskForce Open" /f >nul',
  'reg add "HKCU\\Software\\Classes\\taskforce-open" /v "URL Protocol" /d "" /f >nul',
  'reg add "HKCU\\Software\\Classes\\taskforce-open\\shell\\open\\command" /ve /d "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \\"%D%\\tf-open.ps1\\" \\"%%1\\"" /f >nul',
  'echo.',
  'echo   Done. In TaskForce, "Open in Outlook" now opens emails and documents',
  'echo   directly in Outlook, Word or your PDF viewer.',
  'echo   The first time, your browser asks to allow it - tick "Always allow" and click Open.',
  'echo.',
  'pause'];

  return lines.join('\r\n') + '\r\n';
}

module.exports = { createCore, today, addDays, openerInstaller };
