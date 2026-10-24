/* TaskForce – Outlook-style calendar.
   Left pane: two mini months and "My Calendars" (one per person, plus matter dates, milestones and call-backs).
   Views: Day, Day by person, 3 days, Work week, Week, Month. 24-hour time grid (opens at 8 AM), full-screen mode.
   Click an item to select it, double-click to open it. Ctrl+C / Ctrl+V copies and pastes (or right-click → Copy / Paste here).
   Drag an item to move it; hold Ctrl while dragging to copy it. Drag the bottom edge of a timed task to change its length.
   Drag an item onto another person (a column in "Day by person", or a name under My Calendars) to give it to them.
   Double-click an empty day or time to create a task there. */
'use strict';

const CAL_VIEWS = [['day', 'Day'], ['people', 'Day – by person'], ['3day', '3 days'], ['workweek', 'Work week'], ['week', 'Week'], ['month', 'Month']];
const HOUR_PX = 56, SNAP = 15, DEF_LEN = 60;
const MM_DEFAULT = 26, MM_MIN = 12, MM_MAX = 44; // row height of the two month calendars on the left
const CAL_EV = new Map();

function calState() {
  const st = store('cal') || {};
  const narrow = window.innerWidth < 760;
  return {
    view: CAL_VIEWS.some(v => v[0] === st.view) ? st.view : (narrow ? 'day' : 'week'),
    date: S.calDate || todayStr(),
    hidden: new Set(Array.isArray(st.hidden) ? st.hidden : (st.dates === false ? ['dates'] : [])),
    side: narrow ? !!S.calSide : st.side !== false,
    mmh: Number.isFinite(st.mmh) ? st.mmh : MM_DEFAULT,
  };
}
function saveCal(patch) { store('cal', { ...(store('cal') || {}), ...patch }); }
function addD(s, n) { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); }
function mondayOfD(s) { const d = parseD(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dstr(d); }
function calRange(view, date) {
  if (view === 'day' || view === 'people') return [date, date];
  if (view === '3day') return [date, addD(date, 2)];
  if (view === 'workweek') { const m = mondayOfD(date); return [m, addD(m, 4)]; }
  if (view === 'week') { const m = mondayOfD(date); return [m, addD(m, 6)]; }
  const start = mondayOfD(date.slice(0, 8) + '01');
  return [start, addD(start, 41)];
}
function calTitle(view, date, from, to) {
  const full = d => parseD(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  if (view === 'month') return parseD(date).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  if (from === to) return parseD(from).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const a = parseD(from), b = parseD(to);
  if (a.getFullYear() !== b.getFullYear()) return `${full(from)} - ${full(to)}`;
  if (a.getMonth() !== b.getMonth()) return `${a.getDate()} ${a.toLocaleDateString('en-AU', { month: 'long' })} - ${full(to)}`;
  return `${a.getDate()} - ${full(to)}`;
}
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = n => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
const hourLabel = h => new Date(2000, 0, 1, h).toLocaleTimeString('en-AU', { hour: 'numeric' }).toUpperCase().replace(/\s/g, ' ');
const calPeople = st => [...S.users.filter(u => u.active && !st.hidden.has('u:' + u.id)), ...(st.hidden.has('u:0') ? [] : [{ id: 0, name: 'Unassigned', initials: '–', color: 'gray' }])];

// Everything on the calendar, as simple events
async function calEvents(from, to, st, miniFrom, miniTo) {
  const [tasks, repeating, callbacks, miles, mini] = await Promise.all([
    api('GET', `/api/tasks?from=${from}&to=${to}`),
    api('GET', '/api/tasks?repeating=1'),
    api('GET', '/api/callbacks?scope=all').catch(() => []),
    api('GET', `/api/calendar/milestones?from=${from}&to=${to}`).catch(() => []),
    api('GET', `/api/tasks?from=${miniFrom}&to=${miniTo}`).catch(() => []),
  ]);
  const seen = k => st.hidden.has(k);
  const personHidden = id => seen('u:' + (id || 0));
  const ev = [];
  const taskEv = (t, date, ghost) => {
    if (personHidden(t.assignee_id)) return;
    const u = user(t.assignee_id);
    const mt = t.matter_code ? `${t.matter_code} ${TYPE_SHORT[t.matter_type] || ''}`.trim() : '';
    const title = t.auto_kind === 'unfin' ? t.title : (mt ? mt + ' ' : '') + t.title;
    ev.push({ key: `${ghost ? 'g' : 't'}${t.id}-${date}`, kind: ghost ? 'ghost' : 'task', id: t.id, date, time: t.due_time || null, dur: t.duration || DEF_LEN, person: t.assignee_id || 0,
      title, sub: [u ? u.initials : '', t.matter_client || ''].filter(Boolean).join(' · '), unfin: t.auto_kind === 'unfin',
      color: u ? u.color : 'gray', done: t.status === 'done', att: t.attachment_count, repeat: !!t.repeat, prio: t.priority,
      tip: `${t.title}${mt ? ' – ' + mt : ''}${u ? ' – ' + u.name : ''}${ghost ? ' (upcoming repeat)' : ''}`, drag: !ghost, resize: !ghost, copy: !ghost });
  };
  tasks.forEach(t => taskEv(t, t.due_date, false));
  repeating.forEach(t => {
    let d = t.due_date, n = 0;
    while (d && n++ < 400) {
      d = TFW.nextRepeat(d, t.repeat);
      if (!d || d > to || (t.repeat_until && d > t.repeat_until)) break;
      if (d >= from) taskEv(t, d, true);
    }
  });
  if (!seen('cb')) (callbacks || []).forEach(c => {
    if (c.status !== 'open' || !c.due_at) return;
    const d = c.due_at.slice(0, 10);
    if (d < from || d > to || personHidden(c.assignee_id)) return;
    const u = user(c.assignee_id);
    ev.push({ key: 'c' + c.id, kind: 'callback', id: c.id, date: d, time: c.due_at.slice(11, 16), dur: 30, person: c.assignee_id || 0, title: `📞 ${c.caller_name}`, sub: [u ? u.initials : '', c.phone || ''].filter(Boolean).join(' · '),
      color: c.priority === 'urgent' ? 'red' : 'orange', tip: `Call back ${c.caller_name} ${c.phone || ''}`, drag: true });
  });
  if (!seen('dates')) S.matters.filter(m => m.status !== 'archived').forEach(m => {
    const nm = `${m.code} ${TYPE_SHORT[m.type] || ''} ${m.client || ''}`.trim();
    const sub = (user(m.responsible_id) || {}).initials || '';
    const tx = TFW.areaOf(m.type) === 'tax';
    if (m.settlement_date && m.settlement_date >= from && m.settlement_date <= to) ev.push({ key: 's' + m.id, kind: 'settle', id: m.id, date: m.settlement_date, time: null, person: m.responsible_id || 0, title: tx ? `🧾 Due – ${nm}` : `⚑ Settlement – ${nm}`, sub, color: tx ? 'red' : 'matter', tip: tx ? `Tax job due – ${m.name}. Drag to move the due date.` : `Settlement – ${m.name}. Drag to move the settlement date.`, drag: true });
    if (m.finance_date && m.finance_date >= from && m.finance_date <= to) ev.push({ key: 'f' + m.id, kind: 'finance', id: m.id, date: m.finance_date, time: null, person: m.responsible_id || 0, title: `$ Finance – ${nm}`, sub, color: 'matterf', tip: `Finance date – ${m.name}. Drag to move the finance date.`, drag: true });
  });
  if (!seen('ms')) {
    // one entry per matter per day; several milestones due together are grouped
    const groups = new Map();
    (miles || []).forEach(x => { const k = x.matter_id + '|' + x.due; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
    groups.forEach(list => {
      const x = list[0], open = list.filter(i => !i.done), late = open.some(i => i.overdue);
      const nm = `${x.code} ${TYPE_SHORT[x.type] || ''}`.trim();
      ev.push({ key: `m${x.matter_id}-${x.due}`, kind: 'milestone', id: x.matter_id, date: x.due, time: null, person: x.person_id || x.responsible_id || 0,
        title: list.length === 1 ? `◆ ${x.label} – ${nm}` : `◆ ${nm} – ${list.length} milestones`, sub: list.length === 1 ? (x.status || 'Not started') : list.map(i => i.label).join(', '),
        color: !open.length ? 'green' : late ? 'red' : 'violet', done: !open.length,
        tip: `${x.matter} – milestones due ${fmtDate(x.due)}:\n${list.map(i => `${i.done ? '✓' : '•'} ${i.label}${i.status ? ' (' + i.status + ')' : ''}`).join('\n')}\nDates come from the matter’s settlement / finance dates.` });
    });
  }
  if (!seen('hol')) (S.holidays || []).filter(h => h.date >= from && h.date <= to).forEach(h => ev.push({ key: 'h' + h.id, kind: 'holiday', id: h.id, date: h.date, time: null, person: null,
    title: `🎉 ${h.name}`, sub: h.part_from ? `Public holiday from ${fmtTime(h.part_from)}` : 'Public holiday', color: 'holiday', tip: `${h.name} – ${h.part_from ? 'public holiday from ' + fmtTime(h.part_from) : 'public holiday in South Australia'}` }));
  if (!seen('leave')) (S.leave || []).forEach(l => {
    if (personHidden(l.user_id)) return;
    const u = user(l.user_id);
    for (let d = l.start_date < from ? from : l.start_date; d <= l.end_date && d <= to; d = addD(d, 1)) {
      ev.push({ key: `l${l.id}-${d}`, kind: 'leave', id: l.id, date: d, time: null, person: l.user_id, title: `🌴 ${u ? u.name.split(' ')[0] : '?'} – ${l.kind === 'Leave' ? 'on leave' : l.kind.toLowerCase()}`,
        sub: l.part ? (l.part === 'am' ? 'Morning' : 'Afternoon') : 'Not working', color: u ? u.color : 'gray', tip: `${u ? u.name : ''} isn’t working${l.part ? ' in the ' + (l.part === 'am' ? 'morning' : 'afternoon') : ''} – ${l.kind}${l.note ? ' · ' + l.note : ''}` });
    }
  });
  const order = { holiday: -2, leave: -1, settle: 0, finance: 1, milestone: 2, callback: 3, task: 4, ghost: 5 };
  ev.sort((a, b) => (a.time || '').localeCompare(b.time || '') || order[a.kind] - order[b.kind] || a.title.localeCompare(b.title));
  CAL_EV.clear(); ev.forEach(e => CAL_EV.set(e.key, e));
  const busy = new Set(mini.filter(t => t.status !== 'done' && !personHidden(t.assignee_id)).map(t => t.due_date));
  return { ev, busy };
}

function evHTML(e, style = '', cls = '') {
  const sel = S.calSel && S.calSel.key === e.key ? 'oc-sel' : '';
  const cut = S.calClip && S.calClip.key === e.key ? 'oc-copied' : '';
  return `<div class="oc-ev c-${e.color} k-${e.kind} ${e.unfin ? 'unfin' : ''} ${e.done ? 'done' : ''} ${cls} ${sel} ${cut}" data-key="${esc(e.key)}" ${e.drag ? 'data-drag="1"' : ''} title="${esc(e.tip)}" style="${style}">
    <div class="oc-ev-t">${e.time && cls === 'timed' ? '' : e.time ? `<span class="oc-time">${fmtTime(e.time)}</span> ` : ''}${e.repeat ? '🔁 ' : ''}${esc(e.title)}</div>
    ${e.sub ? `<div class="oc-ev-s">${esc(e.sub)}</div>` : ''}${e.att ? '<span class="oc-att" title="Has attachments">📎</span>' : ''}
    ${e.resize && cls === 'timed' ? '<div class="oc-resize" title="Drag to change the length"></div>' : ''}</div>`;
}
// Side-by-side layout for overlapping timed items (like Outlook)
function layoutDay(list) {
  const out = [], minLen = Math.ceil(24 / HOUR_PX * 60);
  const items = list.map(e => { const s = toMin(e.time); return { e, start: s, end: Math.min(24 * 60, s + Math.max(minLen, e.dur || DEF_LEN)) }; }).sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster = [], cEnd = -1;
  const flush = () => { const cols = []; cluster.forEach(x => { let c = cols.findIndex(end => end <= x.start); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = x.end; x.col = c; }); cluster.forEach(x => { x.n = cols.length; out.push(x); }); cluster = []; cEnd = -1; };
  for (const x of items) { if (cluster.length && x.start >= cEnd) flush(); cluster.push(x); cEnd = Math.max(cEnd, x.end); }
  if (cluster.length) flush();
  return out;
}

function miniMonthHTML(month, range, busy, nav) {
  const first = month + '-01', start = mondayOfD(first), today = todayStr();
  let cells = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map(d => `<span class="mm-dow">${d}</span>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = addD(start, i);
    if (i === 35 && d.slice(0, 7) !== month) break;
    const hd = typeof fullHoliday === 'function' && fullHoliday(d);
    cells += `<span class="mm-d ${d.slice(0, 7) !== month ? 'other' : ''} ${d >= range[0] && d <= range[1] ? 'inrange' : ''} ${d === today ? 'today' : ''} ${busy.has(d) ? 'busy' : ''} ${hd ? 'hol' : ''}" ${hd ? `title="${esc(hd.name)}"` : ''} onclick="TF.calPick('${d}')">${parseD(d).getDate()}</span>`;
  }
  const title = parseD(first).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  return `<div class="mm"><div class="mm-head">${nav ? '<button class="ghost sm" onclick="TF.calMini(-1)" aria-label="Previous month">‹</button>' : '<span></span>'}<b>${title}</b>${nav ? '<button class="ghost sm" onclick="TF.calMini(1)" aria-label="Next month">›</button>' : '<span></span>'}</div><div class="mm-grid">${cells}</div></div>`;
}

async function renderCalendar() {
  const main = $('#main');
  const st = calState();
  const [from, to] = calRange(st.view, st.date);
  const miniA = S.calMiniMonth || st.date.slice(0, 7);
  const miniB = addD(miniA + '-01', 32).slice(0, 7);
  let data;
  try { data = await calEvents(from, to, st, mondayOfD(miniA + '-01'), addD(miniB + '-01', 41)); } catch (e) { return errToast(e); }
  const { ev, busy } = data;
  if (S.calSel && S.calSel.key && !CAL_EV.has(S.calSel.key)) S.calSel = null;
  const today = todayStr();
  const prevScroll = $('#ocScroll') ? $('#ocScroll').scrollTop : null;
  const viewLabel = (CAL_VIEWS.find(v => v[0] === st.view) || [])[1];
  const mmh = st.mmh;
  const cal = (key, label, sw, person) => `<label class="oc-calrow ${st.hidden.has(key) ? '' : 'on'}" ${person != null ? `data-person="${person}" title="Drag a task or call-back here to give it to ${person ? 'this person' : 'nobody'}"` : ''}><input type="checkbox" ${st.hidden.has(key) ? '' : 'checked'} onchange="TF.calToggle('${key}')"><span class="oc-sw ${sw}"></span>${label}</label>`;
  const side = `<aside class="oc-side">
      <div class="oc-side-top"><button class="ghost sm" onclick="TF.calSide(false)" title="Hide this pane" aria-label="Hide the side pane">‹</button></div>
      <div class="oc-minis ${mmh < 12 ? 'collapsed' : ''}" style="--mmh:${Math.max(12, mmh)}px">${miniMonthHTML(miniA, [from, to], busy, true)}${miniMonthHTML(miniB, [from, to], busy, false)}</div>
      <div class="oc-split" title="Drag up or down to make the month calendars smaller or bigger. Double-click to reset.">${mmh < 12 ? '<span>▾ Show month calendars</span>' : '<span class="oc-grip"></span>'}</div>
      <div class="oc-cals"><div class="oc-cals-h">▾ My Calendars</div>
        ${S.users.filter(u => u.active).map(u => cal('u:' + u.id, `${esc(u.name)} <span class="muted">(${esc(u.initials)})</span>`, 'c-' + u.color, u.id)).join('')}
        ${cal('u:0', 'Unassigned', 'c-gray', 0)}
        ${cal('dates', 'Settlement & finance dates', 'c-matter')}
        ${cal('ms', '◆ Milestones', 'c-violet')}
        ${cal('cb', '📞 Call-backs', 'c-orange')}
        ${cal('hol', '🎉 Public holidays (SA)', 'c-holiday')}
        ${cal('leave', '🌴 Leave', 'c-aqua')}
        <p class="muted small oc-tip">Drag a task onto a name to give it to that person. Click an item to select it · Ctrl+C / Ctrl+V to copy · Ctrl+drag to copy.</p>
      </div></aside>`;
  const head = `<div class="oc-top">
      ${st.side ? '' : '<button class="ghost" onclick="TF.calSide(true)" title="Show the mini calendars and My Calendars" aria-label="Show the side pane">☰</button>'}
      <button onclick="TF.calGo(0)">Today</button>
      <button class="oc-arrow" onclick="TF.calGo(-1)" aria-label="Previous">‹</button><button class="oc-arrow" onclick="TF.calGo(1)" aria-label="Next">›</button>
      <span class="oc-title">${esc(calTitle(st.view, st.date, from, to))}</span>
      <span class="spacer"></span>
      ${S.calClip ? `<span class="pill p-blue oc-clip" title="Click a day or time, then press Ctrl+V or right-click → Paste here">📋 ${esc(S.calClip.title.slice(0, 40))} <a href="javascript:TF.calClipClear()" aria-label="Clear the copied item">✕</a></span>` : '<span class="muted small oc-hint">Drag to move · Ctrl+drag to copy · double-click to add</span>'}
      <button class="ghost" onclick="TF.calFull()" title="${S.calFull ? 'Exit full screen (Esc)' : 'Full screen'}" aria-label="Full screen">${S.calFull ? '⤡' : '⤢'}</button>
      <div class="oc-viewdd"><button class="ghost" onclick="TF.calViewMenu(event)">📅 ${esc(viewLabel)} ▾</button>
        <div class="menu hidden" id="ocViewMenu">${CAL_VIEWS.map(([k, l]) => `<div class="mi ${k === st.view ? 'on' : ''}" onclick="TF.calView('${k}')">${l}</div>`).join('')}</div></div>
    </div>`;
  let body;
  if (st.view === 'month') {
    const month = st.date.slice(0, 7);
    let cells = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(d => `<div class="oc-mdow"><span class="full">${d}</span><span class="short">${d.slice(0, 3)}</span></div>`).join('');
    for (let i = 0; i < 42; i++) {
      const ds = addD(from, i), list = ev.filter(e => e.date === ds);
      const fit = 4, more = list.length > fit ? list.length - (fit - 1) : 0;
      const dt = parseD(ds);
      const selDay = S.calSel && !S.calSel.key && S.calSel.date === ds ? 'oc-slotsel' : '';
      const hd = !st.hidden.has('hol') && typeof fullHoliday === 'function' && fullHoliday(ds);
      cells += `<div class="oc-day ${ds.slice(0, 7) !== month ? 'other' : ''} ${ds === today ? 'today' : ''} ${hd ? 'oc-holiday' : ''} ${selDay}" data-date="${ds}">
        <span class="oc-dn" onclick="TF.calOpenDay('${ds}')" title="Open this day">${dt.getDate() === 1 ? dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : dt.getDate()}</span>
        ${(more ? list.slice(0, fit - 1) : list).map(e => evHTML(e, '', 'chip')).join('')}
        ${more ? `<div class="oc-more" onclick="event.stopPropagation();TF.calOpenDay('${ds}')">+${more} more</div>` : ''}</div>`;
    }
    body = `<div class="oc-month">${cells}</div>`;
  } else {
    // columns: one per day, or (Day – by person) one per person for the day
    const byPerson = st.view === 'people';
    const days = []; for (let d = from; d <= to; d = addD(d, 1)) days.push(d);
    const cols = byPerson ? calPeople(st).map(p => ({ date: from, person: p.id, p })) : days.map(d => ({ date: d, person: null }));
    const inCol = (e, c) => e.date === c.date && (c.person == null || e.kind === 'holiday' || (e.person || 0) === c.person);
    const hol = d => !st.hidden.has('hol') && typeof fullHoliday === 'function' && fullHoliday(d);
    const away = c => c.person ? (S.leave || []).some(l => l.user_id === c.person && l.start_date <= c.date && l.end_date >= c.date && !l.part) : false;
    const grid = `grid-template-columns: 58px repeat(${Math.max(1, cols.length)}, minmax(${byPerson ? 140 : 0}px, 1fr))`;
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    const colAttrs = c => `data-date="${c.date}" ${c.person != null ? `data-person="${c.person}"` : ''}`;
    const dayHead = cols.map(c => {
      if (byPerson) return `<div class="oc-dh oc-ph ${c.date === today ? 'today' : ''} ${away(c) ? 'oc-away' : ''}">${c.person ? avatar(c.person) : '<span class="av p-gray">–</span>'}<div class="oc-dname">${esc(c.p.name)}${away(c) ? ' <span class="oc-hlabel">On leave</span>' : ''}</div></div>`;
      const dt = parseD(c.date);
      const h = hol(c.date);
      return `<div class="oc-dh ${c.date === today ? 'today' : ''} ${h ? 'oc-holiday' : ''}" onclick="TF.calOpenDay('${c.date}')"><div class="oc-dname">${dt.toLocaleDateString('en-AU', { weekday: 'long' })}</div><div class="oc-dnum">${dt.getDate()}${h ? ' <span class="oc-hlabel" title="' + esc(h.name) + '">Public holiday</span>' : ''}</div></div>`;
    }).join('');
    const AD_FIT = 3;
    const allDay = cols.map(c => {
      const list = ev.filter(e => inCol(e, c) && !e.time);
      const shown = list.length > AD_FIT ? list.slice(0, AD_FIT - 1) : list;
      const selAd = S.calSel && !S.calSel.key && S.calSel.date === c.date && !S.calSel.time && (c.person == null || S.calSel.person === c.person) ? 'oc-slotsel' : '';
      return `<div class="oc-ad ${c.date === today && !byPerson ? 'today' : ''} ${hol(c.date) ? 'oc-holiday' : ''} ${away(c) ? 'oc-away' : ''} ${list.length > shown.length ? 'has-more' : ''} ${selAd}" ${colAttrs(c)}>${shown.map(e => evHTML(e, '', 'chip')).join('')}${list.length > shown.length ? `<span class="oc-plus" onclick="TF.calOpenDay('${c.date}')" title="Show all ${list.length}">+${list.length - shown.length}</span>` : ''}</div>`;
    }).join('');
    const hours = Array.from({ length: 24 }, (_, h) => `<div class="oc-hl">${h ? hourLabel(h) : ''}</div>`).join('');
    const slots = Array.from({ length: 48 }, (_, i) => `<div class="oc-slot ${i % 2 ? 'half' : ''}"></div>`).join('');
    const dayCols = cols.map(c => {
      const placed = layoutDay(ev.filter(e => inCol(e, c) && e.time));
      const evs = placed.map(x => evHTML(x.e, `top:${x.start / 60 * HOUR_PX}px;height:${(x.end - x.start) / 60 * HOUR_PX - 2}px;left:calc(${x.col / x.n * 100}% + 1px);width:calc(${100 / x.n}% - 3px)`, 'timed')).join('');
      const nowLine = c.date === today && (!byPerson || c === cols[0]) ? `<div class="oc-now" style="top:${nowMin / 60 * HOUR_PX}px"><span></span></div>` : '';
      const s = S.calSel;
      const selSlot = s && !s.key && s.time && s.date === c.date && (c.person == null || s.person === c.person) ? `<div class="oc-slotmark" style="top:${toMin(s.time) / 60 * HOUR_PX}px;height:${HOUR_PX / 2}px"></div>` : '';
      return `<div class="oc-col ${c.date === today && !byPerson ? 'today' : ''} ${hol(c.date) ? 'oc-holiday' : ''} ${away(c) ? 'oc-away' : ''}" ${colAttrs(c)}>${slots}${selSlot}${evs}${nowLine}</div>`;
    }).join('');
    const weekNow = (byPerson ? from === today : days.includes(today)) ? `<div class="oc-nowall" style="top:${nowMin / 60 * HOUR_PX}px"></div>` : '';
    body = `<div class="oc-grid ${byPerson ? 'oc-people' : ''}">
      <div class="oc-hscroll"><div class="oc-row oc-head" style="${grid}"><div class="oc-gut"></div>${dayHead}</div>
      <div class="oc-row oc-allday" style="${grid}"><div class="oc-gut small muted">All day</div>${allDay}</div></div>
      <div class="oc-scroll" id="ocScroll"><div class="oc-row oc-body" style="${grid};height:${24 * HOUR_PX}px"><div class="oc-hours">${hours}</div>${dayCols}${weekNow}</div></div>
    </div>`;
  }
  main.innerHTML = `<div class="ocal ${S.calFull ? 'oc-full' : ''} ${st.side ? '' : 'no-side'}" id="ocal">${st.side ? side : ''}<section class="oc-main">${head}${body}</section></div>`;
  const sc = $('#ocScroll');
  if (sc) {
    sc.scrollTop = prevScroll != null && S.calKeepScroll ? prevScroll : 8 * HOUR_PX - 6;
    const hs = $('.oc-hscroll'); if (hs) sc.addEventListener('scroll', () => { hs.scrollLeft = sc.scrollLeft; });
  }
  S.calKeepScroll = false;
  wireCalendar();
}

/* ---------- selecting, opening, copy & paste ---------- */
function openCalEvent(e) {
  if (e.kind === 'holiday') return toast(e.tip);
  if (e.kind === 'leave') { const l = (S.leave || []).find(x => x.id === e.id); if (l && (l.user_id === S.me.id || S.me.role === 'admin')) return TF.leaveForm(l.id); return toast(e.tip); }
  if (e.kind === 'settle' || e.kind === 'finance') location.hash = '#/matters/' + e.id;
  else if (e.kind === 'milestone') location.hash = `#/matters/${e.id}/timeline`;
  else if (e.kind === 'callback') TF.cbOpen(e.id);
  else TF.openTask(e.id);
}
function calSelect(sel) {
  S.calSel = sel;
  $$('.oc-sel').forEach(x => x.classList.remove('oc-sel'));
  $$('.oc-slotmark').forEach(x => x.remove());
  $$('.oc-slotsel').forEach(x => x.classList.remove('oc-slotsel'));
  if (!sel) return;
  if (sel.key) { const el = document.querySelector(`.oc-ev[data-key="${CSS.escape(sel.key)}"]`); if (el) el.classList.add('oc-sel'); return; }
  const pSel = sel.person != null ? `[data-person="${sel.person}"]` : '';
  if (sel.time) {
    const col = document.querySelector(`.oc-col[data-date="${sel.date}"]${pSel}`) || document.querySelector(`.oc-col[data-date="${sel.date}"]`);
    if (col) { const m = document.createElement('div'); m.className = 'oc-slotmark'; m.style.top = (toMin(sel.time) / 60 * HOUR_PX) + 'px'; m.style.height = (HOUR_PX / 2) + 'px'; col.appendChild(m); }
  } else {
    const cell = document.querySelector(`.oc-ad[data-date="${sel.date}"]${pSel}, .oc-day[data-date="${sel.date}"]`);
    if (cell) cell.classList.add('oc-slotsel');
  }
}
function slotFromEvent(e) {
  const col = e.target.closest('.oc-col'), cell = e.target.closest('.oc-ad, .oc-day');
  const person = el => el && el.dataset.person != null ? +el.dataset.person : null;
  if (col) { const mins = Math.floor((e.clientY - col.getBoundingClientRect().top) / (HOUR_PX / 2)) * 30; return { date: col.dataset.date, time: fromMin(Math.max(0, Math.min(23 * 60 + 30, mins))), person: person(col) }; }
  if (cell) return { date: cell.dataset.date, time: null, keepTime: cell.classList.contains('oc-day'), person: person(cell) };
  return null;
}
function calCopy(ev) {
  if (!ev || !ev.copy) return toast(ev ? 'Only tasks can be copied.' : 'Click a task first, then copy it.', true);
  S.calClip = { key: ev.key, id: ev.id, title: ev.title, time: ev.time, dur: ev.dur };
  toast('Copied – click a day or time, then press Ctrl+V (or right-click → Paste here)');
  S.calKeepScroll = true; renderCalendar();
}
async function calPaste(slot) {
  const c = S.calClip;
  if (!c) return toast('Copy a task first (click it, then Ctrl+C).', true);
  slot = slot || (S.calSel && !S.calSel.key ? S.calSel : null) || (S.calSel && S.calSel.key ? (() => { const e = CAL_EV.get(S.calSel.key); return e && { date: e.date, time: e.time, keepTime: true, person: null }; })() : null);
  if (!slot) return toast('Click the day or time to paste into first.', true);
  const body = { due_date: slot.date, due_time: slot.time || (slot.keepTime ? c.time : null) || null };
  if (body.due_time) body.duration = c.dur;
  if (slot.person != null) body.assignee_id = slot.person || null;
  try {
    const t = await api('POST', `/api/tasks/${c.id}/copy`, body);
    S.calSel = { key: `t${t.id}-${t.due_date}` };
    toast(`Pasted to ${fmtDate(slot.date)}${body.due_time ? ' ' + fmtTime(body.due_time) : ''}${slot.person != null ? ' · ' + ((user(slot.person) || { name: 'Unassigned' }).name) : ''}`);
  } catch (e) { errToast(e); }
  S.calKeepScroll = true; renderCalendar();
}
function calMenu(x, y, items) {
  calMenuClose();
  const m = document.createElement('div'); m.className = 'menu oc-ctx'; m.id = 'ocCtx';
  m.innerHTML = items.filter(Boolean).map((it, i) => it === '-' ? '<div class="oc-ctx-sep"></div>' : `<div class="mi ${it.off ? 'off' : ''}" data-i="${i}">${it.label}${it.key ? `<span class="muted small">${it.key}</span>` : ''}</div>`).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px'; m.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  const list = items.filter(Boolean);
  m.onclick = e => { const el = e.target.closest('.mi'); if (!el || el.classList.contains('off')) return; calMenuClose(); list[+el.dataset.i].run(); };
  setTimeout(() => document.addEventListener('pointerdown', calMenuAway), 0);
}
function calMenuAway(e) { if (!e.target.closest('#ocCtx')) calMenuClose(); }
function calMenuClose() { const m = $('#ocCtx'); if (m) m.remove(); document.removeEventListener('pointerdown', calMenuAway); }

function wireSplit() {
  const sp = $('.oc-split'), minis = $('.oc-minis');
  if (!sp || !minis) return;
  sp.addEventListener('dblclick', () => { saveCal({ mmh: MM_DEFAULT }); S.calKeepScroll = true; renderCalendar(); });
  sp.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); sp.setPointerCapture(e.pointerId);
    const start = calState().mmh, y0 = e.clientY;
    let cur = start, moved = false;
    const rows = 16; // two months × (day names + up to 6 weeks + title)
    const move = ev => {
      moved = moved || Math.abs(ev.clientY - y0) > 3;
      cur = Math.round(Math.max(0, Math.min(MM_MAX, (start < MM_MIN ? 0 : start) + (ev.clientY - y0) / rows)));
      minis.classList.toggle('collapsed', cur < MM_MIN);
      minis.style.setProperty('--mmh', Math.max(MM_MIN, cur) + 'px');
    };
    sp.addEventListener('pointermove', move);
    sp.addEventListener('pointerup', () => {
      sp.removeEventListener('pointermove', move);
      if (!moved && start < MM_MIN) cur = MM_DEFAULT; // click "Show month calendars"
      saveCal({ mmh: cur }); S.calKeepScroll = true; renderCalendar();
    }, { once: true });
  });
}
function wireCalendar() {
  wireSplit();
  const grid = $('.oc-main');
  if (!grid) return;
  // double-click empty space: new task there (for that person in "Day – by person")
  grid.addEventListener('dblclick', e => {
    if (e.target.closest('.oc-ev, .oc-dn, .oc-more, .oc-plus, .oc-top')) return;
    const s = slotFromEvent(e); if (!s) return;
    newTask({ due_date: s.date, due_time: s.time || '', ...(s.person ? { assignee_id: s.person } : {}) });
  });
  // single click on empty space selects the slot (paste target)
  grid.addEventListener('click', e => {
    if (e.target.closest('.oc-ev, .oc-dn, .oc-more, .oc-plus, .oc-top, button, a')) return;
    const s = slotFromEvent(e); if (s) calSelect(s);
  });
  // right-click menus
  grid.addEventListener('contextmenu', e => {
    const evEl = e.target.closest('.oc-ev');
    if (evEl) {
      const ev = CAL_EV.get(evEl.dataset.key); if (!ev) return;
      e.preventDefault(); calSelect({ key: ev.key });
      return calMenu(e.clientX, e.clientY, [
        { label: 'Open', key: 'Enter', run: () => openCalEvent(ev) },
        ev.copy ? { label: 'Copy', key: 'Ctrl+C', run: () => calCopy(ev) } : null,
        ev.copy ? { label: 'Copy to the next day', run: () => { S.calClip = { key: ev.key, id: ev.id, title: ev.title, time: ev.time, dur: ev.dur }; calPaste({ date: addD(ev.date, 1), time: ev.time, keepTime: true, person: null }); } } : null,
        ev.kind === 'task' || ev.kind === 'callback' ? '-' : null,
        ev.kind === 'task' || ev.kind === 'callback' ? { label: 'Give to…', run: () => calGiveTo(ev, e.clientX, e.clientY) } : null,
      ]);
    }
    const s = slotFromEvent(e); if (!s) return;
    e.preventDefault(); calSelect(s);
    calMenu(e.clientX, e.clientY, [
      { label: `New task ${s.time ? 'at ' + fmtTime(s.time) : 'on ' + fmtDate(s.date, { day: 'numeric', month: 'short' })}`, run: () => newTask({ due_date: s.date, due_time: s.time || '', ...(s.person ? { assignee_id: s.person } : {}) }) },
      { label: S.calClip ? `Paste “${esc(S.calClip.title.slice(0, 30))}” here` : 'Paste here', key: 'Ctrl+V', off: !S.calClip, run: () => calPaste(s) },
      '-',
      { label: `🌴 Mark leave on ${fmtDate(s.date, { day: 'numeric', month: 'short' })}${s.person && s.person !== S.me.id ? ' for ' + esc((user(s.person) || {}).name || '') : ''}`, off: !!(s.person && s.person !== S.me.id && S.me.role !== 'admin'), run: () => TF.leaveForm(null, { date: s.date, ...(s.person ? { user_id: s.person } : {}) }) },
    ]);
  });
  $$('.oc-ev').forEach(el => el.addEventListener('pointerdown', calPointerDown));
}
function calGiveTo(ev, x, y) {
  const people = [...S.users.filter(u => u.active), { id: 0, name: 'Unassigned' }];
  calMenu(x, y, people.map(u => ({ label: `${u.id ? avatar(u.id) : '<span class="av p-gray">–</span>'} ${esc(u.name)}${(ev.person || 0) === u.id ? ' ✓' : ''}`, run: () => calReassign(ev, u.id) })));
}
async function calReassign(ev, personId) {
  if ((ev.person || 0) === personId) return;
  try {
    if (ev.kind === 'task') { const r = await api('PUT', '/api/tasks/' + ev.id, { assignee_id: personId || null }); if (r.warning) { toast(r.warning, true); S.calKeepScroll = true; return renderCalendar(); } }
    else if (ev.kind === 'callback') { if (!personId) return toast('A call-back needs someone to make it.', true); await api('PUT', '/api/callbacks/' + ev.id, { assignee_id: personId }); }
    else return toast('Only tasks and call-backs can be given to someone else.', true);
    toast(`Given to ${personId ? (user(personId) || {}).name : 'nobody (unassigned)'}`);
  } catch (e) { errToast(e); }
  S.calKeepScroll = true; renderCalendar();
}
// keyboard: Ctrl+C / Ctrl+V / Enter / Delete-free (deleting stays in the task itself)
document.addEventListener('keydown', e => {
  if (!location.hash.startsWith('#/calendar') || $('.modal') || $('#drawer')) return;
  if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'c' && S.calSel && S.calSel.key && !(window.getSelection && String(window.getSelection()))) { e.preventDefault(); calCopy(CAL_EV.get(S.calSel.key)); }
  else if (mod && e.key.toLowerCase() === 'v' && S.calClip) { e.preventDefault(); calPaste(); }
  else if (e.key === 'Enter' && S.calSel && S.calSel.key) { const ev = CAL_EV.get(S.calSel.key); if (ev) openCalEvent(ev); }
  else if (e.key === 'Escape' && $('#ocCtx')) calMenuClose();
});

/* ---------- drag to move (Ctrl = copy), resize, or give to another person ---------- */
let calDrag = null, lastClick = { key: null, t: 0 };
function calPointerDown(e) {
  if (e.button !== 0) return;
  const el = e.currentTarget, ev = CAL_EV.get(el.dataset.key);
  if (!ev) return;
  if (e.pointerType === 'touch') { el.onclick = () => openCalEvent(ev); return; }
  e.preventDefault();
  if (!ev.drag) { calDrag = { el, ev, nodrag: true, x0: e.clientX, y0: e.clientY }; el.addEventListener('pointerup', calPointerUp, { once: true }); return; }
  const r = el.getBoundingClientRect();
  calDrag = { el, ev, resize: e.target.classList.contains('oc-resize'), x0: e.clientX, y0: e.clientY, grabY: e.clientY - r.top, moved: false, target: null, copy: false };
  el.setPointerCapture(e.pointerId);
  el.addEventListener('pointermove', calPointerMove);
  el.addEventListener('pointerup', calPointerUp, { once: true });
  el.addEventListener('pointercancel', calCancel, { once: true });
}
function calCancel() { if (!calDrag) return; if (calDrag.el) { calDrag.el.classList.remove('oc-dragging'); calDrag.el.style.pointerEvents = ''; } $$('.oc-preview').forEach(p => p.remove()); $$('.oc-drop').forEach(x => x.classList.remove('oc-drop')); calDrag = null; }
function calPointerMove(e) {
  const d = calDrag; if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
  if (!d.moved) { d.moved = true; d.el.classList.add('oc-dragging'); d.el.style.pointerEvents = 'none'; }
  d.copy = (e.ctrlKey || e.metaKey) && d.ev.copy && !d.resize;
  d.el.classList.toggle('oc-copying', d.copy);
  $$('.oc-preview').forEach(p => p.remove()); $$('.oc-drop').forEach(x => x.classList.remove('oc-drop'));
  const sc = $('#ocScroll');
  if (sc) { const r = sc.getBoundingClientRect(); if (e.clientY > r.bottom - 30) sc.scrollTop += 12; else if (e.clientY < r.top + 20 && e.clientY > r.top - 5) sc.scrollTop -= 12; }
  if (d.resize) {
    const col = d.el.closest('.oc-col'); if (!col) return;
    const start = toMin(d.ev.time);
    const end = Math.max(start + SNAP, Math.min(24 * 60, Math.round(((e.clientY - col.getBoundingClientRect().top) / HOUR_PX * 60) / SNAP) * SNAP));
    d.target = { date: d.ev.date, time: d.ev.time, dur: end - start };
    preview(col, start, end - start, `${fmtTime(d.ev.time)} – ${fmtTime(fromMin(end % (24 * 60)))}`);
    return;
  }
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const personRow = hit && hit.closest('.oc-calrow[data-person]');
  const col = hit && hit.closest('.oc-col'), cell = hit && (hit.closest('.oc-ad') || hit.closest('.oc-day'));
  const colPerson = el => el && el.dataset.person != null ? +el.dataset.person : null;
  const verb = d.copy ? 'Copy' : 'Move';
  if (personRow && ['task', 'callback'].includes(d.ev.kind)) {
    personRow.classList.add('oc-drop');
    d.target = { date: d.ev.date, time: d.ev.time, dur: d.ev.dur, person: +personRow.dataset.person, onlyPerson: true };
  } else if (col && !['settle', 'finance'].includes(d.ev.kind)) {
    const len = d.ev.time ? (d.ev.dur || DEF_LEN) : DEF_LEN;
    const top = e.clientY - col.getBoundingClientRect().top - (d.ev.time && d.el.classList.contains('timed') ? d.grabY : 8);
    let start = Math.round((top / HOUR_PX * 60) / SNAP) * SNAP;
    start = Math.max(0, Math.min(24 * 60 - SNAP, start));
    const p = colPerson(col);
    d.target = { date: col.dataset.date, time: fromMin(start), dur: len, person: p };
    preview(col, start, Math.min(len, 24 * 60 - start), `${verb} · ${fmtTime(fromMin(start))}${p != null ? ' · ' + ((user(p) || { initials: '–' }).initials) : ' · ' + fmtDate(col.dataset.date, { weekday: 'short', day: 'numeric' })}`);
  } else if (cell || col) {
    const c = cell || col;
    c.classList.add('oc-drop');
    d.target = { date: c.dataset.date, time: c.classList.contains('oc-day') ? d.ev.time : null, dur: d.ev.dur, person: colPerson(c) };
  } else d.target = null;
}
function preview(col, start, len, label) {
  const p = document.createElement('div');
  p.className = 'oc-preview';
  p.style.top = (start / 60 * HOUR_PX) + 'px'; p.style.height = Math.max(18, len / 60 * HOUR_PX - 2) + 'px';
  p.textContent = label;
  col.appendChild(p);
}
async function calPointerUp() {
  const d = calDrag; if (!d) return;
  calCancel();
  if (d.nodrag || !d.moved) {
    // click selects, a second click on the same item opens it (like Outlook's double-click)
    const now = Date.now();
    if (lastClick.key === d.ev.key && now - lastClick.t < 450) { lastClick = { key: null, t: 0 }; return openCalEvent(d.ev); }
    lastClick = { key: d.ev.key, t: now };
    calSelect({ key: d.ev.key });
    return;
  }
  const t = d.target, ev = d.ev;
  if (!t) return;
  const personChanged = t.person != null && (ev.person || 0) !== t.person;
  if (!d.copy && !personChanged && t.date === ev.date && (t.time || null) === (ev.time || null) && (t.dur || null) === (ev.dur || null)) return;
  S.calKeepScroll = true;
  try {
    if (d.copy && ev.kind === 'task') {
      const body = t.onlyPerson ? { assignee_id: t.person || null } : { due_date: t.date, due_time: t.time || null, ...(t.time ? { duration: t.dur } : {}), ...(t.person != null ? { assignee_id: t.person || null } : {}) };
      await api('POST', `/api/tasks/${ev.id}/copy`, body);
      toast(`Copied to ${fmtDate(body.due_date || ev.date)}${body.due_time ? ' ' + fmtTime(body.due_time) : ''}`);
    } else if (ev.kind === 'task') {
      const patch = t.onlyPerson ? {} : { due_date: t.date, due_time: t.time || null };
      if (!t.onlyPerson && t.time && (d.resize || (ev.dur && t.dur !== ev.dur))) patch.duration = t.dur;
      if (personChanged) patch.assignee_id = t.person || null;
      const r = await api('PUT', '/api/tasks/' + ev.id, patch);
      if (r.warning) toast(r.warning, true); else toast(d.resize ? `Length set to ${t.dur >= 60 ? (t.dur / 60).toString().replace('.5', '½') + ' h' : t.dur + ' min'}`
        : personChanged ? `Given to ${t.person ? (user(t.person) || {}).name : 'nobody (unassigned)'}${t.onlyPerson ? '' : ' · ' + fmtDate(t.date) + (t.time ? ' ' + fmtTime(t.time) : '')}`
        : `Moved to ${fmtDate(t.date)}${t.time ? ' ' + fmtTime(t.time) : ''}`);
    } else if (ev.kind === 'callback') {
      if (personChanged && !t.person) { toast('A call-back needs someone to make it.', true); return renderCalendar(); }
      await api('PUT', '/api/callbacks/' + ev.id, { ...(t.onlyPerson ? {} : { due_at: `${t.date} ${t.time || ev.time || '09:00'}` }), ...(personChanged ? { assignee_id: t.person } : {}) });
      toast(personChanged ? `Call-back given to ${(user(t.person) || {}).name}` : 'Call-back moved');
    } else if (ev.kind === 'settle' || ev.kind === 'finance') {
      if (t.date === ev.date) return renderCalendar();
      const m = S.matters.find(x => x.id === ev.id);
      const what = ev.kind === 'settle' ? 'settlement' : 'finance';
      if (!(await askDialog({ title: `Move the ${what} date?`, text: `${m ? m.name : 'This matter'}: ${fmtDate(ev.date)} → ${fmtDate(t.date)}. Stage and milestone due dates that count from it move too${ev.kind === 'settle' ? ', and so does any UNFIN reminder' : ''}.`, ok: 'Move date' }))) return renderCalendar();
      await api('PUT', '/api/matters/' + ev.id, { [ev.kind === 'settle' ? 'settlement_date' : 'finance_date']: t.date });
      try { S.matters = await api('GET', '/api/matters?status=all&brief=1'); } catch { /* ignore */ }
      toast(`${what[0].toUpperCase() + what.slice(1)} date moved`);
    }
  } catch (err) { errToast(err); }
  renderCalendar();
}

/* ---------- full screen ---------- */
function setCalFull(on) {
  S.calFull = on;
  try {
    if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  } catch { /* the in-page full-screen view is enough */ }
  document.body.classList.toggle('cal-full-on', on);
  S.calKeepScroll = true;
  renderCalendar();
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.calFull && location.hash.startsWith('#/calendar')) { S.calFull = false; document.body.classList.remove('cal-full-on'); S.calKeepScroll = true; renderCalendar(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.calFull && !$('.modal') && !$('#drawer') && !$('#ocCtx')) setCalFull(false); });
window.addEventListener('hashchange', () => { calMenuClose(); if (S.calFull && !location.hash.startsWith('#/calendar')) { S.calFull = false; document.body.classList.remove('cal-full-on'); } });

Object.assign(window.TF, {
  calView(v) { saveCal({ view: v }); renderCalendar(); },
  calViewMenu(e) { e.stopPropagation(); const m = $('#ocViewMenu'); m.classList.toggle('hidden'); const close = () => { m.classList.add('hidden'); document.removeEventListener('click', close); }; setTimeout(() => document.addEventListener('click', close), 0); },
  calToggle(k) { const st = calState(); st.hidden.has(k) ? st.hidden.delete(k) : st.hidden.add(k); saveCal({ hidden: [...st.hidden] }); S.calKeepScroll = true; renderCalendar(); },
  calDates() { TF.calToggle('dates'); },
  calSide(on) { if (window.innerWidth < 760) S.calSide = on; else saveCal({ side: on }); S.calKeepScroll = true; renderCalendar(); },
  calFull() { setCalFull(!S.calFull); },
  calGo(dir) {
    const st = calState();
    if (dir === 0) S.calDate = todayStr();
    else if (st.view === 'month') { const d = parseD(st.date.slice(0, 8) + '01'); d.setMonth(d.getMonth() + dir); S.calDate = dstr(d); }
    else S.calDate = addD(st.date, dir * ({ day: 1, people: 1, '3day': 3, workweek: 7, week: 7 }[st.view]));
    S.calMiniMonth = null;
    renderCalendar();
  },
  calPick(d) { S.calDate = d; if (window.innerWidth < 760) S.calSide = false; S.calKeepScroll = true; renderCalendar(); },
  calMini(dir) { const base = (S.calMiniMonth || calState().date.slice(0, 7)) + '-01'; const d = parseD(base); d.setMonth(d.getMonth() + dir); S.calMiniMonth = dstr(d).slice(0, 7); S.calKeepScroll = true; renderCalendar(); },
  calOpenDay(d) { S.calDate = d; const st = calState(); saveCal({ view: st.view === 'people' ? 'people' : 'day' }); renderCalendar(); },
  calClipClear() { S.calClip = null; S.calKeepScroll = true; renderCalendar(); },
});
