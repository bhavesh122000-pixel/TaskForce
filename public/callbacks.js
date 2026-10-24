/* TaskForce – call-backs: missed calls that someone needs to return */
'use strict';

const CB_RESULTS = [
  { key: 'No answer', tone: 'p-yellow' }, { key: 'Left voicemail', tone: 'p-yellow' }, { key: 'Busy / call back later', tone: 'p-yellow' },
  { key: 'Spoke – resolved', tone: 'p-green' }, { key: 'Spoke – follow-up needed', tone: 'p-blue' }, { key: 'Wrong number', tone: 'p-gray' },
];
const nowLocal = (min = 0) => { const d = new Date(Date.now() + min * 60e3); return `${dstr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const atTime = (dayOffset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return `${dstr(d)}T${pad(h)}:${pad(m)}`; };
function nextMorning() { const d = new Date(); d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); return `${dstr(d)}T09:00`; }
const WHEN_CHOICES = () => [
  ['ASAP', nowLocal(0)], ['In 30 min', nowLocal(30)], ['In 1 hour', nowLocal(60)], ['In 2 hours', nowLocal(120)],
  ['This afternoon', new Date().getHours() < 14 ? atTime(0, 14) : nowLocal(60)], ['Tomorrow 9am', nextMorning()],
];
function dueText(c) {
  if (c.status !== 'open') return '';
  if (!c.due_at) return '<span class="pill p-red">ASAP</span>';
  const due = new Date(c.due_at.replace(' ', 'T'));
  const mins = Math.round((due - Date.now()) / 60000);
  const t = due.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  const day = c.due_at.slice(0, 10) === todayStr() ? '' : fmtDate(c.due_at.slice(0, 10)) + ' ';
  if (mins < -1) { const a = -mins; return `<span class="pill p-red">${a < 60 ? a + ' min' : a < 1440 ? Math.round(a / 60) + ' h' : Math.round(a / 1440) + ' d'} overdue</span>`; }
  if (mins <= 1) return '<span class="pill p-red">Call now</span>';
  return `<span class="pill ${mins <= 30 ? 'p-yellow' : 'p-gray'}">${day}${t}</span>`;
}
const telHref = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
function cbGroup(c) {
  if (c.status !== 'open') return 'done';
  if (!c.due_at) return 'now';
  const due = new Date(c.due_at.replace(' ', 'T'));
  if (due < Date.now() - 60e3) return 'overdue';
  if (c.due_at.slice(0, 10) === todayStr()) return due - Date.now() <= 60 * 60e3 ? 'now' : 'today';
  return 'later';
}
function cbCard(c) {
  const a = user(c.assignee_id), f = user(c.for_user_id);
  return `<div class="cb-card ${c.priority === 'urgent' && c.status === 'open' ? 'urgent' : ''} ${c.status !== 'open' ? 'closed' : ''}" onclick="TF.cbOpen(${c.id})">
    <div class="cb-main">
      <div class="row" style="gap:8px;flex-wrap:wrap"><b class="cb-name">${esc(c.caller_name)}</b>${c.company ? `<span class="sec small">${esc(c.company)}</span>` : ''}
        ${c.priority === 'urgent' && c.status === 'open' ? '<span class="pill p-red">Urgent</span>' : ''}${c.matter_code ? `<a class="pill ${TYPE_PILL[c.matter_type] || 'p-gray'}" href="#/matters/${c.matter_id}" onclick="event.stopPropagation()">${esc(c.matter_code)} ${esc(TYPE_SHORT[c.matter_type] || '')}</a>` : ''}</div>
      ${c.message ? `<div class="cb-msg">${esc(c.message)}</div>` : ''}
      <div class="small muted" style="margin-top:4px">${f ? `For ${esc(f.name)}` : ''}${a ? ` · ${esc(a.name)} to call back` : ''} · logged ${ago(c.created_at)}${c.attempts ? ` · ${c.attempts} attempt${c.attempts > 1 ? 's' : ''}` : ''}${c.status !== 'open' ? ` · <b>${esc(c.outcome)}</b>` : ''}</div>
    </div>
    <div class="cb-side" onclick="event.stopPropagation()">
      ${dueText(c)}
      ${c.phone ? `<a class="btn cb-call" href="${telHref(c.phone)}" title="Call with your phone app">📞 ${esc(c.phone)}</a>` : c.email ? `<a class="btn" href="mailto:${esc(c.email)}">✉ ${esc(c.email)}</a>` : ''}
      ${c.status === 'open' ? `<div class="row" style="gap:4px"><button class="sm primary" onclick="TF.cbResult(${c.id})">Log result</button><button class="sm" onclick="TF.cbDone(${c.id})" title="Mark as done">Done</button></div>` : `<button class="sm" onclick="TF.cbReopen(${c.id})">Reopen</button>`}
    </div>
  </div>`;
}

async function renderCallbacks(openId) {
  const main = $('#main');
  const cf = store('cbf') || { scope: 'mine', q: '' };
  let list;
  try { list = await api('GET', `/api/callbacks?scope=${cf.scope}&q=${encodeURIComponent(cf.q || '')}`); } catch (e) { return errToast(e); }
  const groups = { overdue: [], now: [], today: [], later: [], done: [] };
  list.forEach(c => groups[cbGroup(c)].push(c));
  const titles = { overdue: 'Overdue', now: 'Call now', today: 'Later today', later: 'Coming up', done: 'Done' };
  const chip = (k, l) => `<span class="chip ${cf.scope === k ? 'on' : ''}" onclick="TF.cbScope('${k}')">${l}</span>`;
  main.innerHTML = `<div class="toolbar"><h1 style="margin:0 10px 0 0">Call-backs</h1>
      ${chip('mine', 'My call-backs')}${chip('forme', 'Calls for me')}${chip('all', 'Everyone’s')}${chip('done', 'Done')}
      <input style="width:220px" placeholder="Name, number or BC number" value="${esc(cf.q)}" onchange="TF.cbSearch(this.value)">
      <span class="spacer"></span><button class="primary" onclick="TF.logCall()">📞 Log a call</button></div>` +
    (list.length ? Object.keys(groups).filter(k => groups[k].length).map(k => `<div class="cb-group"><h2 class="${k === 'overdue' ? 'danger' : ''}">${titles[k]} <span class="muted">(${groups[k].length})</span></h2>${groups[k].map(cbCard).join('')}</div>`).join('')
      : `<div class="card empty">${cf.scope === 'done' ? 'No finished call-backs yet.' : 'No call-backs waiting. When you miss a call, click <b>📞 Log call</b> and choose who should ring back.'}</div>`);
  if (openId) { history.replaceState(null, '', '#/callbacks'); cbOpen(openId); }
}

// Log a new call
async function logCall(preset = {}) {
  const whens = WHEN_CHOICES();
  openModal(`<h2>Log a call to return</h2>
  <form id="cbForm" autocomplete="off">
    <div class="grid2">
      <label class="f">Who called<input name="caller_name" required autofocus list="callerList" placeholder="Name"><datalist id="callerList"></datalist></label>
      <label class="f">Phone<input name="phone" type="tel" placeholder="0400 000 000"></label>
      <label class="f">Company / role <span class="muted">(optional)</span><input name="company" placeholder="Agent – Example Realty, broker, client…"></label>
      <label class="f">Matter <span class="muted">(optional)</span><select name="matter_id">${matterOptions(preset.matter_id || null).replace('Office / no matter', 'No matter')}</select></label>
    </div>
    <label class="f">Message<textarea name="message" rows="3" placeholder="What they want, best time to call…"></textarea></label>
    <div class="grid2">
      <label class="f">The call was for<select name="for_user_id">${userOptions(preset.for_user_id || S.me.id, false)}</select></label>
      <label class="f">Who calls back<select name="assignee_id">${userOptions(preset.assignee_id || S.me.id, false)}</select></label>
    </div>
    <div class="lbl">Call back</div>
    <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:6px">${whens.map(([l, v], i) => `<span class="chip ${i === 0 ? 'on' : ''}" data-when="${v}">${l}</span>`).join('')}</div>
    <div class="row" style="margin-bottom:8px"><input type="datetime-local" name="due_at" value="${whens[0][1]}" style="max-width:230px">
      <label class="row small" style="gap:6px;margin-left:12px"><input type="checkbox" name="urgent" style="width:auto;height:auto"> Urgent</label></div>
    <div class="err" id="cbErr"></div>
    <div class="foot"><button type="button" onclick="TF.closeModal()">Cancel</button><button class="primary">Save call-back</button></div>
  </form>`);
  const form = $('#cbForm');
  $$('[data-when]', form).forEach(ch => ch.onclick = () => { $$('[data-when]', form).forEach(x => x.classList.remove('on')); ch.classList.add('on'); form.due_at.value = ch.dataset.when; });
  form.due_at.oninput = () => $$('[data-when]', form).forEach(x => x.classList.remove('on'));
  let found = [], st;
  form.caller_name.oninput = () => {
    clearTimeout(st);
    st = setTimeout(async () => {
      const q = form.caller_name.value.trim();
      const hit = found.find(c => `${c.caller_name} · ${c.phone}` === q || c.caller_name === q);
      if (hit) { form.caller_name.value = hit.caller_name; if (!form.phone.value) form.phone.value = hit.phone; if (!form.company.value) form.company.value = hit.company || ''; if (hit.matter_id && !form.matter_id.value) form.matter_id.value = hit.matter_id; return; }
      if (q.length < 2) return;
      try { found = await api('GET', '/api/callers?q=' + encodeURIComponent(q)); $('#callerList').innerHTML = found.map(c => `<option value="${esc(c.caller_name)} · ${esc(c.phone)}">`).join(''); } catch { /* ignore */ }
    }, 200);
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    fd.priority = form.urgent.checked ? 'urgent' : 'normal';
    fd.caller_name = fd.caller_name.replace(/ · .*$/, '');
    try {
      await api('POST', '/api/callbacks', fd);
      closeModal(); toast('Call-back saved');
      poll(); if (location.hash.startsWith('#/callbacks') || location.hash.startsWith('#/matters/')) refreshView();
    } catch (err) { $('#cbErr').textContent = err.message; }
  };
}

// Detail pop-up with history
async function cbOpen(id) {
  let c;
  try { c = await api('GET', '/api/callbacks/' + id); } catch (e) { return errToast(e); }
  openModal(`<div class="row" style="align-items:flex-start"><div style="flex:1"><h2 style="margin-bottom:2px">${esc(c.caller_name)}</h2><div class="sec small">${esc(c.company)}</div></div>${dueText(c)}</div>
    <div class="row" style="gap:8px;margin:10px 0;flex-wrap:wrap">
      ${c.phone ? `<a class="btn cb-call" href="${telHref(c.phone)}">📞 ${esc(c.phone)}</a>` : ''}${c.email ? `<a class="btn" href="mailto:${esc(c.email)}">✉ ${esc(c.email)}</a>` : ''}
      ${c.matter_code ? `<a class="btn" href="#/matters/${c.matter_id}" onclick="TF.closeModal()">${esc(c.matter_code)} ${esc(TYPE_SHORT[c.matter_type] || '')} ${esc(c.matter_client || '')}</a>` : ''}
      ${c.task_id ? `<button onclick="TF.closeModal();TF.openTask(${c.task_id})">Follow-up task</button>` : ''}
    </div>
    ${c.message ? `<div class="email-head" style="white-space:pre-wrap">${esc(c.message)}</div>` : ''}
    <div class="grid2" style="margin-top:6px">
      <label class="f">Who calls back<select onchange="TF.cbUpdate(${c.id}, {assignee_id: this.value})">${userOptions(c.assignee_id, false)}</select></label>
      <label class="f">Call back at<input type="datetime-local" value="${c.due_at ? c.due_at.replace(' ', 'T') : ''}" onchange="TF.cbUpdate(${c.id}, {due_at: this.value})"></label>
    </div>
    <h3>History</h3>
    <div class="timeline" style="gap:8px">${c.log.map(l => `<div class="small"><b>${esc((user(l.user_id) || { name: 'TaskForce' }).name)}</b> ${esc(l.text)} <span class="muted">· ${fmtDT(l.created_at)}</span></div>`).join('')}</div>
    <div class="row" style="margin-top:10px"><input id="cbNote" placeholder="Add a note"><button class="sm" onclick="TF.cbNote(${c.id})">Add</button></div>
    <div class="foot" style="justify-content:space-between">
      <span>${S.me.role === 'admin' || c.created_by === S.me.id ? `<button class="sm ghost danger" onclick="TF.cbDelete(${c.id})">Delete</button>` : ''}</span>
      <span class="row" style="gap:6px">${c.status === 'open' ? `<button onclick="TF.cbDone(${c.id})">Mark done</button><button class="primary" onclick="TF.cbResult(${c.id})">Log result</button>` : `<button onclick="TF.cbReopen(${c.id})">Reopen</button>`}<button onclick="TF.closeModal()">Close</button></span>
    </div>`);
  S.cb = c;
}

// Record what happened on the call
function cbResult(id) {
  openModal(`<h2>How did the call go?</h2>
    <div class="cb-results">${CB_RESULTS.map((r, i) => `<label class="cb-res"><input type="radio" name="res" value="${esc(r.key)}" ${i === 0 ? 'checked' : ''}><span class="pill ${r.tone}">${esc(r.key)}</span></label>`).join('')}</div>
    <label class="f" style="margin-top:10px">Note<textarea id="resNote" rows="2" placeholder="What was said / agreed"></textarea></label>
    <div id="retryBox"><div class="lbl">Try again</div>
      <div class="row" style="gap:6px;flex-wrap:wrap">${[['15 min', nowLocal(15)], ['30 min', nowLocal(30)], ['1 hour', nowLocal(60)], ['2 hours', nowLocal(120)], ['Tomorrow 9am', nextMorning()]].map(([l, v], i) => `<span class="chip ${i === 2 ? 'on' : ''}" data-retry="${v}">${l}</span>`).join('')}</div>
      <input type="datetime-local" id="retryAt" value="${nowLocal(60)}" style="max-width:230px;margin-top:6px"></div>
    <div id="fuBox" class="hidden"><div class="lbl" style="margin-top:6px">Follow-up task</div>
      <div class="grid3"><input id="fuTitle" placeholder="What needs doing" style="grid-column:span 3;margin-bottom:6px">
      <select id="fuWho">${userOptions(S.me.id, false)}</select><input type="date" id="fuDue" value="${todayStr(1)}"><span></span></div></div>
    <div class="err" id="resErr"></div>
    <div class="foot"><button onclick="TF.cbOpen(${id})">Back</button><button class="primary" id="resSave">Save</button></div>`);
  const m = $('#modal');
  const sync = () => {
    const v = $('input[name=res]:checked', m).value;
    $('#retryBox').classList.toggle('hidden', v.startsWith('Spoke') || v === 'Wrong number');
    $('#fuBox').classList.toggle('hidden', v !== 'Spoke – follow-up needed');
  };
  $$('input[name=res]', m).forEach(r => r.onchange = sync); sync();
  $$('[data-retry]', m).forEach(ch => ch.onclick = () => { $$('[data-retry]', m).forEach(x => x.classList.remove('on')); ch.classList.add('on'); $('#retryAt').value = ch.dataset.retry; });
  $('#resSave').onclick = async () => {
    const result = $('input[name=res]:checked', m).value;
    const body = { result, note: $('#resNote').value, next_due_at: $('#retryAt').value };
    if (result === 'Spoke – follow-up needed' && $('#fuTitle').value.trim()) Object.assign(body, { task_title: $('#fuTitle').value.trim(), task_assignee_id: $('#fuWho').value, task_due: $('#fuDue').value });
    try {
      const r = await api('POST', `/api/callbacks/${id}/attempt`, body);
      closeModal(); toast(r.callback.status === 'open' ? 'Saved – call-back moved to ' + new Date(r.callback.due_at.replace(' ', 'T')).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : r.task ? 'Done – follow-up task created' : 'Call-back done');
      poll(); refreshView();
    } catch (e) { $('#resErr').textContent = e.message; }
  };
}

// Matter page tab
function drawMatterCalls(m) {
  $('#mtab').innerHTML = `<div class="toolbar"><span class="sec small">Calls about this matter.</span><span class="spacer"></span><button class="sm primary" onclick="TF.logCall({matter_id:${m.id}})">📞 Log a call</button></div>` +
    (m.callbacks.length ? m.callbacks.map(c => cbCard({ ...c, matter_code: null })).join('') : '<div class="card empty">No calls logged for this matter.</div>');
}

// After each poll: call-back badge and desktop pop-ups
async function afterPoll(r) {
  const b = $('#cbCount');
  if (b) {
    const n = r.callbacks_due || r.callbacks_open || 0;
    b.textContent = n; b.classList.toggle('hidden', !n); b.classList.toggle('due', !!r.callbacks_due);
    b.title = `${r.callbacks_open} open, ${r.callbacks_due} due now`;
  }
  if (S.lastUnread != null && r.unread > S.lastUnread && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const list = await api('GET', '/api/notifications');
      list.filter(n => !n.read && n.id > (S.lastNotifId || 0)).slice(0, 3).forEach(n => {
        const pop = new Notification(n.kind === 'callback' ? 'Call-back' : 'TaskForce', { body: n.text, tag: 'tf' + n.id });
        pop.onclick = () => { window.focus(); TF.openNotif(n.id, n.task_id, n.matter_id, n.callback_id); pop.close(); };
      });
      if (list.length) S.lastNotifId = Math.max(S.lastNotifId || 0, ...list.map(n => n.id));
    } catch { /* ignore */ }
  }
  if (S.lastNotifId == null) { try { const list = await api('GET', '/api/notifications'); S.lastNotifId = list.length ? Math.max(...list.map(n => n.id)) : 0; } catch { S.lastNotifId = 0; } }
  S.lastUnread = r.unread;
}

Object.assign(window.TF, {
  logCall, cbOpen, cbResult,
  cbScope(k) { const f = store('cbf') || { scope: 'mine', q: '' }; f.scope = k; store('cbf', f); renderCallbacks(); },
  cbSearch(v) { const f = store('cbf') || { scope: 'mine', q: '' }; f.q = v; store('cbf', f); renderCallbacks(); },
  async cbUpdate(id, patch) { try { await api('PUT', '/api/callbacks/' + id, patch); toast('Saved'); poll(); } catch (e) { errToast(e); } },
  async cbDone(id) {
    const outcome = await askText('Mark call-back done', { text: 'What happened? (optional)', placeholder: 'Spoke to them – sorted', ok: 'Mark done' });
    if (outcome === null) return;
    try { await api('POST', `/api/callbacks/${id}/done`, { outcome }); closeModal(); toast('Call-back done'); poll(); refreshView(); } catch (e) { errToast(e); }
  },
  async cbReopen(id) { try { await api('POST', `/api/callbacks/${id}/reopen`); closeModal(); toast('Reopened'); poll(); refreshView(); } catch (e) { errToast(e); } },
  async cbNote(id) { const v = $('#cbNote').value.trim(); if (!v) return; try { await api('POST', `/api/callbacks/${id}/note`, { text: v }); cbOpen(id); } catch (e) { errToast(e); } },
  async cbDelete(id) { if (!(await askConfirm('Delete this call-back?'))) return; try { await api('DELETE', '/api/callbacks/' + id); closeModal(); poll(); refreshView(); } catch (e) { errToast(e); } },
  async enableDesktop() {
    if (typeof Notification === 'undefined') return toast('This browser doesn’t support pop-ups.', true);
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Pop-ups are on for this PC' : 'Pop-ups are blocked. Allow notifications for this site in your browser settings.', p !== 'granted');
    if (p === 'granted') new Notification('TaskForce', { body: 'Pop-ups are working.' });
  },
});
