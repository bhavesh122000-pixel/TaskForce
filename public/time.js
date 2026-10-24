/* TaskForce – clock in / out, regular "what have you worked on?" check-ins, timesheets, leave and public holidays */
'use strict';

S.time = null;          // my clock status from the server
S.holidays = [];        // public holidays (loaded once, refreshed when they change)
S.leave = [];           // leave around now, for everyone
let timeTimer = null, snoozeUntil = 0, promptOpen = false;

const fmtMins = m => { m = Math.max(0, Math.round(m || 0)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h}h${r ? ' ' + r + 'm' : ''}` : `${r}m`; };
const tOf = s => (s || '').slice(11, 16);
const dtOf = s => { const [d, t = '00:00'] = String(s).split(' '); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, h, mi); };
const LEAVE_PART = { '': 'All day', am: 'Morning', pm: 'Afternoon' };

async function loadPeopleDates() {
  try {
    const [h, l] = await Promise.all([api('GET', `/api/holidays?from=${todayStr(-400)}&to=${todayStr(2200)}`), api('GET', `/api/leave?from=${todayStr(-120)}&to=${todayStr(500)}`)]);
    S.holidays = h; S.leave = l;
  } catch { /* keep what we had */ }
}
const holidaysOn = d => S.holidays.filter(h => h.date === d);
const fullHoliday = d => S.holidays.find(h => h.date === d && !h.part_from);
const leaveOn = (d, uid) => S.leave.filter(l => l.start_date <= d && l.end_date >= d && (uid == null || l.user_id === uid));

/* ---------------- clock widget in the top bar ---------------- */
function clockHTML() {
  const t = S.time;
  if (!t) return '';
  if (!t.open) return `<button class="clock-btn" onclick="TF.clockMenu(event)" title="Clock in when you start work">⏱<span class="btn-label"> Clock in</span></button>`;
  const mins = Math.round((Date.now() - dtOf(t.open.clock_in)) / 60000);
  return `<button class="clock-btn on ${t.stale ? 'stale' : ''}" onclick="TF.clockMenu(event)" title="Clocked in at ${fmtTime(tOf(t.open.clock_in))}${t.stale ? ' on ' + fmtDate(t.open.clock_in.slice(0, 10)) : ''}"><span class="clock-dot"></span><span class="btn-label">In · </span>${fmtMins(mins)}</button>`;
}
function drawClock() { const box = $('#clockBox'); if (box) box.innerHTML = clockHTML(); }
async function refreshTime() { try { S.time = await api('GET', '/api/time/status'); } catch { /* offline */ } drawClock(); }

function startTimeWatch() {
  clearInterval(timeTimer);
  refreshTime().then(() => { if (S.time && S.time.stale) staleClockOut(); });
  timeTimer = setInterval(checkinDue, 30000);
}
// time to ask "what have you worked on?"
function checkinDue() {
  drawClock();
  const t = S.time;
  if (!t || !t.open || t.stale || !t.interval || promptOpen) return;
  if (Date.now() < snoozeUntil) return;
  const mins = (Date.now() - dtOf(t.since)) / 60000;
  if (mins < t.interval) return;
  const busy = $('#modal') || $('.dlg') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
  if (busy) return; // ask again in 30 s
  refreshTime().then(() => checkinPrompt('checkin'));
  if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification('TaskForce check-in', { body: `What have you worked on since ${fmtTime(tOf(t.since))}?` }); } catch { /* ignore */ }
  }
}

// The check-in / clock-out box: a note plus one-click suggestions from what they touched in TaskForce
function checkinPrompt(kind, opts = {}) {
  const t = S.time || {};
  const since = t.since ? fmtTime(tOf(t.since)) : '';
  const clockOut = kind === 'clockout';
  promptOpen = true;
  openModal(`<h2>${clockOut ? (opts.stale ? 'You didn’t clock out' : 'Clock out') : 'What have you worked on?'}</h2>
    <p class="sec" style="margin-top:-6px">${opts.stale ? `You’re still clocked in from <b>${fmtDate(t.open.clock_in.slice(0, 10))}</b> (started ${fmtTime(tOf(t.open.clock_in))}). When did you finish that day?` : clockOut ? `Before you go – what have you done since ${since}?` : `Since ${since}${t.interval ? ` · TaskForce asks every ${fmtMins(t.interval)}` : ''}.`}</p>
    ${opts.stale ? `<label class="f">Finished at<input type="time" id="ciAt" value="17:00" step="300"></label>` : ''}
    ${t.touched && t.touched.length && !opts.stale ? `<div class="small sec" style="margin-bottom:4px">You worked on these in TaskForce – click to add:</div><div class="ci-sugg">${t.touched.map((x, i) => `<span class="chip" data-i="${i}">${esc(x.label)}</span>`).join('')}</div>` : ''}
    <textarea id="ciText" rows="5" placeholder="${clockOut ? 'e.g. Finished Form 1 review for BC1806, sent adjustment statement for BC1811' : 'e.g. Called the bank about BC1806 discharge, prepared adjustment statement for BC1811'}"></textarea>
    <div class="err" id="ciErr"></div>
    <div class="foot">${clockOut ? '' : '<button type="button" id="ciSnooze">Remind me in 10 min</button><span class="spacer"></span>'}
      ${clockOut && !opts.stale ? '<button type="button" onclick="TF.closeModal()">Cancel</button>' : ''}
      <button class="primary" id="ciSave">${clockOut ? 'Clock out' : 'Save'}</button></div>`);
  const picked = new Set();
  $$('.ci-sugg .chip').forEach(c => c.onclick = () => {
    const x = t.touched[+c.dataset.i]; if (!x) return;
    c.classList.toggle('on');
    const ta = $('#ciText');
    if (c.classList.contains('on')) { if (x.task_id) picked.add(x.task_id); ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + x.label; }
    else { if (x.task_id) picked.delete(x.task_id); ta.value = ta.value.split('\n').filter(l => l !== x.label).join('\n'); }
  });
  const done = () => { promptOpen = false; };
  const ov = $('#modalOv'); if (ov) ov.onclick = () => { if (!clockOut) { snoozeUntil = Date.now() + 10 * 60000; } closeModal(); done(); };
  if ($('#ciSnooze')) $('#ciSnooze').onclick = () => { snoozeUntil = Date.now() + 10 * 60000; closeModal(); done(); toast('I’ll ask again in 10 minutes'); };
  $('#ciSave').onclick = async () => {
    const text = $('#ciText').value.trim();
    try {
      if (clockOut) {
        const at = opts.stale ? `${t.open.clock_in.slice(0, 10)} ${$('#ciAt').value || '17:00'}` : undefined;
        S.time = await api('POST', '/api/time/clock-out', { text, task_ids: [...picked], at });
        toast(opts.stale ? 'Clocked out of ' + fmtDate(t.open.clock_in.slice(0, 10)) : 'Clocked out – see you next time');
      } else {
        if (!text) { $('#ciErr').textContent = 'Write a line about what you worked on, or choose “Remind me in 10 min”.'; return; }
        S.time = await api('POST', '/api/time/log', { text, task_ids: [...picked] });
        toast('Saved to your timesheet');
      }
      closeModal(); done(); drawClock();
      if (location.hash.startsWith('#/time')) renderTime();
    } catch (e) { $('#ciErr').textContent = e.message; }
  };
  setTimeout(() => $('#ciText') && $('#ciText').focus(), 50);
}
function staleClockOut() { checkinPrompt('clockout', { stale: true }); }
function stopTimeWatch() { clearInterval(timeTimer); timeTimer = null; S.time = null; }

/* ---------------- Time page: timesheets + leave ---------------- */
async function renderTime() {
  const main = $('#main');
  const tf = store('timef') || {};
  const wk = S.timeWeek || mondayOf(todayStr());
  const from = wk, to = addDaysStr(wk, 6);
  const admin = S.me.role === 'admin';
  const who = admin ? (tf.user || '') : String(S.me.id);
  let sheet, upcoming;
  try { [sheet, upcoming] = await Promise.all([api('GET', `/api/time/sheet?from=${from}&to=${to}${who ? '&user=' + who : ''}`), api('GET', `/api/leave?from=${todayStr(-1)}&to=${todayStr(400)}`)]); } catch (e) { return errToast(e); }
  S.timeSheet = sheet;
  const t = S.time || {};
  const nowIn = t.open ? `<span class="pill p-green">Clocked in since ${fmtTime(tOf(t.open.clock_in))}</span> <span class="muted small">today ${fmtMins(t.today_minutes)}</span>` : `<span class="pill p-gray">Clocked out</span>${t.today_minutes ? ` <span class="muted small">today ${fmtMins(t.today_minutes)}</span>` : ''}`;
  const dayRows = u => {
    const rows = [];
    for (let d = from; d <= to; d = addDaysStr(d, 1)) {
      const day = u.days.find(x => x.date === d);
      const hol = sheet.holidays.filter(h => h.date === d);
      if (!day && !hol.length && [0, 6].includes(parseD(d).getDay())) continue;
      const es = day ? day.entries : [];
      rows.push(`<tr class="${hol.some(h => !h.part_from) ? 'ts-hol' : ''}">
        <td class="ts-day"><b>${fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}</b>${hol.map(h => `<div class="small hol-txt">🎉 ${esc(h.name)}</div>`).join('')}${day && day.leave ? `<div class="small leave-txt">🌴 ${esc(day.leave.kind)}${day.leave.part ? ' (' + LEAVE_PART[day.leave.part].toLowerCase() + ')' : ''}</div>` : ''}</td>
        <td class="ts-times">${es.map(e => `<div class="${admin ? 'ts-edit' : ''}" ${admin ? `onclick="TF.timeEdit(${e.id})" title="Edit"` : ''}>${fmtTime(tOf(e.clock_in))} – ${e.open ? '<span class="pill p-green">now</span>' : fmtTime(tOf(e.clock_out))}${e.clock_out && e.clock_out.slice(0, 10) !== e.clock_in.slice(0, 10) ? ' <span class="muted small">(' + fmtDate(e.clock_out.slice(0, 10), { day: 'numeric', month: 'short' }) + ')</span>' : ''}</div>`).join('') || '<span class="muted">–</span>'}</td>
        <td class="ts-hours">${day && day.minutes ? fmtMins(day.minutes) : ''}</td>
        <td class="ts-logs">${day && day.logs.length ? day.logs.map(l => `<div class="ts-log"><span class="muted small">${fmtTime(tOf(l.at))}${l.kind === 'clockout' ? ' · clock-out' : ''}</span> ${esc(l.text).replace(/\n/g, '<br>')}</div>`).join('') : '<span class="muted small">No check-ins</span>'}</td></tr>`);
    }
    return rows.join('') || '<tr><td colspan="4" class="muted small">Nothing recorded this week.</td></tr>';
  };
  const people = S.users.filter(u => u.active);
  main.innerHTML = `<div class="toolbar"><h1 style="margin:0 8px 0 0">Time & leave</h1>${nowIn}<span class="spacer"></span>
      ${t.open ? '<button onclick="TF.checkinNow()">✎ Log what I’ve done</button><button onclick="TF.clockOut()">Clock out</button>' : '<button class="primary" onclick="TF.clockIn()">⏱ Clock in</button>'}
      <button onclick="TF.leaveForm()">🌴 Mark leave</button></div>
    <div class="grid-time">
      <div class="card">
        <div class="row" style="flex-wrap:wrap;margin-bottom:10px"><button class="oc-arrow" onclick="TF.timeWeek(-1)" aria-label="Previous week">‹</button><button class="oc-arrow" onclick="TF.timeWeek(1)" aria-label="Next week">›</button>
          <b>Week of ${fmtDate(from, { day: 'numeric', month: 'long', year: 'numeric' })}</b><button class="sm ghost" onclick="TF.timeWeek(0)">This week</button>
          <span class="spacer"></span>
          ${admin ? `<select style="width:auto" onchange="TF.timeUser(this.value)"><option value="">Everyone</option>${people.map(u => `<option value="${u.id}" ${String(u.id) === String(who) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
            <button class="sm" onclick="TF.timeAdd()">+ Add hours</button>` : ''}
          <button class="sm" onclick="TF.timeCsv()">⬇ Export CSV</button></div>
        ${sheet.users.map(u => `<h3 class="ts-name">${avatar(u.user_id)} ${esc(u.name)} <span class="muted small">· ${fmtMins(u.minutes)} this week</span></h3>
          <div class="tbl-wrap"><table class="tbl ts"><thead><tr><th>Day</th><th>In – out</th><th>Hours</th><th>What they worked on</th></tr></thead><tbody>${dayRows(u)}</tbody></table></div>`).join('')}
        ${admin ? '' : '<p class="muted small" style="margin-top:8px">You see your own timesheet. Admins can see everyone’s and fix times.</p>'}
      </div>
      <div class="card">
        <h3>Leave coming up</h3>
        ${upcoming.length ? upcoming.map(l => { const u = user(l.user_id); const mine = l.user_id === S.me.id || admin; return `<div class="leave-row">${avatar(l.user_id)}<div style="flex:1;min-width:0"><b>${esc(u ? u.name : '?')}</b> <span class="muted small">${esc(l.kind)}${l.part ? ' · ' + LEAVE_PART[l.part].toLowerCase() : ''}</span>
          <div class="small">${l.start_date === l.end_date ? fmtDate(l.start_date) : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`}${l.note ? ` <span class="muted">· ${esc(l.note)}</span>` : ''}</div></div>
          ${mine ? `<button class="ghost sm" onclick="TF.leaveForm(${l.id})" title="Change">✎</button><button class="ghost sm danger" onclick="TF.leaveDel(${l.id})" title="Remove">✕</button>` : ''}</div>`; }).join('') : '<p class="muted small">Nobody has leave marked.</p>'}
        <p class="muted small" style="margin-top:10px">Leave shows in everyone’s calendar so the team knows who isn’t working. Only you and admins see the type of leave and the note.</p>
        <h3 style="margin-top:16px">Next public holidays (SA)</h3>
        ${S.holidays.filter(h => h.date >= todayStr()).slice(0, 6).map(h => `<div class="small" style="padding:3px 0">🎉 <b>${fmtDate(h.date)}</b> – ${esc(h.name)}</div>`).join('')}
      </div>
    </div>`;
}

/* ---------------- leave form ---------------- */
function leaveForm(id, preset = {}) {
  const l = id ? S.leave.find(x => x.id === id) || {} : { user_id: S.me.id, start_date: preset.date || todayStr(1), end_date: preset.date || todayStr(1), kind: 'Annual leave', part: '', note: '', ...preset };
  const admin = S.me.role === 'admin';
  openModal(`<h2>${id ? 'Change leave' : 'Mark leave'}</h2>
    <p class="sec small" style="margin-top:-6px">The team sees that you’re away in the calendar. Only you and admins see the type and note.</p>
    <form id="lvForm">
      ${admin && !id ? `<label class="f">Who<select name="user_id">${userOptions(l.user_id || S.me.id, false)}</select></label>` : ''}
      <div class="grid2"><label class="f">First day<input type="date" name="start_date" required value="${esc(l.start_date || '')}"></label>
      <label class="f">Last day<input type="date" name="end_date" required value="${esc(l.end_date || '')}"></label></div>
      <div class="grid2"><label class="f">Type<select name="kind">${TFW.LEAVE_KINDS.map(k => `<option ${k === l.kind ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
      <label class="f">Part of the day <span class="muted">(one day only)</span><select name="part">${Object.entries(LEAVE_PART).map(([k, v]) => `<option value="${k}" ${k === (l.part || '') ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <label class="f">Note <span class="muted">(optional)</span><input name="note" value="${esc(l.note || '')}" maxlength="300"></label>
      <div class="err" id="lvErr"></div>
      <div class="foot"><button type="button" onclick="TF.closeModal()">Cancel</button><button class="primary">${id ? 'Save' : 'Mark leave'}</button></div>
    </form>`);
  const f = $('#lvForm');
  f.start_date.onchange = () => { if (!f.end_date.value || f.end_date.value < f.start_date.value) f.end_date.value = f.start_date.value; };
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    try {
      if (id) await api('PUT', '/api/leave/' + id, fd);
      else {
        const r = await api('POST', '/api/leave', fd);
        if (r.clash) toast(`Leave marked. ${r.clash} open task${r.clash === 1 ? ' is' : 's are'} due while away – you may want to pass ${r.clash === 1 ? 'it' : 'them'} on.`, true);
        else toast('Leave marked');
      }
      closeModal(); await loadPeopleDates(); refreshView();
    } catch (err) { $('#lvErr').textContent = err.message; }
  };
}

/* ---------------- admin: holidays & check-ins ---------------- */
async function renderAdminTime(tabs) {
  const main = $('#main');
  let s, hols;
  try { [s, hols] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/holidays')]); } catch (e) { return errToast(e); }
  const years = [...new Set(hols.map(h => h.date.slice(0, 4)))].sort();
  main.innerHTML = tabs + `<div class="card" style="max-width:820px;margin-bottom:12px"><h2>Check-ins</h2>
      <p class="sec small">While someone is clocked in, TaskForce asks what they’ve worked on at this interval. They can pick from the tasks they touched or type a line. Their answers go on their timesheet.</p>
      <label class="f" style="max-width:320px">Ask every<select id="ciEvery">${TFW.CHECKIN_CHOICES.map(v => `<option value="${v}" ${String(v) === String(s.checkin_minutes) ? 'selected' : ''}>${v ? fmtMins(v) : 'Never (only at clock-out)'}</option>`).join('')}</select></label></div>
    <div class="card" style="max-width:820px"><div class="row" style="flex-wrap:wrap"><h2 style="margin:0">Public holidays – South Australia</h2><span class="spacer"></span></div>
      <p class="sec small">From the <i>Public Holidays Act 2023 (SA)</i>, checked against SafeWork SA’s published dates for 2025–2028. Later years are worked out from the Act, so check them when SafeWork SA publishes the official list, and add any day the Governor proclaims. A new year is added automatically each year, so the calendar always covers 5 years ahead. Stage and milestone due dates skip full-day holidays.</p>
      <form id="holForm" class="row" style="flex-wrap:wrap;gap:8px;margin:8px 0 14px"><input type="date" name="date" required style="width:160px"><input name="name" required placeholder="Name, e.g. Proclaimed holiday" style="max-width:260px">
        <select name="part_from" style="width:auto"><option value="">All day</option><option value="19:00">From 7pm</option><option value="12:00">From midday</option></select><button class="primary sm">Add holiday</button></form>
      ${years.map(y => `<details class="hol-year" ${y === String(new Date().getFullYear()) || y === String(new Date().getFullYear() + 1) ? 'open' : ''}><summary><b>${y}</b> <span class="muted small">${hols.filter(h => h.date.startsWith(y)).length} days</span></summary>
        ${hols.filter(h => h.date.startsWith(y)).map(h => `<div class="row hol-row"><span style="width:150px">${fmtDate(h.date)}</span><span style="flex:1">${esc(h.name)}${h.part_from ? ` <span class="pill p-gray">from ${fmtTime(h.part_from)}</span>` : ''}${h.source === 'admin' ? ' <span class="pill p-blue">added</span>' : ''}</span><button class="ghost sm danger" onclick="TF.holDel(${h.id})" title="Remove">✕</button></div>`).join('')}</details>`).join('')}
    </div>`;
  $('#ciEvery').onchange = async e => { try { await api('PUT', '/api/settings', { checkin_minutes: e.target.value }); toast('Saved'); refreshTime(); } catch (err) { errToast(err); } };
  $('#holForm').onsubmit = async e => { e.preventDefault(); try { await api('POST', '/api/holidays', Object.fromEntries(new FormData(e.target))); toast('Holiday added'); await loadPeopleDates(); renderAdmin('time'); } catch (err) { errToast(err); } };
}

/* ---------------- "today" strip on the Board ---------------- */
function todayStripHTML() {
  const d = todayStr(), hol = holidaysOn(d), away = leaveOn(d);
  const tomorrowHol = holidaysOn(todayStr(1)).filter(h => !h.part_from);
  if (!hol.length && !away.length && !tomorrowHol.length) return '';
  return `<div class="today-strip">${hol.map(h => `<span>🎉 <b>Today:</b> ${esc(h.name)}${h.part_from ? '' : ' – public holiday'}</span>`).join('')}
    ${tomorrowHol.map(h => `<span>🎉 Tomorrow: ${esc(h.name)} – public holiday</span>`).join('')}
    ${away.length ? `<span>🌴 <b>Away today:</b> ${away.map(l => `${esc((user(l.user_id) || {}).name || '?')}${l.part ? ' (' + LEAVE_PART[l.part].toLowerCase() + ')' : ''}`).join(', ')}</span>` : ''}</div>`;
}

Object.assign(window.TF, {
  async clockIn() { try { S.time = await api('POST', '/api/time/clock-in'); drawClock(); toast(`Clocked in at ${fmtTime(tOf(S.time.open.clock_in))}`); if (location.hash.startsWith('#/time')) renderTime(); } catch (e) { errToast(e); } },
  async clockOut() { await refreshTime(); if (S.time && S.time.open) checkinPrompt('clockout', { stale: S.time.stale }); },
  async checkinNow() { await refreshTime(); checkinPrompt('checkin'); },
  clockMenu(e) {
    e.stopPropagation();
    const old = $('#clockMenu'); if (old) { old.remove(); return; }
    const t = S.time || {};
    const m = document.createElement('div'); m.className = 'menu'; m.id = 'clockMenu';
    m.innerHTML = t.open ? `<div style="padding:10px 14px;border-bottom:1px solid var(--border)"><b>Clocked in</b><div class="muted small">since ${fmtTime(tOf(t.open.clock_in))}${t.stale ? ' on ' + fmtDate(t.open.clock_in.slice(0, 10)) : ''} · today ${fmtMins(t.today_minutes)}</div></div>
      <div class="mi" data-a="log">✎ Log what I’ve done</div><div class="mi" data-a="out">Clock out</div><div class="mi" data-a="sheet">My timesheet & leave</div>`
      : `<div class="mi" data-a="in">⏱ Clock in now</div><div class="mi" data-a="sheet">My timesheet & leave</div><div class="mi" data-a="leave">🌴 Mark leave</div>`;
    $('#clockBox').appendChild(m);
    m.onclick = ev => { const a = (ev.target.closest('.mi') || {}).dataset; if (!a) return; m.remove(); ({ in: TF.clockIn, out: TF.clockOut, log: TF.checkinNow, sheet: () => { location.hash = '#/time'; }, leave: () => leaveForm() })[a.a](); };
    setTimeout(() => document.addEventListener('click', function close(ev) { if (!ev.target.closest('#clockMenu')) { m.remove(); document.removeEventListener('click', close); } }), 0);
  },
  leaveForm, async leaveDel(id) { if (!(await askConfirm('Remove this leave?', '', 'Remove'))) return; try { await api('DELETE', '/api/leave/' + id); await loadPeopleDates(); refreshView(); } catch (e) { errToast(e); } },
  timeWeek(dir) { S.timeWeek = dir === 0 ? mondayOf(todayStr()) : addDaysStr(S.timeWeek || mondayOf(todayStr()), dir * 7); renderTime(); },
  timeUser(v) { store('timef', { ...(store('timef') || {}), user: v }); renderTime(); },
  timeCsv() {
    const sh = S.timeSheet; if (!sh) return;
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['Person', 'Date', 'Clock in', 'Clock out', 'Hours', 'Leave', 'Public holiday', 'Check-ins']];
    for (const u of sh.users) for (const d of u.days) {
      const hol = sh.holidays.filter(h => h.date === d.date).map(h => h.name).join('; ');
      const logs = d.logs.map(l => `${tOf(l.at)} ${l.text.replace(/\n/g, ' / ')}`).join(' | ');
      if (!d.entries.length) rows.push([u.name, d.date, '', '', '', d.leave ? d.leave.kind : '', hol, logs]);
      d.entries.forEach((e, i) => rows.push([u.name, d.date, tOf(e.clock_in), e.clock_out ? tOf(e.clock_out) : '', (e.minutes / 60).toFixed(2), i ? '' : (d.leave ? d.leave.kind : ''), i ? '' : hol, i ? '' : logs]));
    }
    TF.saveFile(`timesheet-${sh.from}-to-${sh.to}.csv`, rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
  },
  timeEdit(id) {
    const e = S.timeSheet.users.flatMap(u => u.days.flatMap(d => d.entries)).find(x => x.id === id); if (!e) return;
    openModal(`<h2>Fix clock times</h2><p class="sec small" style="margin-top:-6px">${esc((user(e.user_id) || {}).name || '')}</p>
      <div class="grid2"><label class="f">Clocked in<input type="datetime-local" id="teIn" value="${e.clock_in.slice(0, 16).replace(' ', 'T')}"></label>
      <label class="f">Clocked out<input type="datetime-local" id="teOut" value="${e.clock_out ? e.clock_out.slice(0, 16).replace(' ', 'T') : ''}"></label></div>
      <div class="foot"><button class="danger" id="teDel">Delete</button><span class="spacer"></span><button onclick="TF.closeModal()">Cancel</button><button class="primary" id="teSave">Save</button></div>`);
    $('#teSave').onclick = async () => { try { await api('PUT', '/api/time/entries/' + id, { clock_in: $('#teIn').value, clock_out: $('#teOut').value || null }); closeModal(); renderTime(); refreshTime(); } catch (err) { errToast(err); } };
    $('#teDel').onclick = async () => { if (!(await askConfirm('Delete these hours?'))) return; try { await api('DELETE', '/api/time/entries/' + id); closeModal(); renderTime(); refreshTime(); } catch (err) { errToast(err); } };
  },
  timeAdd() {
    openModal(`<h2>Add hours</h2><p class="sec small" style="margin-top:-6px">For someone who forgot to clock in.</p>
      <label class="f">Who<select id="taUser">${userOptions(S.me.id, false)}</select></label>
      <div class="grid2"><label class="f">Clocked in<input type="datetime-local" id="taIn" value="${todayStr()}T09:00"></label><label class="f">Clocked out<input type="datetime-local" id="taOut" value="${todayStr()}T17:00"></label></div>
      <div class="foot"><button onclick="TF.closeModal()">Cancel</button><button class="primary" id="taSave">Add</button></div>`);
    $('#taSave').onclick = async () => { try { await api('POST', '/api/time/entries', { user_id: $('#taUser').value, clock_in: $('#taIn').value, clock_out: $('#taOut').value }); closeModal(); renderTime(); } catch (err) { errToast(err); } };
  },
  async holDel(id) { if (!(await askConfirm('Remove this public holiday?', 'It disappears from everyone’s calendar.', 'Remove'))) return; try { await api('DELETE', '/api/holidays/' + id); await loadPeopleDates(); renderAdmin('time'); } catch (e) { errToast(e); } },
  saveFile(name, text, type) {
    if (window.TF_LOCAL && window.TF_LOCAL.saveText) return window.TF_LOCAL.saveText(name, text, type);
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  },
});
