/* TaskForce front end - plain JavaScript, no build step */
'use strict';

const STATUS = [
  { key: 'todo', label: 'To do', color: '#8a8984' },
  { key: 'progress', label: 'In progress', color: '#2563eb' },
  { key: 'waiting', label: 'Waiting on', color: '#d48a1a' },
  { key: 'done', label: 'Done', color: '#2e7d32' },
];
const STATUS_LABEL = Object.fromEntries(STATUS.map(s => [s.key, s.label]));
const PRIORITY = [
  { key: 'low', label: 'Low' }, { key: 'normal', label: 'Normal' }, { key: 'high', label: 'High' }, { key: 'urgent', label: 'Urgent' },
];
const TYPE_LABEL = Object.fromEntries(TFW.MATTER_TYPES.map(t => [t.key, t.label]));
const TYPE_SHORT = Object.fromEntries(TFW.MATTER_TYPES.map(t => [t.key, t.short]));
const TYPE_PILL = { P: 'p-blue', V: 'p-orange', PA: 'p-violet', VPA: 'p-magenta', LD: 'p-aqua', SP: 'p-yellow', O: 'p-gray', TAX: 'p-red' };
const STAGE_LABEL = Object.fromEntries(TFW.STAGES.map(s => [s.key, s.label]));
const COLORS = ['blue', 'green', 'violet', 'orange', 'magenta', 'aqua', 'red', 'yellow'];

const S = {
  me: null, users: [], firm: '', mailConfigured: false,
  version: null, unread: 0, matters: [],
  showDoneAll: false, listSort: { key: 'due_date', dir: 1 },
  calMonth: null, drawerTaskId: null, settleWeeks: 3,
};

/* ---------------- utilities ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function store(key, val) {
  try { if (val === undefined) return JSON.parse(localStorage.getItem('tf_' + key)); localStorage.setItem('tf_' + key, JSON.stringify(val)); } catch { return null; }
}
let hostingOptions;
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) {
    hostingOptions ||= fetch('/hosting.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
    if ((await hostingOptions).directUploads) {
      const files = [...body.values()].filter(value => value instanceof File);
      const grant = await api('POST', '/api/storage/uploads', { target: url, files: files.map(file => ({ name: file.name, size: file.size, type: file.type })) });
      for (let i = 0; i < files.length; i++) {
        const result = await fetch(grant.uploads[i].url, { method: 'PUT', headers: { 'Content-Type': files[i].type || 'application/octet-stream' }, body: files[i] });
        if (!result.ok) throw new Error('File upload failed. Please try again.');
      }
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify({ _cloudUploads: grant.uploads.map(upload => upload.id) });
    } else opts.body = body;
  }
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  let data = null;
  try { data = await r.json(); } catch { /* not json */ }
  if (r.status === 401 && !url.includes('/api/login')) { S.me = null; renderLogin(); throw new Error('Signed out'); }
  if (!r.ok) throw new Error((data && data.error) || 'Something went wrong.');
  return data;
}
let toastTimer;
function toast(msg, isErr) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = 'toast' + (isErr ? ' error' : '');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), isErr ? 5000 : 2600);
}
function errToast(e) { if (e && e.message !== 'Signed out') toast(e.message, true); }
const pad = n => String(n).padStart(2, '0');
function todayStr(offset = 0) { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function dstr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function daysBetween(a, b) { return Math.round((parseD(b) - parseD(a)) / 864e5); }
function fmtDate(s, opts) {
  if (!s) return '';
  return parseD(s).toLocaleDateString('en-AU', opts || { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtDT(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}
function ago(s) {
  const d = new Date(s.replace(' ', 'T')), m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
  return fmtDT(s);
}
function dueInfo(due, status, time) {
  const r = dueInfo0(due, status);
  if (time && due) r.text += ' ' + fmtTime(time);
  return r;
}
function repeatText(k) { return ((TFW.REPEATS.find(r => r.key === k) || {}).label || '').toLowerCase(); }
function fmtTime(t) { if (!t) return ''; const [h, m] = t.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', ''); }
function dueInfo0(due, status) {
  if (!due) return { text: 'No date', cls: 'p-gray' };
  if (status === 'done') return { text: fmtDate(due), cls: 'p-gray' };
  const n = daysBetween(todayStr(), due);
  if (n < 0) return { text: n === -1 ? '1 day late' : `${-n} days late`, cls: 'p-red' };
  if (n === 0) return { text: 'Due today', cls: 'p-red' };
  if (n === 1) return { text: 'Tomorrow', cls: 'p-yellow' };
  return { text: fmtDate(due), cls: 'p-gray' };
}
function user(id) { return S.users.find(u => u.id === id); }
function avatar(id, lg) {
  const u = user(id);
  if (!u) return `<span class="av ${lg ? 'lg' : ''} p-gray" title="Unassigned">–</span>`;
  return `<span class="av ${lg ? 'lg' : ''} p-${u.color}" title="${esc(u.name)}">${esc(u.initials)}</span>`;
}
function userOptions(selected, includeNone, onlyActive = true) {
  return (includeNone ? `<option value="">Unassigned</option>` : '') +
    S.users.filter(u => !onlyActive || u.active || u.id === selected).map(u => `<option value="${u.id}" ${u.id === selected ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
}
function matterOptions(selected) {
  const list = S.matters.filter(m => m.status === 'active' || m.id === selected);
  return `<option value="">Office / no matter</option>` + list.map(m =>
    `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.name || m.code)}${m.address ? ' · ' + esc(m.address) : ''}</option>`).join('');
}
function matterTag(t) {
  if (!t.matter_code) return '<span>Office</span>';
  return `<span>${esc(t.matter_code)} ${esc(TYPE_SHORT[t.matter_type] || t.matter_type)}${t.item_stage ? ' · ' + esc(STAGE_LABEL[t.item_stage] || '') : ''}</span>`;
}
function fileKind(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['msg', 'eml'].includes(ext)) return { label: '@', cls: 'p-violet' };
  if (ext === 'pdf') return { label: 'PDF', cls: 'p-red' };
  if (['doc', 'docx', 'rtf'].includes(ext)) return { label: 'DOC', cls: 'p-blue' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { label: 'XLS', cls: 'p-green' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return { label: 'IMG', cls: 'p-aqua' };
  return { label: (ext || 'FILE').slice(0, 4).toUpperCase(), cls: 'p-gray' };
}
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function highlightMentions(text) {
  return esc(text).replace(/(^|\s)@([A-Za-z][\w'-]*)/g, '$1<span class="mention">@$2</span>');
}
function fileDragHasFiles(e) { return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'); }

// Stop the browser from opening a file dropped outside a drop zone
window.addEventListener('dragover', e => { if (fileDragHasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => { if (fileDragHasFiles(e)) e.preventDefault(); });

/* ---------------- auth screens ---------------- */
async function boot() {
  try {
    const st = await (await fetch('/api/setup-status')).json();
    S.loginMode = st.loginMode || 'password'; S.firm = st.firm || S.firm;
    if (st.needsSetup) return renderSetup();
    const r = await fetch('/api/me');
    if (r.status === 401) return renderLogin(st.firm);
    const me = await r.json();
    S.me = me.user; S.firm = me.firm; S.mailConfigured = me.mailConfigured;
    await loadRefs();
    if (window.loadPeopleDates) await loadPeopleDates();
    renderShell();
    route();
    startPolling();
    if (window.startTimeWatch) startTimeWatch();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="auth-wrap"><div class="auth-card"><h2>Can’t reach TaskForce</h2><p class="sec">Check the TaskForce computer is switched on and running, then refresh this page.</p></div></div>`;
  }
}
function renderSetup() {
  document.getElementById('app').innerHTML = `
  <div class="auth-wrap"><form class="auth-card" id="setupForm">
    <div class="brand" style="margin-bottom:14px"><span class="brand-mark">✓</span>TaskForce</div>
    <h2>Set up TaskForce</h2>
    <p class="sec small" style="margin-top:-4px">Create the first admin account. You can add your staff after this.</p>
    <label class="f">Firm name<input name="firm" placeholder="Raikan Corporation"></label>
    <label class="f">Your name<input name="name" required placeholder="Bhavesh Chaudhari"></label>
    <label class="f">Email<input name="email" type="email" required placeholder="name@firm.com.au"></label>
    <label class="f">Password (8+ characters)<input name="password" type="password" required minlength="8"></label>
    <div class="err" id="setupErr"></div>
    <button class="primary" style="width:100%;justify-content:center">Create admin account</button>
  </form></div>`;
  $('#setupForm').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try { await api('POST', '/api/setup', fd); location.hash = '#/admin/users'; boot(); }
    catch (err) { $('#setupErr').textContent = err.message; }
  };
}
// Sign in: password, a 6-digit code emailed to you, or both – whichever the admin has chosen
function renderLogin(firm, step, email) {
  stopPolling();
  if (window.stopTimeWatch) stopTimeWatch();
  firm = firm || S.firm;
  const mode = S.loginMode || 'password';
  step = step || (mode === 'code' ? 'email' : 'password');
  const brand = `<div class="brand" style="margin-bottom:14px"><span class="brand-mark">✓</span>TaskForce</div><h2>Sign in${firm ? ' to ' + esc(firm) : ''}</h2>`;
  let html;
  if (step === 'password') html = `<form class="auth-card" id="loginForm">${brand}
    <label class="f">Email<input name="email" type="email" required autocomplete="username" autofocus value="${esc(email || '')}"></label>
    <label class="f">Password<input name="password" type="password" required autocomplete="current-password"></label>
    <div class="err" id="loginErr"></div>
    <button class="primary" style="width:100%;justify-content:center">${mode === 'both' ? 'Next' : 'Sign in'}</button>
    ${mode === 'either' ? '<a class="auth-alt" href="javascript:void 0" id="toCode">Email me a sign-in code instead</a>' : ''}
    <p class="muted small" style="margin:12px 0 0">${mode === 'both' ? 'After your password, we email you a 6-digit code. ' : ''}Forgot your password? Ask your admin to reset it.</p></form>`;
  else if (step === 'email') html = `<form class="auth-card" id="loginForm">${brand}
    <p class="sec small" style="margin-top:-4px">We’ll email you a 6-digit code to sign in with.</p>
    <label class="f">Email<input name="email" type="email" required autocomplete="username" autofocus value="${esc(email || '')}"></label>
    <div class="err" id="loginErr"></div>
    <button class="primary" style="width:100%;justify-content:center">Email me a code</button>
    ${mode === 'either' ? '<a class="auth-alt" href="javascript:void 0" id="toPw">Use my password instead</a>' : ''}</form>`;
  else html = `<form class="auth-card" id="loginForm">${brand}
    <p class="sec small" style="margin-top:-4px">We emailed a 6-digit code to <b>${esc(email)}</b>. It expires in 10 minutes.</p>
    <label class="f">Code<input name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" required autofocus></label>
    <div class="err" id="loginErr"></div>
    <button class="primary" style="width:100%;justify-content:center">Sign in</button>
    <a class="auth-alt" href="javascript:void 0" id="resend">${mode === 'both' ? 'Start again' : 'Send a new code'}</a></form>`;
  document.getElementById('app').innerHTML = `<div class="auth-wrap">${html}</div>`;
  const form = $('#loginForm'), errBox = $('#loginErr');
  const busy = on => { const b = $('button.primary', form); b.disabled = on; };
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    busy(true);
    try {
      if (step === 'password') {
        const r = await api('POST', '/api/login', fd);
        if (r && r.needCode) return renderLogin(firm, 'code', r.email || fd.email);
        return boot();
      }
      if (step === 'email') { await api('POST', '/api/login/send-code', { email: fd.email }); return renderLogin(firm, 'code', fd.email); }
      await api('POST', '/api/login/code', { email, code: fd.code }); boot();
    } catch (err) { errBox.textContent = err.message; busy(false); }
  };
  const go = (id, f) => { const a = $('#' + id); if (a) a.onclick = f; };
  go('toCode', () => renderLogin(firm, 'email', form.email.value));
  go('toPw', () => renderLogin(firm, 'password', form.email.value));
  go('resend', () => renderLogin(firm, mode === 'both' ? 'password' : 'email', email));
  if (window.TF_LOCAL && step === 'password') window.TF_LOCAL.decorateLogin();
}

async function loadRefs() {
  const [users, matters] = await Promise.all([api('GET', '/api/users'), api('GET', '/api/matters?status=all&brief=1')]);
  S.users = users; S.matters = matters;
}

/* ---------------- shell ---------------- */
function renderShell() {
  const admin = S.me.role === 'admin';
  document.getElementById('app').innerHTML = `
  <header class="topbar">
    <button class="icon-btn nav-toggle" onclick="TF.toggleNav(event)" aria-label="Menu">☰</button>
    <a class="brand" href="#/board"><span class="brand-mark">✓</span>TaskForce</a>
    <nav class="nav row" style="gap:2px" id="mainNav" onclick="if(event.target.closest('a'))this.classList.remove('open')">
      <a href="#/board" data-r="board">Board</a>
      <a href="#/list" data-r="list">List</a>
      <a href="#/calendar" data-r="calendar">Calendar</a>
      <a href="#/matters" data-r="matters">Matters</a>
      <a href="#/readiness" data-r="readiness">Readiness</a>
      ${S.me.can_tax ? '<a href="#/tax" data-r="tax" title="Taxation – only staff with Taxation access see this">Taxation</a>' : ''}
      <a href="#/callbacks" data-r="callbacks">Call-backs <span class="nav-badge hidden" id="cbCount">0</span></a>
      <a href="#/time" data-r="time" title="Timesheets, leave and public holidays">Time</a>
      ${admin ? '<a href="#/admin/users" data-r="admin">Admin</a>' : ''}
    </nav>
    <div class="search"><input id="gsearch" placeholder="Search BC1234, address, task…" autocomplete="off"><div id="gresults" class="search-results hidden"></div></div>
    <div class="spacer"></div>
    <div id="clockBox" style="position:relative"></div>
    <button onclick="TF.logCall()" title="Log a call someone needs to return">📞<span class="btn-label"> Log call</span></button>
    <button class="primary" onclick="TF.newTask()" title="New task">+<span class="btn-label"> New task</span></button>
    <div style="position:relative">
      <button class="icon-btn" id="bellBtn" aria-label="Notifications" onclick="TF.toggleNotifs(event)">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/></svg>
        <span class="badge-count hidden" id="bellCount">0</span>
      </button>
      <div class="menu notif-panel hidden" id="notifPanel"></div>
    </div>
    <div style="position:relative">
      <button class="icon-btn" onclick="TF.toggleUserMenu(event)" aria-label="Account">${avatar(S.me.id, true)}</button>
      <div class="menu hidden" id="userMenu">
        <div style="padding:10px 14px;border-bottom:1px solid var(--border)"><div style="font-weight:600">${esc(S.me.name)}</div><div class="muted small">${esc(S.me.email)}</div></div>
        <div class="mi" onclick="TF.account()">My account</div>
        <div class="mi" onclick="TF.logout()">Sign out</div>
      </div>
    </div>
  </header>
  <main id="main"></main>`;
  const gs = $('#gsearch');
  let st;
  gs.oninput = () => { clearTimeout(st); st = setTimeout(() => globalSearch(gs.value), 200); };
  gs.onfocus = () => { if (gs.value) globalSearch(gs.value); };
  document.addEventListener('click', e => {
    if (!e.target.closest('.search')) $('#gresults') && $('#gresults').classList.add('hidden');
    if (!e.target.closest('#notifPanel') && !e.target.closest('#bellBtn')) $('#notifPanel') && $('#notifPanel').classList.add('hidden');
    if (!e.target.closest('#userMenu') && !e.target.closest('[aria-label=Account]')) $('#userMenu') && $('#userMenu').classList.add('hidden');
    if (!e.target.closest('#mainNav') && !e.target.closest('.nav-toggle')) $('#mainNav') && $('#mainNav').classList.remove('open');
  });
}
async function globalSearch(q) {
  const box = $('#gresults');
  if (!q.trim()) { box.classList.add('hidden'); return; }
  try {
    const r = await api('GET', '/api/search?q=' + encodeURIComponent(q));
    let html = '';
    r.matters.forEach(m => { html += `<div class="sr" onclick="location.hash='#/matters/${m.id}'"><span class="pill ${TYPE_PILL[m.type]}">${esc(TYPE_SHORT[m.type])}</span> <b>${esc(m.code)}</b> ${esc(m.client)}${m.address ? `<div class="muted small">${esc(m.address)}</div>` : ''}</div>`; });
    r.tasks.forEach(t => { html += `<div class="sr" onclick="TF.openTask(${t.id})"><div class="muted small">${t.matter_code ? esc(t.matter_code) : 'Office'} · ${STATUS_LABEL[t.status]}</div>${esc(t.title)}</div>`; });
    box.innerHTML = html || '<div class="sr muted">No matches</div>';
    box.classList.remove('hidden');
  } catch (e) { errToast(e); }
}

/* ---------------- router ---------------- */
window.addEventListener('hashchange', () => { if (!S.me) return; if ($('#drawer')) closeDrawer(true); closeModal(); route(); });
function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'board';
  const [r, a, b] = h.split('/');
  if (r === 'task' && a) { location.replace('#/board'); setTimeout(() => openTask(+a), 50); return; }
  $$('.nav a').forEach(x => x.classList.toggle('on', x.dataset.r === r));
  const main = $('#main');
  if (!main) return;
  ({
    board: renderBoard, list: renderList, calendar: renderCalendar, matters: a ? () => renderMatter(+a, b) : () => renderMatters('conv'),
    tax: () => (S.me.can_tax ? renderMatters('tax') : renderBoard()),
    time: () => renderTime(),
    readiness: renderReadiness, settlements: renderReadiness, callbacks: () => renderCallbacks(a ? +a : null), admin: () => renderAdmin(a || 'users'),
  }[r] || renderBoard)();
}
function refreshView() { route(); }

/* ---------------- filters shared by board/list/calendar ---------------- */
function getFilter() { return store('filter') || { scope: 'all', person: '' }; }
function filterBar(extra = '') {
  const f = getFilter();
  const chip = (k, label) => `<span class="chip ${f.scope === k ? 'on' : ''}" onclick="TF.setScope('${k}')">${label}</span>`;
  return `<div class="toolbar">
    ${chip('all', 'All tasks')}${chip('mine', 'Assigned to me')}${chip('byme', 'I assigned')}${chip('overdue', 'Overdue')}
    <select style="width:auto" onchange="TF.setPerson(this.value)"><option value="">Everyone</option>${S.users.filter(u => u.active).map(u => `<option value="${u.id}" ${String(u.id) === String(f.person) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
    ${extra}
  </div>`;
}
function applyFilter(tasks) {
  const f = getFilter(), today = todayStr();
  return tasks.filter(t => {
    if (f.scope === 'mine' && t.assignee_id !== S.me.id) return false;
    if (f.scope === 'byme' && t.created_by !== S.me.id) return false;
    if (f.scope === 'overdue' && !(t.status !== 'done' && t.due_date && t.due_date < today)) return false;
    if (f.person && String(t.assignee_id) !== String(f.person)) return false;
    return true;
  });
}

/* ---------------- board ---------------- */
async function renderBoard() {
  const main = $('#main');
  let tasks;
  try { tasks = await api('GET', '/api/tasks?done_days=' + (S.showDoneAll ? 90 : 14)); } catch (e) { return errToast(e); }
  tasks = applyFilter(tasks);
  const cols = STATUS.map(s => {
    let list = tasks.filter(t => t.status === s.key);
    if (s.key === 'done') list.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
    const shown = s.key === 'done' && !S.showDoneAll ? list.slice(0, 8) : list;
    return `<section class="col" data-status="${s.key}">
      <div class="col-head"><span><span class="dot" style="background:${s.color}"></span>${s.label}</span><span class="muted">${list.length}</span></div>
      <div class="col-body">${shown.map(cardHTML).join('') || ''}
      ${s.key === 'done' && list.length > shown.length ? `<div class="show-more" onclick="TF.showAllDone()">Show ${list.length - shown.length} more</div>` : ''}</div>
    </section>`;
  }).join('');
  main.innerHTML = filterBar(`<span class="spacer"></span><span class="muted small">Drag cards to change status. Drop files or Outlook emails onto a card to attach them.</span>`) + (window.todayStripHTML ? todayStripHTML() : '') + `<div class="board">${cols}</div>`;
  wireBoard();
}
function cardHTML(t) {
  const d = dueInfo(t.due_date, t.status, t.due_time);
  const icons = [];
  if (t.note_count) icons.push(`<span title="Notes">💬 ${t.note_count}</span>`);
  if (t.attachment_count) icons.push(`<span title="Attachments">📎 ${t.attachment_count}</span>`);
  if (t.check_total) icons.push(`<span title="Checklist">☑ ${t.check_done}/${t.check_total}</span>`);
  if (t.repeat && t.status !== 'done') icons.push(`<span title="Repeats ${esc(repeatText(t.repeat))}">🔁</span>`);
  return `<div class="tcard ${t.status === 'done' ? 'done' : ''}" draggable="true" data-id="${t.id}">
    ${t.priority === 'urgent' || t.priority === 'high' ? `<span class="prio-bar prio-${t.priority}" title="${t.priority} priority"></span>` : ''}
    <div class="mcode">${matterTag(t)}</div>
    <div class="ttl">${esc(t.title)}</div>
    <div class="meta"><span class="pill ${t.status === 'done' ? 'p-green' : d.cls}">${t.status === 'done' ? 'Done ' + fmtDate((t.completed_at || '').slice(0, 10), { day: 'numeric', month: 'short' }) : d.text}</span>
      <span class="icons">${icons.join('')}${avatar(t.assignee_id)}</span></div>
  </div>`;
}
function wireBoard() {
  let dragId = null;
  $$('.tcard').forEach(card => {
    card.onclick = () => openTask(+card.dataset.id);
    card.addEventListener('dragstart', e => {
      dragId = card.dataset.id;
      e.dataTransfer.setData('text/tf-task', dragId);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.classList.add('dragging'), 0);
    });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); $$('.drop-ph').forEach(p => p.remove()); $$('.col').forEach(c => c.classList.remove('drop-target')); dragId = null; });
    // files dropped on a card get attached to that task
    card.addEventListener('dragover', e => { if (fileDragHasFiles(e)) { e.preventDefault(); e.stopPropagation(); card.classList.add('file-over'); } });
    card.addEventListener('dragleave', () => card.classList.remove('file-over'));
    card.addEventListener('drop', e => {
      if (!fileDragHasFiles(e)) return;
      e.preventDefault(); e.stopPropagation(); card.classList.remove('file-over');
      uploadFiles(+card.dataset.id, e.dataTransfer.files).then(() => refreshView());
    });
  });
  $$('.col').forEach(col => {
    const body = $('.col-body', col);
    col.addEventListener('dragover', e => {
      if (!dragId) return;
      e.preventDefault();
      col.classList.add('drop-target');
      const after = cardAfter(body, e.clientY);
      let ph = $('.drop-ph') || Object.assign(document.createElement('div'), { className: 'drop-ph' });
      if (after) body.insertBefore(ph, after); else body.appendChild(ph);
    });
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) { col.classList.remove('drop-target'); } });
    col.addEventListener('drop', async e => {
      if (!dragId) return;
      e.preventDefault();
      const ph = $('.drop-ph');
      const prev = ph && ph.previousElementSibling && ph.previousElementSibling.classList.contains('tcard') ? ph.previousElementSibling.dataset.id : null;
      let next = ph && ph.nextElementSibling && ph.nextElementSibling.classList.contains('tcard') ? ph.nextElementSibling.dataset.id : null;
      if (prev === dragId) return refreshView();
      if (next === dragId) next = ph.nextElementSibling.nextElementSibling && ph.nextElementSibling.nextElementSibling.dataset.id;
      const id = dragId;
      try { await api('POST', `/api/tasks/${id}/move`, { status: col.dataset.status, before_id: prev, after_id: next }); }
      catch (err) { errToast(err); }
      refreshView();
    });
  });
}
function cardAfter(container, y) {
  const cards = $$('.tcard:not(.dragging)', container);
  return cards.find(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
}

/* ---------------- list ---------------- */
async function renderList() {
  const main = $('#main');
  const lf = store('listf') || { status: 'open', priority: '', q: '' };
  let tasks;
  try { tasks = await api('GET', '/api/tasks' + (lf.status === 'all' || lf.status === 'open' ? '' : '?status=' + lf.status)); } catch (e) { return errToast(e); }
  tasks = applyFilter(tasks);
  if (lf.status === 'open') tasks = tasks.filter(t => t.status !== 'done');
  if (lf.priority) tasks = tasks.filter(t => t.priority === lf.priority);
  if (lf.q) { const q = lf.q.toLowerCase(); tasks = tasks.filter(t => (t.title + ' ' + (t.matter_code || '') + ' ' + (t.matter_address || '') + ' ' + t.description).toLowerCase().includes(q)); }
  const { key, dir } = S.listSort;
  const prioRank = { urgent: 0, high: 1, normal: 2, low: 3 };
  const val = t => key === 'assignee' ? ((user(t.assignee_id) || {}).name || '') : key === 'priority' ? prioRank[t.priority] : key === 'matter' ? (t.matter_code || '') : (t[key] || (key === 'due_date' ? '9999' : ''));
  tasks.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  const th = (k, label) => `<th onclick="TF.sortList('${k}')">${label}${key === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  main.innerHTML = filterBar(`
    <select style="width:auto" onchange="TF.setListF('status',this.value)">
      <option value="open" ${lf.status === 'open' ? 'selected' : ''}>Open tasks</option><option value="all" ${lf.status === 'all' ? 'selected' : ''}>All statuses</option>
      ${STATUS.map(s => `<option value="${s.key}" ${lf.status === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
    <select style="width:auto" onchange="TF.setListF('priority',this.value)"><option value="">Any priority</option>${PRIORITY.map(p => `<option value="${p.key}" ${lf.priority === p.key ? 'selected' : ''}>${p.label}</option>`).join('')}</select>
    <input style="width:200px" placeholder="Filter this list" value="${esc(lf.q)}" onchange="TF.setListF('q',this.value)">
    <span class="spacer"></span><span class="muted small">${tasks.length} task${tasks.length === 1 ? '' : 's'}</span>`) +
    (tasks.length ? `<table class="tbl"><thead><tr>${th('title', 'Task')}${th('matter', 'Matter')}${th('assignee', 'Assigned to')}${th('due_date', 'Due')}${th('priority', 'Priority')}${th('status', 'Status')}</tr></thead><tbody>
    ${tasks.map(t => { const d = dueInfo(t.due_date, t.status, t.due_time); const u = user(t.assignee_id); return `<tr onclick="TF.openTask(${t.id})">
      <td>${esc(t.title)} ${t.attachment_count ? '<span class="muted small">📎' + t.attachment_count + '</span>' : ''}</td>
      <td>${t.matter_code ? `${esc(t.matter_code)} <span class="muted small">${esc(t.matter_address || '')}</span>` : '<span class="muted">Office</span>'}</td>
      <td><span class="row" style="gap:6px">${avatar(t.assignee_id)} ${u ? esc(u.name) : '<span class="muted">Unassigned</span>'}</span></td>
      <td><span class="pill ${d.cls}">${d.text}</span></td>
      <td>${t.priority === 'normal' ? '<span class="muted">Normal</span>' : `<span class="pill ${t.priority === 'urgent' ? 'p-red' : t.priority === 'high' ? 'p-orange' : 'p-gray'}">${t.priority[0].toUpperCase() + t.priority.slice(1)}</span>`}</td>
      <td>${STATUS_LABEL[t.status]}</td></tr>`; }).join('')}
    </tbody></table>` : `<div class="card empty">No tasks match these filters.</div>`);
}

/* ---------------- task drawer ---------------- */
async function openTask(id) {
  let t;
  try { t = await api('GET', '/api/tasks/' + id); } catch (e) { return errToast(e); }
  S.drawerTaskId = id;
  closeDrawer(true);
  const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'drawerOv'; ov.onclick = () => closeDrawer();
  const dr = document.createElement('aside'); dr.className = 'drawer'; dr.id = 'drawer';
  document.body.append(ov, dr);
  drawDrawer(t);
  document.addEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape' && !$('.modal')) closeDrawer(); }
function closeDrawer(silent) {
  $('#drawer') && $('#drawer').remove(); $('#drawerOv') && $('#drawerOv').remove();
  document.removeEventListener('keydown', escClose);
  if (!silent) { S.drawerTaskId = null; refreshView(); }
}
function drawDrawer(t) {
  const dr = $('#drawer');
  if (!dr) return;
  const creator = user(t.created_by);
  const items = [
    ...t.notes.map(n => ({ kind: 'note', at: n.created_at, n })),
    ...t.activity.map(a => ({ kind: 'act', at: a.created_at, a })),
  ].sort((a, b) => a.at.localeCompare(b.at) || (a.kind === 'act' ? -1 : 1));
  const canDelete = S.me.role === 'admin' || t.created_by === S.me.id;
  dr.innerHTML = `
  <div class="drawer-head">
    <div class="row">
      <div class="small muted" style="flex:1">${t.matter_id ? `<a href="#/matters/${t.matter_id}" onclick="TF.closeDrawer(true)">${esc(t.matter_code)} ${esc(TYPE_SHORT[t.matter_type] || t.matter_type)}${t.matter_client ? ' ' + esc(t.matter_client) : ''}</a>${t.item_stage ? ' · ' + esc(STAGE_LABEL[t.item_stage] || t.item_stage) + ' checklist' : ''}${t.matter_address ? ' · ' + esc(t.matter_address) : ''}` : 'Office task'}</div>
      ${canDelete ? `<button class="ghost sm danger" onclick="TF.deleteTask(${t.id})">Delete</button>` : ''}
      <button class="ghost sm" onclick="TF.closeDrawer()" aria-label="Close">✕</button>
    </div>
    <input class="title-input" id="dTitle" value="${esc(t.title)}">
    <div class="status-seg">${STATUS.map(s => `<span class="chip ${t.status === s.key ? 'on' : ''}" onclick="TF.setTask(${t.id},{status:'${s.key}'})">${s.label}</span>`).join('')}</div>
  </div>
  <div class="drawer-body" id="dBody">
    <div class="fields">
      <div><div class="lbl">Assigned to</div><select onchange="TF.setTask(${t.id},{assignee_id:this.value||null})">${userOptions(t.assignee_id, true)}</select></div>
      <div><div class="lbl">Due</div><input type="date" value="${esc(t.due_date || '')}" onchange="TF.setTask(${t.id},{due_date:this.value||null})"></div>
      <div><div class="lbl">Priority</div><select onchange="TF.setTask(${t.id},{priority:this.value})">${PRIORITY.map(p => `<option value="${p.key}" ${t.priority === p.key ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
      <div><div class="lbl">Matter</div><select onchange="TF.setTask(${t.id},{matter_id:this.value||null})">${matterOptions(t.matter_id)}</select></div>
    </div>
    <div class="fields" style="padding-top:0">
      <div><div class="lbl">Time</div><input type="time" step="900" value="${esc(t.due_time || '')}" onchange="TF.setTask(${t.id},{due_time:this.value||null})"></div>
      ${t.due_time ? `<div><div class="lbl">Length</div><select onchange="TF.setTask(${t.id},{duration:this.value})">${lengthOptions(t.duration || 60)}</select></div>` : ''}
      <div><div class="lbl">Repeat</div><select onchange="TF.setTask(${t.id},{repeat:this.value||null})"><option value="">Does not repeat</option>${TFW.REPEATS.map(r => `<option value="${r.key}" ${t.repeat === r.key ? 'selected' : ''}>${r.label}</option>`).join('')}</select></div>
      ${t.repeat ? `<div><div class="lbl">Repeat until</div><input type="date" value="${esc(t.repeat_until || '')}" onchange="TF.setTask(${t.id},{repeat_until:this.value||null})"></div>
      <div class="small muted" style="align-self:end">${t.repeat_next_id ? 'Next one already created' : 'When this is done, the next one is created'}</div>` : ''}
    </div>
    <div class="small muted">Created by ${creator ? esc(creator.name) : 'unknown'} · ${fmtDT(t.created_at)}</div>

    <div class="section"><h3>Description</h3></div>
    <textarea id="dDesc" rows="3" placeholder="Add details, instructions or links">${esc(t.description)}</textarea>

    <div class="section"><h3>Checklist ${t.checklist.length ? `<span class="muted small">${t.checklist.filter(c => c.done).length}/${t.checklist.length}</span>` : ''}</h3></div>
    ${t.checklist.map(c => `<div class="chk ${c.done ? 'done' : ''}"><input type="checkbox" ${c.done ? 'checked' : ''} onchange="TF.checkItem(${c.id}, this.checked)"><span>${esc(c.text)}</span><button class="ghost sm x" onclick="TF.delCheck(${c.id})" aria-label="Remove">✕</button></div>`).join('')}
    <div class="row" style="margin-top:4px"><input id="dChk" placeholder="Add an item and press Enter"></div>

    <div class="section"><h3>Attachments ${t.attachments.length ? `<span class="muted small">${t.attachments.length}</span>` : ''}</h3></div>
    ${t.attachments.map(a => attHTML(a)).join('')}
    <div class="dropzone" id="dDrop">Drag files or Outlook emails here, or <u>choose files</u><input type="file" id="dFile" multiple class="hidden"></div>

    <div class="section"><h3>Notes and activity</h3></div>
    <div class="timeline">
      ${items.map(it => it.kind === 'note' ? noteHTML(it.n) : `<div class="tl-act"><span class="dotline">•</span><span>${esc((user(it.a.user_id) || { name: 'TaskForce' }).name)} ${esc(it.a.action)} · ${fmtDT(it.a.created_at)}</span></div>`).join('')}
    </div>
    <div class="composer">
      <textarea id="dNote" rows="2" placeholder="Add a note. Type @ and a name to notify someone."></textarea>
      <div class="row" style="margin-top:6px">
        <div class="mention-bar">${S.users.filter(u => u.active && u.id !== S.me.id).map(u => { const tag = mentionTag(u); return `<span class="chip" onclick="TF.insertMention('${esc(tag)}')" title="${esc(u.name)}">@${esc(tag)}</span>`; }).join('')}</div>
        <span class="spacer"></span><span class="muted small">Ctrl+Enter</span><button class="primary" onclick="TF.postNote(${t.id})">Post note</button>
      </div>
    </div>
  </div>`;
  // wire inputs
  const title = $('#dTitle');
  title.onblur = () => { if (title.value.trim() && title.value.trim() !== t.title) setTask(t.id, { title: title.value.trim() }); };
  title.onkeydown = e => { if (e.key === 'Enter') title.blur(); };
  const desc = $('#dDesc');
  desc.onblur = () => { if (desc.value !== t.description) setTask(t.id, { description: desc.value }); };
  const chk = $('#dChk');
  chk.onkeydown = async e => {
    if (e.key === 'Enter' && chk.value.trim()) {
      try { drawDrawer(await api('POST', `/api/tasks/${t.id}/checklist`, { text: chk.value.trim() })); $('#dChk').focus(); } catch (err) { errToast(err); }
    }
  };
  $('#dNote').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postNote(t.id); };
  const fileIn = $('#dFile');
  $('#dDrop').onclick = () => fileIn.click();
  fileIn.onchange = () => { if (fileIn.files.length) uploadFiles(t.id, fileIn.files).then(r => r && drawDrawer(r)); };
  // drop anywhere on the drawer
  const body = $('#dBody');
  let depth = 0;
  dr.ondragenter = e => { if (!fileDragHasFiles(e)) return; depth++; if (!$('.drop-overlay', body)) { const o = document.createElement('div'); o.className = 'drop-overlay'; o.style.top = body.scrollTop + 'px'; o.style.height = body.clientHeight + 'px'; o.style.bottom = 'auto'; o.textContent = 'Drop to attach to this task'; body.appendChild(o); } };
  dr.ondragleave = e => { if (!fileDragHasFiles(e)) return; depth--; if (depth <= 0) { depth = 0; $('.drop-overlay', body) && $('.drop-overlay', body).remove(); } };
  dr.ondragover = e => { if (fileDragHasFiles(e)) e.preventDefault(); };
  dr.ondrop = e => {
    if (!fileDragHasFiles(e)) return;
    e.preventDefault(); depth = 0; $('.drop-overlay', body) && $('.drop-overlay', body).remove();
    uploadFiles(t.id, e.dataTransfer.files).then(r => r && drawDrawer(r));
  };
  S.drawerTask = t;
}
// First name if it's unique in the office, otherwise initials (both work as @mentions)
function mentionTag(u) {
  const first = u.name.split(/\s+/)[0];
  const clash = S.users.some(x => x.id !== u.id && x.active && x.name.split(/\s+/)[0].toLowerCase() === first.toLowerCase());
  return clash ? u.initials : first;
}
function attHTML(a) {
  const k = fileKind(a.filename);
  const up = user(a.uploaded_by);
  const em = a.email_meta;
  const viewable = /^(image\/|application\/pdf|text\/plain)/.test(a.mime);
  return `<div class="att">
    <div class="ficon ${k.cls}">${k.label}</div>
    <div style="min-width:0">
      ${em ? `<div class="fname"><b>${esc(em.subject || '(no subject)')}</b></div><div class="small muted">From ${esc(em.from)}${em.date ? ' · ' + new Date(em.date).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}${em.attachments && em.attachments.length ? ` · 📎 ${em.attachments.length} attachment${em.attachments.length > 1 ? 's' : ''}` : ''}</div>`
        : `<div class="fname">${esc(a.filename)}</div>`}
      <div class="small muted">${fmtSize(a.size)} · ${up ? esc(up.name) : ''} · ${fmtDT(a.created_at)}</div>
    </div>
    <div class="acts">
      ${em || /\.(msg|eml)$/i.test(a.filename) ? `<button class="sm" onclick="TF.readEmail(${a.id})">Read</button>` : canPreview(a.filename) ? `<button class="sm" onclick="TF.preview('attachment', ${a.id}, '${esc(a.filename).replace(/'/g, '&#39;')}')">Preview</button>` : ''}
      ${fileButtons('attachment', a.id, a.filename)}
      ${a.uploaded_by === S.me.id || S.me.role === 'admin' ? `<button class="sm ghost danger" onclick="TF.delAttachment(${a.id})" aria-label="Remove">✕</button>` : ''}
    </div></div>`;
}
function noteHTML(n) {
  const u = user(n.user_id);
  return `<div class="tl-note">${avatar(n.user_id, true)}<div style="flex:1;min-width:0">
    <div class="small muted">${u ? esc(u.name) : 'Unknown'} · ${fmtDT(n.created_at)}${n.user_id === S.me.id || S.me.role === 'admin' ? ` · <a href="javascript:TF.delNote(${n.id})">delete</a>` : ''}</div>
    <div class="body">${highlightMentions(n.body)}</div></div></div>`;
}
async function setTask(id, patch) {
  try {
    const t = await api('PUT', '/api/tasks/' + id, patch);
    if ($('#drawer') && S.drawerTaskId === id) drawDrawer(t);
    if (t.warning) toast(t.warning + ' You may want to give it to someone else.', true);
    else if (patch.status) toast('Moved to ' + STATUS_LABEL[patch.status]);
    if (patch.matter_id !== undefined) S.matters = await api('GET', '/api/matters?status=all&brief=1');
  } catch (e) { errToast(e); }
}
async function postNote(id) {
  const ta = $('#dNote');
  if (!ta.value.trim()) return;
  try { drawDrawer(await api('POST', `/api/tasks/${id}/notes`, { body: ta.value })); const b = $('#dBody'); b.scrollTop = b.scrollHeight; } catch (e) { errToast(e); }
}
async function uploadFiles(taskId, fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) {
    toast('Nothing was dropped. From classic Outlook, drag the email onto your desktop first, then drag that file here.', true);
    return null;
  }
  const big = files.find(f => f.size > 100 * 1024 * 1024);
  if (big) { toast(`${big.name} is over 100 MB.`, true); return null; }
  const fd = new FormData();
  files.forEach(f => fd.append('files', f, f.name));
  toast(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);
  try {
    const r = await api('POST', `/api/tasks/${taskId}/attachments`, fd);
    toast(`${files.length} file${files.length > 1 ? 's' : ''} attached`);
    return r;
  } catch (e) { errToast(e); return null; }
}
function viewEmail(attId) { return readEmail(attId); }
function lengthOptions(cur) {
  const opts = [[15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [90, '1½ hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], [480, 'All morning / afternoon (8 h)']];
  if (cur && !opts.some(o => o[0] === +cur)) opts.push([+cur, `${cur} minutes`]);
  return opts.map(([v, l]) => `<option value="${v}" ${+cur === v ? 'selected' : ''}>${l}</option>`).join('');
}

/* ---------------- new task ---------------- */
function newTask(preset = {}) {
  const staged = [];
  openModal(`<h2>New task</h2>
  <form id="ntForm">
    <label class="f">Title<input name="title" required autofocus placeholder="Order Form 1 searches"></label>
    <div class="grid2">
      <label class="f">Matter<select name="matter_id">${matterOptions(preset.matter_id || null)}</select></label>
      <label class="f">Assign to<select name="assignee_id">${userOptions(preset.assignee_id || S.me.id, false)}</select></label>
      <label class="f">Due date<input type="date" name="due_date" value="${preset.due_date || ''}"></label>
      <label class="f">Time <span class="muted">(optional)</span><input type="time" name="due_time" value="${preset.due_time || ''}" step="900"></label>
      <label class="f" id="ntLen" style="${preset.due_time ? '' : 'display:none'}">Length<select name="duration">${lengthOptions(preset.duration || 60)}</select></label>
      <label class="f">Repeat<select name="repeat"><option value="">Does not repeat</option>${TFW.REPEATS.map(r => `<option value="${r.key}">${r.label}</option>`).join('')}</select></label>
      <label class="f" id="ntUntil" style="display:none">Repeat until <span class="muted">(optional)</span><input type="date" name="repeat_until"></label>
      <label class="f">Priority<select name="priority">${PRIORITY.map(p => `<option value="${p.key}" ${p.key === 'normal' ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
    </div>
    <label class="f">Description<textarea name="description" rows="3" placeholder="What needs doing"></textarea></label>
    <div class="dropzone" id="ntDrop">Drop files or an Outlook email here, or <u>choose files</u>. An email fills in the title for you.<input type="file" id="ntFile" multiple class="hidden"></div>
    <div id="ntFiles" class="small" style="margin-top:6px"></div>
    <div class="err" id="ntErr"></div>
    <div class="foot"><button type="button" onclick="TF.closeModal()">Cancel</button><button class="primary">Create task</button></div>
  </form>`);
  const form = $('#ntForm');
  form.due_time.oninput = () => { $('#ntLen').style.display = form.due_time.value ? '' : 'none'; };
  form.repeat.onchange = () => { $('#ntUntil').style.display = form.repeat.value ? '' : 'none'; if (form.repeat.value && !form.due_date.value) form.due_date.value = todayStr(); };
  const showFiles = () => { $('#ntFiles').innerHTML = staged.map((f, i) => `<div class="row" style="gap:6px;padding:2px 0"><span class="pill ${fileKind(f.name).cls}">${fileKind(f.name).label}</span>${esc(f.name)} <span class="muted">${fmtSize(f.size)}</span><a href="javascript:void 0" data-rm="${i}">remove</a></div>`).join('');
    $$('[data-rm]', $('#ntFiles')).forEach(x => x.onclick = () => { staged.splice(+x.dataset.rm, 1); showFiles(); }); };
  const addFiles = async list => {
    const files = Array.from(list || []);
    if (!files.length) { toast('Nothing was dropped. From classic Outlook, drag the email onto your desktop first, then drag that file here.', true); return; }
    staged.push(...files); showFiles();
    const email = files.find(f => /\.(msg|eml)$/i.test(f.name));
    if (email && !form.title.value.trim()) {
      const fd = new FormData(); fd.append('file', email, email.name);
      try {
        const r = await api('POST', '/api/parse-email', fd);
        if (r.meta) {
          if (!form.title.value.trim()) form.title.value = (r.meta.subject || '').replace(/^(re|fw|fwd):\s*/i, '');
          if (!form.description.value.trim()) form.description.value = `Email from ${r.meta.from}${r.meta.date ? ' on ' + new Date(r.meta.date).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : ''}`;
          const code = /\bBC\s?\d{3,5}\b/i.exec((r.meta.subject || '') + ' ' + (r.meta.body || '').slice(0, 2000));
          if (code && !form.matter_id.value) {
            const m = S.matters.find(x => x.code.replace(/\s/g, '').toUpperCase() === code[0].replace(/\s/g, '').toUpperCase());
            if (m) form.matter_id.value = m.id;
          }
        }
      } catch { /* leave fields as they are */ }
    }
  };
  const dz = $('#ntDrop'), fi = $('#ntFile');
  dz.onclick = () => fi.click();
  fi.onchange = () => addFiles(fi.files);
  dz.ondragover = e => { if (fileDragHasFiles(e)) { e.preventDefault(); dz.style.background = 'var(--accent-bg)'; } };
  dz.ondragleave = () => { dz.style.background = ''; };
  dz.ondrop = e => { e.preventDefault(); dz.style.background = ''; addFiles(e.dataTransfer.files); };
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    if (!fd.due_time) delete fd.duration;
    try {
      const t = await api('POST', '/api/tasks', fd);
      if (staged.length) await uploadFiles(t.id, staged);
      closeModal(); toast(t.warning ? 'Task created. ' + t.warning : 'Task created', !!t.warning);
      refreshView();
    } catch (err) { $('#ntErr').textContent = err.message; }
  };
}

/* ---------------- modal ---------------- */
function openModal(html, wide) {
  closeModal();
  const ov = document.createElement('div'); ov.className = 'overlay modal-overlay'; ov.id = 'modalOv'; ov.onclick = closeModal;
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modal'; if (wide) m.style.width = 'min(760px, 94vw)';
  m.innerHTML = html;
  document.body.append(ov, m);
  const f = $('[autofocus]', m); if (f) f.focus();
  m.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}
function closeModal() { $('#modal') && $('#modal').remove(); $('#modalOv') && $('#modalOv').remove(); }

// In-page confirm / text prompts (browser pop-up dialogs are blocked inside shared Claude pages)
function askDialog({ title, text = '', input = false, value = '', placeholder = '', ok = 'OK', danger = false }) {
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'overlay dlg-overlay';
    const d = document.createElement('div'); d.className = 'modal dlg'; d.setAttribute('role', 'dialog');
    d.innerHTML = `<h2>${esc(title)}</h2>${text ? `<p class="sec" style="margin-top:-4px">${esc(text)}</p>` : ''}
      ${input ? `<input id="dlgInput" value="${esc(value)}" placeholder="${esc(placeholder)}">` : ''}
      <div class="foot"><button type="button" id="dlgCancel">Cancel</button><button type="button" class="primary ${danger ? 'danger-fill' : ''}" id="dlgOk">${esc(ok)}</button></div>`;
    document.body.append(ov, d);
    const done = v => { ov.remove(); d.remove(); resolve(v); };
    const inp = d.querySelector('#dlgInput');
    d.querySelector('#dlgOk').onclick = () => done(input ? inp.value : true);
    d.querySelector('#dlgCancel').onclick = () => done(input ? null : false);
    ov.onclick = () => done(input ? null : false);
    d.addEventListener('keydown', e => { if (e.key === 'Escape') done(input ? null : false); if (e.key === 'Enter' && input) done(inp.value); });
    (inp || d.querySelector('#dlgOk')).focus();
  });
}
const askConfirm = (title, text, ok = 'Delete') => askDialog({ title, text, ok, danger: /delete|remove|replace/i.test(ok) });
const askText = (title, opts = {}) => askDialog({ title, input: true, ok: opts.ok || 'Save', value: opts.value || '', placeholder: opts.placeholder || '', text: opts.text || '' });

/* ---------------- notifications ---------------- */
async function toggleNotifs(e) {
  e.stopPropagation();
  const p = $('#notifPanel');
  if (!p.classList.contains('hidden')) { p.classList.add('hidden'); return; }
  let list = [];
  try { list = await api('GET', '/api/notifications'); } catch (err) { return errToast(err); }
  p.innerHTML = `<div class="row" style="padding:10px 14px;border-bottom:1px solid var(--border)"><b>Notifications</b><span class="spacer"></span><a href="javascript:TF.readAll()" class="small">Mark all read</a></div>` +
    (list.length ? list.map(n => `<div class="notif ${n.read ? '' : 'unread'}" onclick="TF.openNotif(${n.id}, ${n.task_id || 'null'}, ${n.matter_id || 'null'}, ${n.callback_id || 'null'})" style="${n.kind === 'escalation' ? 'border-left:3px solid var(--danger)' : ''}">${esc(n.text)}<div class="when">${ago(n.created_at)}</div></div>`).join('') : '<div class="empty small">You’re all caught up.</div>');
  p.classList.remove('hidden');
}
async function openNotif(id, taskId, matterId, callbackId) {
  $('#notifPanel').classList.add('hidden');
  try { await api('POST', '/api/notifications/read', { ids: [id] }); } catch { /* ignore */ }
  poll();
  if (callbackId) location.hash = '#/callbacks/' + callbackId; else if (taskId) openTask(taskId); else if (matterId) location.hash = '#/matters/' + matterId; else location.hash = '#/matters';
}
async function readAll() { try { await api('POST', '/api/notifications/read', {}); $('#notifPanel').classList.add('hidden'); poll(); } catch (e) { errToast(e); } }

/* ---------------- polling ---------------- */
let pollTimer = null;
function startPolling() { stopPolling(); poll(); pollTimer = setInterval(poll, 20000); }
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
async function poll() {
  if (!S.me) return;
  try {
    const r = await api('GET', '/api/poll');
    const c = $('#bellCount');
    if (c) { c.textContent = r.unread > 99 ? '99+' : r.unread; c.classList.toggle('hidden', !r.unread); }
    document.title = (r.unread ? `(${r.unread}) ` : '') + 'TaskForce';
    if (window.afterPoll) afterPoll(r);
    if (S.version && r.version !== S.version) {
      const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (!$('#modal') && !typing) {
        try { S.matters = await api('GET', '/api/matters?status=all&brief=1'); } catch { /* ignore */ }
        if (window.loadPeopleDates) { await loadPeopleDates(); refreshTime(); }
        if (!document.querySelector('.tcard.dragging, .oc-dragging, .oc-preview')) { S.calKeepScroll = true; refreshView(); }
        if ($('#drawer') && S.drawerTaskId) { try { drawDrawer(await api('GET', '/api/tasks/' + S.drawerTaskId)); } catch { closeDrawer(); } }
      } else return; // try again next poll
    }
    S.version = r.version;
  } catch { /* offline - try again */ }
}

/* ---------------- admin ---------------- */
async function renderAdmin(tab) {
  if (S.me.role !== 'admin') { location.hash = '#/board'; return; }
  const main = $('#main');
  const tabs = `<div class="tabs">${[['users', 'Staff'], ['checklists', 'Checklist library'], ['time', 'Holidays & time'], ['email', 'Email alerts'], ['backup', 'Backups']].map(([k, l]) => `<a href="#/admin/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  if (tab === 'users') {
    try { S.users = await api('GET', '/api/users'); } catch (e) { return errToast(e); }
    main.innerHTML = tabs + `<div class="toolbar"><span class="sec">Everyone here can sign in, see all tasks and assign work. Admins can also manage staff and settings.</span><span class="spacer"></span><button class="primary" onclick="TF.userForm()">+ Add staff member</button></div>
    <table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th title="Can see tax jobs, their tasks and the taxation library">Taxation</th><th>Status</th><th></th></tr></thead><tbody>
    ${S.users.map(u => `<tr onclick="TF.userForm(${u.id})"><td><span class="row" style="gap:8px">${avatar(u.id)} ${esc(u.name)}</span></td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? 'Admin' : 'Staff'}</td><td>${u.role === 'admin' ? '<span class="muted small">Always (admin)</span>' : u.tax_access ? '<span class="pill p-magenta">🔒 Yes</span>' : '<span class="muted small">No</span>'}</td><td>${u.active ? '<span class="pill p-green">Active</span>' : '<span class="pill p-gray">Disabled</span>'}</td><td><button class="sm">Edit</button></td></tr>`).join('')}
    </tbody></table>`;
  } else if (tab === 'checklists') {
    return renderAdminChecklists(tabs);
  } else if (tab === 'time') {
    return renderAdminTime(tabs);
  } else if (tab === 'email') {
    let s;
    try { s = await api('GET', '/api/settings'); } catch (e) { return errToast(e); }
    main.innerHTML = tabs + `<div class="card" style="max-width:720px"><form id="emForm">
      <h2>Firm and link</h2>
      <div class="grid2"><label class="f">Firm name<input name="firm_name" value="${esc(s.firm_name)}"></label>
      <label class="f">TaskForce address staff use<input name="app_url" value="${esc(s.app_url)}" placeholder="http://OFFICE-PC:3000"></label></div>
      <p class="muted small" style="margin-top:-4px">Used for the “Open in TaskForce” button in emails.</p>
      <h2 style="margin-top:18px">Email server (SMTP)</h2>
      <p class="sec small">Emails are sent when someone is assigned a task, mentioned in a note, or a task becomes overdue. For Microsoft 365 use smtp.office365.com, port 587. For Gmail / Google Workspace use smtp.gmail.com, port 587 with an app password.</p>
      <div class="grid3"><label class="f">SMTP server<input name="smtp_host" value="${esc(s.smtp_host)}" placeholder="smtp.office365.com"></label>
      <label class="f">Port<input name="smtp_port" value="${esc(s.smtp_port || '587')}"></label>
      <label class="f">Security<select name="smtp_secure"><option value="0" ${s.smtp_secure !== '1' ? 'selected' : ''}>STARTTLS (587)</option><option value="1" ${s.smtp_secure === '1' ? 'selected' : ''}>SSL (465)</option></select></label></div>
      <div class="grid3"><label class="f">Username<input name="smtp_user" value="${esc(s.smtp_user)}" autocomplete="off"></label>
      <label class="f">Password ${s.smtp_pass_set ? '<span class="muted">(saved)</span>' : ''}<input name="smtp_pass" type="password" placeholder="${s.smtp_pass_set ? 'Leave blank to keep' : ''}" autocomplete="new-password"></label>
      <label class="f">Send from<input name="smtp_from" value="${esc(s.smtp_from)}" placeholder="TaskForce &lt;noreply@firm.com.au&gt;"></label></div>
      ${s.login_codes_supported ? `<h2 style="margin-top:18px">Signing in</h2>
      <p class="sec small">Emailed codes use the email server above. Until it’s set up and working, everyone signs in with their password.</p>
      <label class="f">How staff sign in<select name="login_mode">
        ${[['either', 'Password, or a code emailed to them (their choice)'], ['code', 'A code emailed to them – no passwords'], ['both', 'Password, then a code emailed to them (two-step, most secure)'], ['password', 'Password only']].map(([k, l]) => `<option value="${k}" ${s.login_mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="muted small" style="margin-top:-6px">In force now: <b>${esc({ either: 'password or emailed code', code: 'emailed code', both: 'password + emailed code', password: 'password only' }[s.login_mode_active] || s.login_mode_active)}</b>. Send yourself a test email before switching to code-only or two-step.</p>` : ''}
      <div class="err" id="emErr"></div>
      <div class="row"><button class="primary">Save</button><button type="button" onclick="TF.testEmail()">Send me a test email</button></div>
    </form></div>`;
    $('#emForm').onsubmit = async e => {
      e.preventDefault();
      try { await api('PUT', '/api/settings', Object.fromEntries(new FormData(e.target))); toast('Settings saved'); S.firm = e.target.firm_name.value; renderAdmin('email'); }
      catch (err) { $('#emErr').textContent = err.message; }
    };
  } else if (tab === 'backup') {
    let s;
    try { s = await api('GET', '/api/settings'); } catch (e) { return errToast(e); }
    main.innerHTML = tabs + `<div class="card" style="max-width:720px"><form id="bkForm">
      <h2>Nightly backup</h2>
      <p class="sec small">${s.storage_mode === 'supabase' ? 'Each night TaskForce saves a database backup and copies its attached files into private Supabase storage.' : 'Each night TaskForce copies its database and every attached file into a dated folder. Pointing this at a Google Drive or OneDrive folder gives you an off-site copy.'}</p>
      <label class="f">Backup folder<input name="backup_dir" value="${esc(s.backup_dir)}" placeholder="${esc(s.default_backup_dir)}"></label>
      <p class="muted small" style="margin-top:-6px">${s.storage_mode === 'supabase' ? 'Cloud backups are stored in the private bucket under backups/.' : 'For example: G:\\My Drive\\TaskForce Backups. Leave blank to use ' + esc(s.default_backup_dir)}</p>
      <div class="grid2"><label class="f">Time<input type="time" name="backup_time" value="${esc(s.backup_time || '22:00')}"></label>
      <label class="f">Keep this many backups<input type="number" min="1" name="backup_keep" value="${esc(s.backup_keep || '14')}"></label></div>
      <p class="small">Last backup: ${s.last_backup ? esc(s.last_backup) : '<span class="muted">none yet</span>'}</p>
      <div class="row"><button class="primary">Save</button><button type="button" onclick="TF.backupNow()">Back up now</button></div>
    </form></div>`;
    $('#bkForm').onsubmit = async e => {
      e.preventDefault();
      try { await api('PUT', '/api/settings', Object.fromEntries(new FormData(e.target))); toast('Backup settings saved'); } catch (err) { errToast(err); }
    };
  }
}
function userForm(id) {
  const used = S.users.map(x => x.color);
  const u = id ? user(id) : { name: '', email: '', role: 'staff', color: COLORS.find(c => !used.includes(c)) || 'blue', active: true };
  openModal(`<h2>${id ? 'Edit ' + esc(u.name) : 'Add staff member'}</h2>
  <form id="uForm">
    <div class="grid2"><label class="f">Name<input name="name" required value="${esc(u.name)}"></label>
    <label class="f">Email (used to sign in)<input name="email" type="email" required value="${esc(u.email)}"></label>
    <label class="f">Role<select name="role"><option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Staff</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></label>
    <label class="f">Colour<select name="color">${COLORS.map(c => `<option value="${c}" ${u.color === c ? 'selected' : ''}>${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select></label></div>
    <label class="row small" style="gap:8px;margin:2px 0 12px"><input type="checkbox" name="tax_access" ${u.tax_access ? 'checked' : ''} style="width:auto;height:auto"> <span><b>🔒 Taxation access</b> – can see tax jobs, their tasks and call-backs, and the taxation library. Admins always can.</span></label>
    <label class="f">${id ? 'Reset password (leave blank to keep)' : 'Starting password (8+ characters)'}<input name="password" type="text" ${id ? '' : 'required minlength="8"'} autocomplete="off"></label>
    ${id ? `<label class="row small" style="gap:8px"><input type="checkbox" name="active" ${u.active ? 'checked' : ''} style="width:auto;height:auto"> Can sign in</label>` : '<p class="muted small">Give them this password. They can change it under My account.</p>'}
    <div class="err" id="uErr"></div>
    <div class="foot"><button type="button" onclick="TF.closeModal()">Cancel</button><button class="primary">${id ? 'Save' : 'Add'}</button></div>
  </form>`);
  $('#uForm').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (id) fd.active = !!e.target.active.checked;
    fd.tax_access = !!e.target.tax_access.checked;
    if (!fd.password) delete fd.password;
    try {
      await api(id ? 'PUT' : 'POST', '/api/users' + (id ? '/' + id : ''), fd);
      closeModal(); toast(id ? 'Saved' : 'Staff member added');
      S.users = await api('GET', '/api/users');
      if (id === S.me.id) { const me = await api('GET', '/api/me'); S.me = me.user; renderShell(); }
      renderAdmin('users');
    } catch (err) { $('#uErr').textContent = err.message; }
  };
}
function account() {
  $('#userMenu').classList.add('hidden');
  openModal(`<h2>My account</h2>
  <form id="accForm">
    <label class="f">Name<input name="name" value="${esc(S.me.name)}"></label>
    <label class="row small" style="gap:8px;margin-bottom:14px"><input type="checkbox" name="email_alerts" ${S.me.email_alerts ? 'checked' : ''} style="width:auto;height:auto"> Email me when I’m assigned a task, mentioned, or a task is overdue</label>
    <h3>Change password</h3>
    <div class="grid2"><label class="f">Current password<input type="password" name="current_password" autocomplete="current-password"></label>
    <label class="f">New password<input type="password" name="new_password" autocomplete="new-password" minlength="8"></label></div>
    <h3 style="margin-top:16px">Pop-up alerts on this PC</h3>
    <p class="sec small" style="margin-top:-4px">Shows a Windows pop-up when a call-back or task is passed to you, even when TaskForce is in a background tab.</p>
    <button type="button" class="sm" onclick="TF.enableDesktop()">${typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'Pop-ups are on ✓' : 'Turn on pop-ups'}</button>
    ${openerSetupHTML()}
    <div class="err" id="accErr"></div>
    <div class="foot"><button type="button" onclick="TF.closeModal()">Cancel</button><button class="primary">Save</button></div>
  </form>`);
  $('#accForm').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.email_alerts = e.target.email_alerts.checked;
    try {
      const r = await api('PUT', '/api/me', fd);
      S.me = r.user; S.users = await api('GET', '/api/users');
      closeModal(); toast('Saved'); renderShell(); route();
    } catch (err) { $('#accErr').textContent = err.message; }
  };
}

/* ---------------- public actions ---------------- */
window.TF = {
  openTask, closeDrawer: s => closeDrawer(s), newTask, setTask, postNote, closeModal, userForm, account, toggleNotifs, openNotif, readAll,
  viewEmail,
  download(id, inline) {
    if (window.TF_LOCAL) return window.TF_LOCAL.download(id, inline);
    if (inline) window.open(`/api/attachments/${id}?inline=1`, '_blank'); else location.href = `/api/attachments/${id}`;
  },
  toggleUserMenu(e) { e.stopPropagation(); $('#userMenu').classList.toggle('hidden'); },
  toggleNav(e) { e.stopPropagation(); $('#mainNav').classList.toggle('open'); },
  async logout() { try { await api('POST', '/api/logout'); } catch { /* ignore */ } S.me = null; location.hash = ''; renderLogin(S.firm); },
  setScope(k) { const f = getFilter(); f.scope = k; store('filter', f); refreshView(); },
  setPerson(v) { const f = getFilter(); f.person = v; store('filter', f); refreshView(); },
  showAllDone() { S.showDoneAll = true; refreshView(); },
  sortList(k) { S.listSort = S.listSort.key === k ? { key: k, dir: -S.listSort.dir } : { key: k, dir: 1 }; refreshView(); },
  setListF(k, v) { const f = store('listf') || { status: 'open', priority: '', q: '' }; f[k] = v; store('listf', f); refreshView(); },
  setMatterF(k, v) { const f = store('matterf') || { status: 'active', type: '', q: '' }; f[k] = v; store('matterf', f); refreshView(); },
  matterType(k) {
    const f = store('matterf') || { status: 'active', q: '' };
    let types = Array.isArray(f.types) ? f.types : (f.type ? [f.type] : []);
    types = !k ? [] : types.includes(k) ? types.filter(x => x !== k) : [...types, k];
    f.types = types; delete f.type; store('matterf', f); refreshView();
  },
  setSettleWeeks(w) { S.settleWeeks = w; refreshView(); },
  async matterStatus(id, status) { try { await api('PUT', '/api/matters/' + id, { status }); S.matters = await api('GET', '/api/matters?status=all&brief=1'); toast('Matter marked ' + status); refreshView(); } catch (e) { errToast(e); } },
  async deleteMatter(id) {
    if (!(await askConfirm('Delete this matter?', 'All of its tasks and attachments are deleted too. This can’t be undone.'))) return;
    try { await api('DELETE', '/api/matters/' + id); S.matters = await api('GET', '/api/matters?status=all&brief=1'); toast('Matter deleted'); location.hash = '#/matters'; } catch (e) { errToast(e); }
  },
  async deleteTask(id) {
    if (!(await askConfirm('Delete this task?', 'Its notes and attachments are deleted too.'))) return;
    try { await api('DELETE', '/api/tasks/' + id); toast('Task deleted'); closeDrawer(); } catch (e) { errToast(e); }
  },
  async checkItem(id, done) { try { drawDrawer(await api('PUT', '/api/checklist/' + id, { done })); } catch (e) { errToast(e); } },
  async delCheck(id) { try { drawDrawer(await api('DELETE', '/api/checklist/' + id)); } catch (e) { errToast(e); } },
  async delNote(id) { if (!(await askConfirm('Delete this note?'))) return; try { drawDrawer(await api('DELETE', '/api/notes/' + id)); } catch (e) { errToast(e); } },
  async delAttachment(id) { if (!(await askConfirm('Remove this attachment?', '', 'Remove'))) return; try { drawDrawer(await api('DELETE', '/api/attachments/' + id)); } catch (e) { errToast(e); } },
  insertMention(name) { const ta = $('#dNote'); ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + '@' + name + ' '; ta.focus(); },
  async testEmail() { try { const r = await api('POST', '/api/settings/test-email'); toast('Test email sent to ' + r.to); } catch (e) { errToast(e); } },
  async backupNow() { try { const r = await api('POST', '/api/backup'); toast('Backup saved'); renderAdmin('backup'); } catch (e) { errToast(e); } },
};

