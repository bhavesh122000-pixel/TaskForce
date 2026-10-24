/* TaskForce – matters, stage checklists, Readiness Board and checklist admin */
'use strict';

const READY_TONE = { green: 'p-green', red: 'p-red', yellow: 'p-yellow', orange: 'p-orange', gray: 'p-gray' };
const RD_SIDES = { P: 'P', V: 'V' };
S.openStages = S.openStages || {};

function sideOfType(t) { return TFW.sideOf(t); }
const sdrOf = m => !!(m && m.ready && m.ready.sdr);
function msDuePill(x, short) {
  if (!x.due) return x.ms ? '<span class="pill p-gray" title="Add a settlement / finance date to the matter to date this milestone">No date yet</span>' : '';
  if (x.done) return `<span class="pill p-green" title="Due ${esc(fmtDate(x.due))}">✓ ${esc(fmtDate(x.due, { day: 'numeric', month: 'short' }))}</span>`;
  const n = daysBetween(todayStr(), x.due);
  const cls = n < 0 ? 'p-red' : n <= 2 ? 'p-yellow' : 'p-gray';
  return `<span class="pill ${cls}">${n < 0 ? 'Was due' : 'Due'} ${esc(fmtDate(x.due, short ? { day: 'numeric', month: 'short' } : undefined))}</span>`;
}
function settleText(d) {
  if (!d) return '<span class="muted">Not fixed</span>';
  const n = daysBetween(todayStr(), d);
  const tail = n < 0 ? `<span class="pill p-red">${-n}d ago</span>` : n === 0 ? '<span class="pill p-red">today</span>' : n <= 7 ? `<span class="pill p-yellow">${n}d</span>` : `<span class="muted small">in ${n}d</span>`;
  return `${fmtDate(d)} ${tail}`;
}
function readinessPill(m) {
  if (!m.ready || !m.ready.applies) return '<span class="muted small">n/a</span>';
  if (m.ready.ready) return '<span class="pill p-green">Ready</span>';
  return `<span class="pill p-gray" title="${esc(m.ready.outstanding.map(o => o.label + ': ' + o.value).join('\n'))}">${m.ready.done}/${m.ready.total}</span>${m.ready.blockers.length ? ' <span class="pill p-red" title="' + esc(m.ready.blockers.join('\n')) + '">Blocked</span>' : ''}`;
}
function escBadge(m) { return m.escalations && m.escalations.length ? `<span class="pill p-red" title="${esc(m.escalations.join('\n'))}">⚑ Escalate</span>` : ''; }
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function weekLabel(mon) {
  const a = parseD(mon), b = parseD(mon); b.setDate(b.getDate() + 6);
  const f = d => `${ordinal(d.getDate())} ${d.toLocaleDateString('en-AU', { month: 'short' })}`;
  return `${f(a)} - ${f(b)}`;
}
function mondayOf(s) { const d = parseD(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dstr(d); }
async function refreshMatterRefs() { try { S.matters = await api('GET', '/api/matters?status=all&brief=1'); } catch { /* ignore */ } }

/* ---------------- matters list ---------------- */
const isTaxType = t => TFW.areaOf(t) === 'tax';
const dueWord = t => isTaxType(t) ? 'Due' : 'Settlement';
async function renderMatters(area) {
  area = area === 'tax' ? 'tax' : 'conv';
  S.matterArea = area;
  const main = $('#main');
  const mf = store('matterf') || { status: 'active', type: '', q: '' };
  let list;
  const areaTypes = TFW.MATTER_TYPES.filter(t => t.area === area);
  const types = (Array.isArray(mf.types) ? mf.types : (mf.type ? [mf.type] : [])).filter(k => areaTypes.some(t => t.key === k));
  try { list = await api('GET', `/api/matters?area=${area}&status=${mf.status}&type=${types.join(',')}&q=${encodeURIComponent(mf.q || '')}`); } catch (e) { return errToast(e); }
  const grouped = mf.group !== 'list';
  const tax = area === 'tax';
  main.innerHTML = (tax ? `<div class="toolbar"><h1 style="margin:0">Taxation</h1><span class="pill p-magenta" title="Only admins and staff with Taxation access see this">🔒 Taxation access only</span><span class="muted small">Bookkeeping and tax jobs, grouped by due date. Checklists come from the taxation library (Admin → Checklist library).</span></div>` : '') + `<div class="toolbar">
      <div class="seg" role="group" aria-label="Layout"><button class="${grouped ? 'on' : ''}" onclick="TF.setMatterF('group','week')">By ${tax ? 'due' : 'settlement'} week</button><button class="${grouped ? '' : 'on'}" onclick="TF.setMatterF('group','list')">List</button></div>
      ${['active', 'settled', 'archived', 'all'].map(s => `<span class="chip ${mf.status === s ? 'on' : ''}" onclick="TF.setMatterF('status','${s}')">${s[0].toUpperCase() + s.slice(1)}</span>`).join('')}
      <span class="sep"></span>
      ${areaTypes.length > 1 ? `<span class="chips-multi" role="group" aria-label="Matter types"><span class="chip ${!types.length ? 'on' : ''}" onclick="TF.matterType('')" title="Show every type">All types</span>${areaTypes.map(t => `<span class="chip ${types.includes(t.key) ? 'on' : ''}" onclick="TF.matterType('${t.key}')" title="${esc(t.label)}">${types.includes(t.key) ? '✓ ' : ''}${esc(t.short)}</span>`).join('')}</span>` : ''}
      <input style="width:230px" placeholder="${tax ? 'Client code or name' : 'BC number, client or address'}" value="${esc(mf.q)}" onchange="TF.setMatterF('q',this.value)">
      <span class="spacer"></span><button class="primary" onclick="TF.matterForm(null, '${area}')">+ New ${tax ? 'tax job' : 'matter'}</button>
    </div>` +
    (list.length ? (grouped ? weekGroups(list, { undatedLabel: tax ? 'No due date yet' : null }).map(g => `<div class="rd-group"><h2>${esc(g.title)} <span class="muted">(${g.rows.length})</span></h2>${matterTable(g.rows, tax)}</div>`).join('') : matterTable(list, tax))
      : `<div class="card empty">${tax ? 'No tax jobs here yet.' : 'No matters here yet.'} <a href="javascript:TF.matterForm(null, '${area}')">${tax ? 'Open a tax job' : 'Open a new matter'}</a></div>`);
}
// Group matters by settlement week (Monday – Sunday), with "date passed" first and undated last
function weekGroups(list, opts = {}) {
  const td = todayStr(), thisMon = mondayOf(td);
  const lastMon = opts.weeks ? dstr(new Date(parseD(thisMon).getTime() + (opts.weeks - 1) * 7 * 864e5)) : null;
  const groups = new Map();
  for (const m of list) {
    let key;
    if (!m.settlement_date) key = 'z';
    else if (m.settlement_date < thisMon) key = 'a';
    else { key = mondayOf(m.settlement_date); if (lastMon && key > lastMon) continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  return [...groups.keys()].sort().map(k => ({
    key: k, thisWeek: k === thisMon,
    title: k === 'a' ? (opts.undatedLabel ? 'Due date passed – still open' : 'Settlement date passed – still open') : k === 'z' ? (opts.undatedLabel || 'Undated – no settlement date yet') : `${weekLabel(k)}${k === thisMon ? ' · this week' : k === dstr(new Date(parseD(thisMon).getTime() + 7 * 864e5)) ? ' · next week' : ''}`,
    rows: groups.get(k).sort((a, b) => (a.settlement_date || '').localeCompare(b.settlement_date || '') || a.code.localeCompare(b.code)),
  }));
}
function matterTable(list, tax) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${tax ? 'Job' : 'Matter'}</th><th>${tax ? 'Details' : 'Property'}</th><th>${tax ? 'Due' : 'Settlement'}</th><th>Current stage</th><th>Checklist</th><th>Readiness</th><th>Responsible</th></tr></thead><tbody>
    ${list.map(m => {
      const c = m.checklist, cur = c.current;
      const pct = c.total ? Math.round(c.done / c.total * 100) : 0;
      return `<tr onclick="location.hash='#/matters/${m.id}'">
        <td><div class="row" style="gap:6px"><span class="pill ${TYPE_PILL[m.type]}">${esc(TYPE_SHORT[m.type])}</span><b>${esc(m.code)}</b>${m.status !== 'active' ? ` <span class="pill p-gray">${m.status}</span>` : ''}</div><div class="small sec">${esc(m.client)}</div></td>
        <td class="small">${esc(m.address)}</td>
        <td class="small" style="white-space:nowrap">${settleText(m.settlement_date)}</td>
        <td class="small">${cur ? `${esc(cur.label)}${cur.due ? ` <span class="pill ${cur.overdue ? 'p-red' : 'p-gray'}">${cur.overdue ? 'was due ' : 'due '}${fmtDate(cur.due, { day: 'numeric', month: 'short' })}</span>` : ''}` : c.has ? '<span class="pill p-green">All stages done</span>' : '<span class="muted">No checklist</span>'}${c.overdue.length && !(cur && cur.overdue && c.overdue.length === 1) ? ` <span class="pill p-red" title="${esc(c.overdue.join(', '))}">${c.overdue.length} overdue</span>` : ''}</td>
        <td>${c.total ? `<div class="row" style="gap:6px"><div class="progress"><div style="width:${pct}%"></div></div><span class="small muted">${c.done}/${c.total}</span></div>` : ''}${c.stuck ? ` <span class="pill p-red">${c.stuck} stuck</span>` : ''}</td>
        <td style="white-space:nowrap">${readinessPill(m)} ${escBadge(m)}</td>
        <td>${avatar(m.responsible_id)}</td></tr>`;
    }).join('')}
    </tbody></table></div>`;
}

/* ---------------- matter page ---------------- */
async function renderMatter(id, tab) {
  const main = $('#main');
  tab = tab || 'checklist';
  let m;
  const scroll = window.scrollY;
  try { m = await api('GET', '/api/matters/' + id); } catch (e) { main.innerHTML = `<div class="card empty">${esc(e.message)} <a href="#/matters">Back to matters</a></div>`; return; }
  S.matter = m;
  const u = user(m.responsible_id);
  const cur = m.checklist.current;
  const taxM = isTaxType(m.type);
  $$('.nav a').forEach(x => x.classList.toggle('on', x.dataset.r === (taxM ? 'tax' : 'matters')));
  const tabs = [['checklist', 'Checklist'], ['timeline', 'Gantt chart'], ...(taxM ? [] : [['readiness', 'Readiness']]), ['tasks', `Tasks (${m.open_tasks})`], ['calls', `Calls${m.callbacks && m.callbacks.filter(c => c.status === 'open').length ? ' (' + m.callbacks.filter(c => c.status === 'open').length + ')' : ''}`], ['details', 'Details'], ['activity', 'Activity']];
  main.innerHTML = `
  <div class="toolbar"><a href="${taxM ? '#/tax' : '#/matters'}" class="small">‹ ${taxM ? 'Taxation' : 'All matters'}</a>${taxM ? ' <span class="pill p-magenta">🔒 Taxation</span>' : ''}${m.related.map(r => ` <span class="muted small">·</span> <a class="small" href="#/matters/${r.id}">Also ${esc(r.code)} ${esc(TYPE_SHORT[r.type])} ${esc(r.client)}</a>`).join('')}</div>
  <div class="card" style="margin-bottom:12px">
    <div class="row" style="align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:260px"><h1 style="margin-bottom:2px">${esc(m.code)} ${esc(TYPE_SHORT[m.type])} ${esc(m.client)}</h1>
        <div class="sec small"><span class="pill ${TYPE_PILL[m.type]}">${esc(TYPE_LABEL[m.type])}</span> ${esc(m.address) || ''}</div></div>
      <select style="width:auto" onchange="TF.matterStatus(${m.id}, this.value)">${['active', 'settled', 'archived'].map(s => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
      <button onclick="TF.matterForm(${m.id})">Edit</button>
    </div>
    <div class="kv kv6">
      <div><div class="lbl">${dueWord(m.type)}</div><div class="v">${settleText(m.settlement_date)}</div></div>
      ${taxM ? '' : '<div><div class="lbl">Finance</div><div class="v">'}${taxM ? '' : `${m.finance_date ? fmtDate(m.finance_date) : m.unconditional ? '<span class="sec">Unconditional</span>' : '<span class="muted">–</span>'}</div></div>`}
      <div><div class="lbl">Responsible</div><div class="v row" style="gap:6px">${avatar(m.responsible_id)} ${u ? esc(u.name) : '–'}</div></div>
      <div><div class="lbl">Current stage</div><div class="v">${cur ? esc(cur.label) + (cur.overdue ? ' <span class="pill p-red">overdue</span>' : '') : m.checklist.has ? 'All done' : '–'}</div></div>
      <div><div class="lbl">Checklist</div><div class="v">${m.checklist.done}/${m.checklist.total}</div></div>
      ${taxM ? `<div><div class="lbl">Details</div><div class="v small">${esc(m.address) || '–'}</div></div><div></div>` : `<div><div class="lbl">Readiness</div><div class="v">${readinessPill(m)}</div></div>`}
    </div>
    ${m.escalations.length ? `<div class="escalate"><b>Escalate to Bhavesh:</b><ul>${m.escalations.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${m.gst_applies || (m.ready && m.ready.sdr) || m.unconditional ? `<div class="small" style="margin-top:6px">${m.unconditional ? '<span class="pill p-aqua">Unconditional – no finance</span> ' : ''}${m.gst_applies ? '<span class="pill p-orange">GST applies</span> ' : ''}${m.ready && m.ready.sdr ? '<span class="pill p-violet">SDR – Stamp Duty Relief claimed</span>' : ''}</div>` : ''}
  </div>
  <div class="tabs">${tabs.map(([k, l]) => `<a href="#/matters/${m.id}/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
  <div id="mtab"></div>`;
  ({ checklist: drawChecklist, timeline: drawGantt, readiness: drawMatterReadiness, tasks: drawMatterTasks, calls: m2 => drawMatterCalls(m2), details: drawMatterDetails, activity: drawMatterActivity }[tab] || drawChecklist)(m);
  if (scroll) window.scrollTo(0, scroll);
}

function statusOptionsHTML(opts, cur) {
  const all = cur && !opts.includes(cur) ? [cur, ...opts] : opts;
  return `<option value="">–</option>${all.map(s => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('')}`;
}
function statusSelect(it, side, sub, extra = '', sdr = false) {
  const tone = READY_TONE[TFW.itemTone(it, sdr)] || '';
  return `<select class="cell ${it.status ? tone : ''}" ${extra} onchange="TF.itemSet(${it.id}, {status: this.value}, true)">${statusOptionsHTML(TFW.statusOptions(it, side, sub), it.status)}</select>`;
}
function itemRow(it, side, sub, stage, parent) {
  const sdr = sdrOf(S.matter);
  const linked = (it.tasks || []).map(t => `<span class="pill ${t.status === 'done' ? 'p-green' : 'p-blue'}" style="cursor:pointer" onclick="TF.openTask(${t.id})" title="Linked task">Task · ${esc((user(t.assignee_id) || { initials: '?' }).initials)}</span>`).join(' ');
  const kids = it.children || [];
  const done = TFW.itemDone(it, sdr);
  const roll = kids.length ? `<span class="muted small">${kids.filter(k => TFW.itemDone(k, sdr) || done).length}/${kids.length}</span>` : '';
  const ms = it.ms ? `<span class="pill p-violet ms-tag" title="Milestone – shows on the Readiness Board and the Gantt chart">◆ ${esc(it.ms_label || it.ms.label || it.title)}</span> ${msDuePill({ ...it, done })}` : '';
  return `<div class="ci ${sub ? 'sub' : ''} ${done ? 'done' : ''} ${it.ms ? 'is-ms' : ''}" data-id="${it.id}">
    <div class="ci-title"><span>${esc(it.title)}</span> ${roll} ${ms} ${linked}${it.note ? `<div class="ci-note">${esc(it.note)}</div>` : ''}</div>
    ${statusSelect(it, side, sub, '', sdr)}
    <select class="cell" onchange="TF.itemSet(${it.id}, {person_id: this.value || null})">${'<option value="">–</option>' + S.users.filter(x => x.active || x.id === it.person_id).map(x => `<option value="${x.id}" ${x.id === it.person_id ? 'selected' : ''}>${esc(x.initials)}</option>`).join('')}</select>
    <input class="cell" type="date" value="${esc(it.date || '')}" onchange="TF.itemSet(${it.id}, {date: this.value || null})">
    <input class="cell" placeholder="${sub ? 'Amount / text' : 'Text'}" value="${esc(it.value)}" onchange="TF.itemSet(${it.id}, {value: this.value})">
    <span class="ci-acts">
      <button class="ghost sm ${it.ms ? 'ms-on' : ''}" title="${it.ms ? 'Milestone – click to unmark it on this matter' : 'Mark as a milestone on this matter (Readiness Board + Gantt chart)'}" onclick="TF.itemMs(${it.id}, ${it.ms ? 'false' : 'true'})">◆</button>
      <button class="ghost sm" title="Notes" onclick="TF.itemNote(${it.id})">✎</button>
      <button class="ghost sm" title="Assign as a task" onclick="TF.itemAssign(${it.id}, '${stage.key}')">➜</button>
      ${!sub ? `<button class="ghost sm" title="Add a sub-item" onclick="TF.itemAddSub(${it.id}, '${stage.key}')">＋</button>` : ''}
      <button class="ghost sm danger" title="Remove" onclick="TF.itemDel(${it.id})">✕</button>
    </span>
  </div>`;
}
function drawChecklist(m) {
  const box = $('#mtab');
  const side = sideOfType(m.type) || 'P';
  if (!m.checklist.has) {
    box.innerHTML = `<div class="card empty">This matter has no checklist yet.<div class="row" style="margin-top:10px;justify-content:center"><button class="primary" onclick="TF.addChecklist(${m.id})">Add a checklist from the library</button></div></div>`;
    return;
  }
  const open = S.openStages[m.id] || (S.openStages[m.id] = Object.fromEntries(m.stages.map(s => [s.key, (m.checklist.current && s.key === m.checklist.current.key) || s.overdue])));
  box.innerHTML = `<div class="toolbar"><span class="sec small">Status, person, date and text work like the monday.com columns. <b>◆ milestones</b> get due dates automatically and show on the Readiness Board and Gantt chart. ✎ adds notes, ➜ assigns the item as a task.</span><span class="spacer"></span>
    <button class="sm" onclick="TF.addChecklist(${m.id})">+ Add from library</button><button class="sm" onclick="TF.stagesAll(${m.id}, true)">Expand all</button><button class="sm" onclick="TF.stagesAll(${m.id}, false)">Collapse all</button></div>` +
    m.stages.map(s => {
      const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
      const duePill = s.due ? `<span class="pill ${s.complete ? 'p-green' : s.overdue ? 'p-red' : 'p-gray'}">${s.complete ? 'Done' : (s.overdue ? 'Was due ' : 'Due ') + fmtDate(s.due)}</span>` : (s.total && !s.complete ? '<span class="pill p-gray">Needs a matter date</span>' : '');
      return `<section class="stage ${open[s.key] ? 'open' : ''}">
        <div class="stage-head" onclick="TF.stageToggle(${m.id}, '${s.key}')">
          <span class="caret">${open[s.key] ? '▾' : '▸'}</span><b>${esc(s.label)}</b><span class="muted small">${esc(s.when)}</span>
          <span class="spacer"></span>${duePill}<div class="progress" style="width:90px"><div style="width:${pct}%"></div></div><span class="small muted" style="min-width:44px;text-align:right">${s.done}/${s.total}</span>
        </div>
        ${open[s.key] ? `<div class="stage-body">
          <div class="ci head"><div>Item</div><div>Status</div><div>Person</div><div>Date</div><div>Text / amount</div><div></div></div>
          ${s.items.map(it => itemRow(it, side, false, s) + it.children.map(c => itemRow(c, side, true, s, it)).join('')).join('')}
          <div class="row" style="margin-top:8px"><input placeholder="Add an item to ${esc(s.label)}" id="add_${s.key}" onkeydown="if(event.key==='Enter')TF.itemAdd(${m.id}, '${s.key}')" style="max-width:420px"><button class="sm" onclick="TF.itemAdd(${m.id}, '${s.key}')">Add</button></div>
        </div>` : ''}
      </section>`;
    }).join('');
}

function drawMatterReadiness(m) {
  const box = $('#mtab');
  const r = m.ready;
  const miles = m.milestones || [];
  const notes = TFW.BOARD_NOTES.map(n => `<label class="f">${esc(n.label)} <span class="muted">– ${esc(n.hint)}</span><input value="${esc(m.readiness[n.key] || '')}" onchange="TF.rdSet(${m.id}, '${n.key}', this.value, true)"></label>`).join('');
  box.innerHTML = `<div class="card">
    <div class="row" style="margin-bottom:10px;flex-wrap:wrap">${!r.applies ? '<span class="pill p-gray">No milestones on this matter</span>' : r.ready ? '<span class="pill p-green">Ready to settle</span>' : `<span class="pill p-yellow">Not ready – ${r.outstanding.length} to go</span>`}
      ${r.sdr ? '<span class="pill p-violet">SDR – Stamp Duty Relief claimed</span>' : ''}<span class="spacer"></span><span class="muted small">These are the matter’s ◆ milestone checklist items – changing them here changes the checklist too.</span></div>
    ${r.blockers.length ? `<div class="escalate" style="margin-bottom:12px"><b>Blocked:</b> ${r.blockers.map(esc).join('; ')}</div>` : ''}
    <div class="rd-grid">${miles.map(x => {
      const tone = READY_TONE[TFW.itemTone(x, r.sdr)] || '';
      return `<label class="f ${x.applies ? '' : 'na-f'}">${esc(x.label)} <span class="muted">· ${esc(x.stage_label)}</span>
        <select class="${x.status ? tone : ''}" ${x.applies ? '' : 'disabled'} onchange="TF.itemSet(${x.id}, {status: this.value}, true)">${statusOptionsHTML(x.statuses, x.status)}</select>
        <span class="row" style="gap:6px;margin-top:3px">${x.applies ? msDuePill(x) : '<span class="muted small">Only when GST applies</span>'}<span class="muted" style="font-size:11px">Done when: ${esc(TFW.readyLabels(x.ms, r.sdr).slice(0, 4).join(' / '))}</span></span></label>`;
    }).join('') || '<p class="muted small">Mark checklist items with ◆ to track them here and on the Readiness Board.</p>'}</div>
    <h3 style="margin-top:14px">Board notes</h3><div class="grid2">${notes}</div>
  </div>`;
}

/* ---------------- Gantt chart of a matter's milestones ---------------- */
function drawGantt(m) {
  const box = $('#mtab');
  const miles = (m.milestones || []).filter(x => x.applies);
  if (!miles.length) { box.innerHTML = `<div class="card empty">No milestones on this matter yet.<div class="small" style="margin-top:6px">Mark checklist items with ◆ (or set milestones in Admin → Checklist library) and they appear here with their due dates.</div></div>`; return; }
  const td = todayStr();
  const dated = miles.filter(x => x.due);
  const marks = [[m.timeline.opened, 'Opened', 'g-open'], [m.finance_date, '$ Finance', 'g-fin'], [m.settlement_date, '⚑ Settlement', 'g-set'], [td, 'Today', 'g-today']].filter(x => x[0]);
  const allDates = [...dated.flatMap(x => [x.start || x.due, x.due]), ...marks.map(x => x[0])].sort();
  let from = allDates[0], to = allDates[allDates.length - 1];
  from = addDaysStr(mondayOf(from), 0); to = addDaysStr(to, 3);
  const days = daysBetween(from, to) + 1;
  const avail = Math.max(300, (box.clientWidth || 900) - 250 - 40);
  const W = Math.max(days <= 35 ? 26 : days <= 70 ? 16 : days <= 140 ? 9 : 5, Math.floor(avail / days));
  const x = d => daysBetween(from, d) * W;
  const width = days * W;
  // header: months + days / week starts
  let months = '', ticks = '', shade = '';
  for (let i = 0; i < days; i++) {
    const d = addDaysStr(from, i), dt = parseD(d);
    if (i === 0 || dt.getDate() === 1) months += `<div class="g-month" style="left:${i * W}px">${dt.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</div>`;
    if (W >= 16 || dt.getDay() === 1) ticks += `<div class="g-tick ${dt.getDay() === 1 ? 'mon' : ''}" style="left:${i * W}px;width:${W >= 16 ? W : 7 * W}px">${W >= 16 ? dt.getDate() : dt.getDate() + ' ' + dt.toLocaleDateString('en-AU', { month: 'short' })}</div>`;
    if (dt.getDay() === 0 || dt.getDay() === 6) shade += `<div class="g-we" style="left:${i * W}px;width:${W}px"></div>`;
  }
  const lines = marks.map(([d, l, c]) => d >= from && d <= to ? `<div class="g-line ${c}" style="left:${x(d) + W / 2}px" title="${esc(l)} ${esc(fmtDate(d))}"></div>` : '').join('');
  const flags = marks.map(([d, l, c], i) => d >= from && d <= to ? `<span class="g-flag ${c}" style="left:${x(d) + W / 2}px;top:${i % 2 ? 15 : 1}px">${esc(l)}</span>` : '').join('');
  const stages = [];
  for (const it of miles) { let g = stages.find(s => s.key === it.stage); if (!g) stages.push(g = { key: it.stage, label: it.stage_label, items: [] }); g.items.push(it); }
  const row = it => {
    const tone = TFW.itemTone(it, sdrOf(m));
    const bar = it.due ? (() => {
      const s = it.start || it.due, left = x(s), w = Math.max(W, x(it.due) - left + W);
      return `<div class="g-bar t-${tone} ${it.overdue ? 'late' : ''}" style="left:${left}px;width:${w}px" title="${esc(it.title)} · ${esc(fmtDate(s))} → ${esc(fmtDate(it.due))}${it.status ? ' · ' + esc(it.status) : ''}" onclick="TF.ganttEdit(${it.id})"></div>
        <div class="g-dia t-${tone}" style="left:${x(it.due) + W / 2 - 6}px" onclick="TF.ganttEdit(${it.id})"></div>
        <div class="g-lab" style="left:${x(it.due) + W + 6}px">${esc(it.status || 'Not started')}</div>`;
    })() : `<div class="g-lab" style="left:6px">No date yet – add the matter’s ${it.ms && it.ms.from === 'finance' ? 'finance' : 'settlement'} date</div>`;
    return `<div class="g-row"><div class="g-name" onclick="TF.ganttEdit(${it.id})"><span class="g-dot t-${tone}"></span><span class="g-t">${esc(it.label)}</span><span class="muted small">${it.due ? esc(fmtDate(it.due, { day: 'numeric', month: 'short' })) : '–'}</span></div><div class="g-track" style="width:${width}px">${bar}</div></div>`;
  };
  const stageRow = g => {
    const ds = g.items.filter(i => i.due);
    const bar = ds.length ? (() => { const s = ds.map(i => i.start || i.due).sort()[0], e = ds.map(i => i.due).sort().pop(); return `<div class="g-sbar" style="left:${x(s)}px;width:${x(e) - x(s) + W}px"></div>`; })() : '';
    const doneN = g.items.filter(i => i.done).length;
    return `<div class="g-row g-stage"><div class="g-name"><b>${esc(g.label)}</b><span class="muted small">${doneN}/${g.items.length}</span></div><div class="g-track" style="width:${width}px">${bar}</div></div>`;
  };
  box.innerHTML = `<div class="card gantt-card">
    <div class="row" style="flex-wrap:wrap;margin-bottom:8px"><b>Milestones</b><span class="muted small">${miles.filter(i => i.done).length}/${miles.length} done · ${miles.filter(i => i.overdue).length} overdue</span><span class="spacer"></span>
      <span class="g-key"><span class="g-dot t-green"></span>Done <span class="g-dot t-yellow"></span>Started <span class="g-dot t-gray"></span>Not started <span class="g-dot t-red"></span>Stuck / late</span></div>
    <div class="gantt"><div class="g-inner" style="width:${250 + width}px">
      <div class="g-row g-head"><div class="g-name muted small">Due dates are worked out from the matter’s dates</div><div class="g-track" style="width:${width}px">${months}<div class="g-ticks">${ticks}</div></div></div>
      <div class="g-body"><div class="g-overlay" style="left:250px;width:${width}px">${shade}${lines}</div><div class="g-row g-marks"><div class="g-name muted small">Key dates</div><div class="g-track" style="width:${width}px">${flags}</div></div>${stages.map(g => stageRow(g) + g.items.map(row).join('')).join('')}</div>
    </div></div>
    <p class="muted small" style="margin:8px 0 0">Bars run from when the work can start to its due date (◆). Click one to update it. Change a milestone’s timing in Admin → Checklist library.</p></div>`;
  const g = $('.gantt', box); const tx = x(td) - 300; if (g && tx > 0) g.scrollLeft = tx;
}
function addDaysStr(s, n) { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); }
function drawMatterTasks(m) {
  $('#mtab').innerHTML = `<div class="card"><div class="section" style="margin-top:0"><h3>Tasks</h3><button class="sm" onclick="TF.newTask({matter_id:${m.id}})">+ Add task</button></div>
    ${m.tasks.length ? m.tasks.map(t => { const d = dueInfo(t.due_date, t.status, t.due_time); return `<div class="mtask ${t.status === 'done' ? 'done' : ''}" onclick="TF.openTask(${t.id})">
      <span title="${STATUS_LABEL[t.status]}">${t.status === 'done' ? '✅' : t.status === 'progress' ? '🔵' : t.status === 'waiting' ? '⏳' : '⚪'}</span>
      <span class="t">${esc(t.title)}${t.item_stage ? ` <span class="muted small">· ${esc(STAGE_LABEL[t.item_stage])}</span>` : ''} ${t.attachment_count ? '<span class="muted small">📎' + t.attachment_count + '</span>' : ''}</span>
      <span class="pill ${t.status === 'done' ? 'p-green' : d.cls}">${t.status === 'done' ? 'Done' : d.text}</span>${avatar(t.assignee_id)}</div>`; }).join('') : '<div class="muted small">No tasks yet. Assign checklist items with ➜ or add a task.</div>'}</div>`;
}
function drawMatterDetails(m) {
  $('#mtab').innerHTML = `<div class="card">
    <div class="kv">
      <div><div class="lbl">Client</div><div class="v">${esc(m.client) || '–'}</div></div>
      <div><div class="lbl">Property</div><div class="v">${esc(m.address) || '–'}</div></div>
      <div><div class="lbl">Other side</div><div class="v">${esc(m.other_side) || '–'}</div></div>
      <div><div class="lbl">GST applies</div><div class="v">${m.gst_applies ? 'Yes' : 'No'}</div></div>
      <div><div class="lbl">SDR (Stamp Duty Relief)</div><div class="v">${m.ready && m.ready.sdr ? 'Claimed' : 'No'}</div></div>
      <div><div class="lbl">Opened</div><div class="v">${fmtDT(m.created_at)}</div></div>
    </div>
    <div class="lbl">Matter notes</div><div style="white-space:pre-wrap">${esc(m.notes) || '<span class="muted">None</span>'}</div>
    ${S.me.role === 'admin' ? `<div style="margin-top:20px;border-top:1px solid var(--border);padding-top:12px"><button class="sm danger" onclick="TF.deleteMatter(${m.id})">Delete matter, checklist and tasks</button></div>` : ''}
  </div>`;
}
function drawMatterActivity(m) {
  $('#mtab').innerHTML = `<div class="card"><div class="timeline">${m.activity.length ? m.activity.map(a => { const au = user(a.user_id); return `<div class="small"><b>${au ? esc(au.name) : 'TaskForce'}</b> ${esc(a.action)}${a.task_title && !/^(deleted|opened)/.test(a.action) ? ` <span class="muted">· ${esc(a.task_title)}</span>` : ''}<div class="muted" style="font-size:11px">${fmtDT(a.created_at)}</div></div>`; }).join('') : '<div class="muted small">Nothing yet.</div>'}</div></div>`;
}

async function matterForm(id, area) {
  area = area || S.matterArea || 'conv';
  let m = { code: '', type: area === 'tax' ? 'TAX' : 'P', address: '', client: '', other_side: '', settlement_date: '', finance_date: '', responsible_id: S.me.id, notes: '', gst_applies: 0, sdr_claimed: 0, unconditional: 0 };
  if (id) { try { m = await api('GET', '/api/matters/' + id); } catch (e) { return errToast(e); } area = TFW.areaOf(m.type); }
  const tax = area === 'tax';
  openModal(`<h2>${id ? (tax ? 'Edit tax job' : 'Edit matter') : (tax ? 'New tax job' : 'New matter')}</h2>
    <form id="mForm" class="${tax ? 'is-tax' : ''}">
    <div class="grid3">
      <label class="f">${tax ? 'Job / client code' : 'BC number'}<input name="code" required value="${esc(m.code)}" placeholder="${tax ? 'DBS-ASH-2026Q2' : 'BC1806'}"></label>
      <label class="f">Type<select name="type">${TFW.MATTER_TYPES.filter(t => t.area === area).map(t => `<option value="${t.key}" ${m.type === t.key ? 'selected' : ''}>${esc(t.short)} – ${esc(t.label)}</option>`).join('')}</select></label>
      <label class="f">Responsible<select name="responsible_id">${tax ? S.users.filter(u => (u.active || u.id === m.responsible_id) && u.can_tax).map(u => `<option value="${u.id}" ${u.id === m.responsible_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('') : userOptions(m.responsible_id, false)}</select></label>
    </div>
    <label class="f">Client${tax ? '' : ' (as in the matter name)'}<input name="client" value="${esc(m.client)}" placeholder="${tax ? 'Ashapuri Pty Ltd' : 'MEHTA Evelyn & MEHTA Nipul, or the company / trust name'}"></label>
    <label class="f">${tax ? 'Period / details' : 'Property address'}<input name="address" value="${esc(m.address)}" placeholder="${tax ? 'Week ending 21 Nov, or BAS Q2 2026' : '12 Example St, Adelaide SA 5000'}"></label>
    <div class="grid2">
      <label class="f">${tax ? 'Due date <span class="muted">(period end / lodgement – stage dates count back from this)</span>' : 'Settlement date <span class="muted">(blank = proposed plan, not fixed)</span>'}<input type="date" name="settlement_date" value="${esc(m.settlement_date || '')}"></label>
      ${tax ? '' : `<label class="f">Finance date<input type="date" name="finance_date" value="${esc(m.finance_date || '')}"></label>`}
    </div>
    ${tax ? '' : `<label class="row small unfin-box" style="gap:8px;margin:-4px 0 4px"><input type="checkbox" name="unconditional" ${m.unconditional ? 'checked' : ''} style="width:auto;height:auto"> <span><b>Unconditional contract</b> – no finance clause</span></label>
    <p class="muted small" id="unfinHint" style="margin:0 0 10px"></p>
    <label class="f">Other side (conveyancer / agent)<input name="other_side" value="${esc(m.other_side)}"></label>
    <div class="row small" style="gap:18px;margin-bottom:10px">
      <label class="row" style="gap:6px"><input type="checkbox" name="gst_applies" ${m.gst_applies ? 'checked' : ''} style="width:auto;height:auto"> GST applies</label>
      <label class="row" style="gap:6px" id="sdrBox"><input type="checkbox" name="sdr_claimed" ${m.sdr_claimed ? 'checked' : ''} style="width:auto;height:auto"> SDR (Stamp Duty Relief) claimed</label>
    </div>`}
    <label class="f">Notes<textarea name="notes" rows="2">${esc(m.notes)}</textarea></label>
    ${id ? '' : `<label class="f">Checklist <span class="muted">(from the library – change it in Admin → Checklist library)</span><select name="checklist_key" id="mfChecklist"><option value="">No checklist</option></select></label>`}
    <div class="err" id="mErr"></div>
    <div class="foot"><button type="button" onclick="TF.closeModal()">Cancel</button><button class="primary">${id ? 'Save' : 'Open matter'}</button></div>
    </form>`);
  const form = $('#mForm');
  let lib = { checklists: [], types: {} }, picked = false;
  if (!id) { try { lib = await api('GET', '/api/library'); } catch { /* the select stays at No checklist */ } }
  const sel = $('#mfChecklist');
  if (sel) { sel.innerHTML += lib.checklists.filter(c => (c.area || 'conv') === area).map(c => `<option value="${esc(c.key)}">${esc(c.name)} (${c.stages} stages)</option>`).join(''); sel.onchange = () => { picked = true; }; }
  const hint = () => {
    const side = sideOfType(form.type.value);
    if ($('#sdrBox')) $('#sdrBox').style.display = side === 'P' ? '' : 'none';
    if (sel && !picked) sel.value = lib.types[form.type.value] || '';
  };
  form.type.onchange = hint; hint();
  const unfin = () => {
    if (!form.unconditional) return;
    const on = form.unconditional.checked;
    form.finance_date.disabled = on; if (on) form.finance_date.value = '';
    const code = (form.code.value || 'BC…').replace(/\s+/g, '').toUpperCase();
    let when = '';
    if (form.settlement_date.value) { const d = parseD(form.settlement_date.value); d.setDate(d.getDate() - 10); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1); when = ' on ' + fmtDate(dstr(d)); }
    $('#unfinHint').textContent = on ? `A reminder “UNFIN - ${code}” goes in the calendar${when || ' 10 days before settlement (once there’s a settlement date)'}, for the person responsible. It moves if settlement moves.` : '';
  };
  if (form.unconditional) { form.unconditional.onchange = unfin; form.settlement_date.oninput = unfin; form.code.oninput = unfin; unfin(); }
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    if (!tax) {
      fd.gst_applies = form.gst_applies.checked; fd.sdr_claimed = form.sdr_claimed.checked; fd.unconditional = form.unconditional.checked;
      if (fd.unconditional) fd.finance_date = '';
    }
    if (sel) fd.checklist_key = sel.value;
    try {
      if (id) { await api('PUT', '/api/matters/' + id, fd); closeModal(); toast('Matter saved'); }
      else { const r = await api('POST', '/api/matters', fd); closeModal(); toast(tax ? 'Tax job opened' : 'Matter opened'); location.hash = '#/matters/' + r.id; }
      await refreshMatterRefs(); refreshView();
    } catch (err) { $('#mErr').textContent = err.message; }
  };
}

/* ---------------- Readiness Board (built from each matter's ◆ milestone items) ---------------- */
const RD_TYPE_ORDER = ['P', 'PA', 'V', 'VPA', 'LD', 'SP', 'O'];
function rdFilters() { const f = store('rdf') || {}; return { types: Array.isArray(f.types) ? f.types : [], weeks: f.weeks == null ? 3 : f.weeks, notReady: !!f.notReady, escalate: !!f.escalate, undated: f.undated !== false }; }
function rdColumns(list) {
  const cols = [];
  [...list].sort((a, b) => RD_TYPE_ORDER.indexOf(a.type) - RD_TYPE_ORDER.indexOf(b.type)).forEach(m => {
    let at = -1;
    (m.milestones || []).forEach(x => {
      const i = cols.findIndex(c => c.label.toLowerCase() === x.label.toLowerCase());
      if (i < 0) { cols.splice(at + 1, 0, { label: x.label, titles: new Set([x.title]), types: new Set([m.type]) }); at = at + 1; }
      else { cols[i].titles.add(x.title); cols[i].types.add(m.type); at = Math.max(at, i); }
    });
  });
  // familiar monday.com column order first, then any new milestones in checklist order
  const known = TFW.READINESS.filter(c => c.kind !== 'text').map(c => (c.short || c.label).toLowerCase());
  return cols.map((c, i) => ({ c, r: known.includes(c.label.toLowerCase()) ? known.indexOf(c.label.toLowerCase()) : 1000 + i })).sort((a, b) => a.r - b.r).map(x => x.c);
}
async function renderReadiness() {
  const main = $('#main');
  const rf = rdFilters();
  let list;
  try { list = await api('GET', '/api/matters?status=active'); } catch (e) { return errToast(e); }
  list = list.filter(m => !isTaxType(m.type) && ((m.milestones && m.milestones.length) || m.side)).filter(m => !rf.types.length || rf.types.includes(m.type));
  if (rf.notReady) list = list.filter(m => !m.ready.ready);
  if (rf.escalate) list = list.filter(m => m.escalations.length);
  if (!rf.undated) list = list.filter(m => m.settlement_date);
  const groups = weekGroups(list, { weeks: rf.weeks });
  const shown = groups.flatMap(g => g.rows);
  const cols = rdColumns(shown);
  S.rdCols = cols;
  const thisWeek = (groups.find(g => g.thisWeek) || { rows: [] }).rows;
  const chip = (k, v, label) => `<span class="chip ${rf[k] === v ? 'on' : ''}" onclick="TF.rdFilter('${k}', ${JSON.stringify(v).replace(/"/g, '&quot;')})">${label}</span>`;
  const types = TFW.MATTER_TYPES.filter(t => t.key !== 'O' && t.area !== 'tax');
  main.innerHTML = `<div class="toolbar">
      <h1 style="margin:0 10px 0 0">Readiness Board</h1>
      <span class="chips-multi"><span class="chip ${!rf.types.length ? 'on' : ''}" onclick="TF.rdType('')">All files</span>${types.map(t => `<span class="chip ${rf.types.includes(t.key) ? 'on' : ''}" onclick="TF.rdType('${t.key}')" title="${esc(t.label)}">${rf.types.includes(t.key) ? '✓ ' : ''}${esc(t.short)}</span>`).join('')}</span>
      <span class="sep"></span>${chip('weeks', 3, 'Next three weeks')}${chip('weeks', 6, 'Six weeks')}${chip('weeks', 0, 'All upcoming')}
      <span class="sep"></span><span class="chip ${rf.notReady ? 'on' : ''}" onclick="TF.rdFilter('notReady', ${!rf.notReady})">Not ready only</span>
      <span class="chip ${rf.escalate ? 'on' : ''}" onclick="TF.rdFilter('escalate', ${!rf.escalate})">Needs escalation</span>
      <span class="chip ${rf.undated ? 'on' : ''}" onclick="TF.rdFilter('undated', ${!rf.undated})">Show undated</span>
    </div>
    <div class="stats">
      <div class="stat"><div class="lbl">Settling this week</div><div class="n">${thisWeek.length}</div></div>
      <div class="stat"><div class="lbl">Ready this week</div><div class="n">${thisWeek.filter(m => m.ready.ready).length}/${thisWeek.length}</div></div>
      <div class="stat"><div class="lbl">Overdue milestones</div><div class="n" style="${shown.some(m => m.milestones.some(x => x.overdue && x.applies)) ? 'color:var(--danger)' : ''}">${shown.reduce((n, m) => n + m.milestones.filter(x => x.overdue && x.applies).length, 0)}</div></div>
      <div class="stat"><div class="lbl">Escalations</div><div class="n" style="${shown.some(m => m.escalations.length) ? 'color:var(--danger)' : ''}">${shown.filter(m => m.escalations.length).length}</div></div>
    </div>` +
    (groups.map(g => `<div class="rd-group"><h2>${esc(g.title)} <span class="muted">(${g.rows.length})</span></h2>
        <div class="rd-wrap"><table class="rd"><thead><tr><th class="sticky">Matter</th><th title="${esc(TFW.BOARD_NOTES[0].hint)}">Text</th>${cols.map(c => `<th title="${esc([...c.titles].join(' / '))}">${esc(c.label)}</th>`).join('')}<th>Text 2</th></tr></thead>
        <tbody>${g.rows.map(m => rdRow(m, cols)).join('')}</tbody></table></div></div>`).join('') || `<div class="card empty">No files to show with these filters.</div>`) +
    `<p class="muted small">Columns are the ◆ milestone items on each matter’s checklist – change a status here or on the matter and both update. Green = done. A file is ready when every milestone that applies is green and the Text note has no POT/IP blocker. The small date under each status is when it’s due. Choose milestones in Admin → Checklist library.</p>`;
}
function rdRow(m, cols) {
  const r = m.ready, sdr = r.sdr;
  const by = new Map(); (m.milestones || []).forEach(x => { const k = x.label.toLowerCase(); if (!by.has(k)) by.set(k, x); });
  const note = k => `<td><input class="cell rd-text" value="${esc(m.readiness[k] || '')}" placeholder="–" onchange="TF.rdSet(${m.id}, '${k}', this.value)"></td>`;
  return `<tr data-mid="${m.id}">
    <td class="sticky"><a href="#/matters/${m.id}/timeline"><b>${esc(m.code)} ${esc(TYPE_SHORT[m.type])}</b> ${esc(m.client)}</a>
      <div class="small sec">${m.settlement_date ? fmtDate(m.settlement_date) : 'No settlement date'} · ${avatar(m.responsible_id)} ${!r.applies ? '<span class="pill p-gray">No milestones</span>' : r.ready ? '<span class="pill p-green">Ready</span>' : `<span class="pill p-gray">${r.done}/${r.total}</span>`} ${escBadge(m)}</div>
      ${r.blockers.length ? `<div class="small" style="color:var(--danger)">${r.blockers.map(esc).join('; ')}</div>` : ''}
      ${sdr ? '<div class="small" style="color:var(--c-violet)">SDR – Stamp Duty Relief claimed</div>' : ''}</td>
    ${note('text')}
    ${cols.map(c => {
      const x = by.get(c.label.toLowerCase());
      if (!x || !x.applies) return `<td class="na" title="${x ? 'Only when GST applies' : 'Not a milestone on this matter'}"></td>`;
      const tone = READY_TONE[TFW.itemTone(x, sdr)] || '';
      const due = !x.done && x.due ? `<div class="rd-due ${x.overdue ? 'late' : ''}">${x.overdue ? 'was due ' : 'due '}${esc(fmtDate(x.due, { day: 'numeric', month: 'short' }))}</div>` : '';
      return `<td><select class="cell ${x.status ? tone : ''}" title="${esc(x.title)}" onchange="TF.rdItem(${m.id}, ${x.id}, this.value)">${statusOptionsHTML(x.statuses, x.status)}</select>${due}</td>`;
    }).join('')}
    ${note('text2')}</tr>`;
}

/* ---------------- admin: checklist library ---------------- */
async function renderAdminChecklists(tabs) {
  const main = $('#main');
  let lib;
  try { lib = await api('GET', '/api/library'); } catch (e) { return errToast(e); }
  let sel = store('clKey');
  if (!lib.checklists.some(c => c.key === sel)) sel = lib.checklists.length ? lib.checklists[0].key : null;
  let detail = null;
  if (sel) { try { detail = await api('GET', '/api/library/' + encodeURIComponent(sel)); } catch (e) { return errToast(e); } }
  S.libDetail = detail;
  const clOptions = (cur, area) => `<option value="">No checklist</option>` + lib.checklists.filter(c => !area || (c.area || 'conv') === area).map(c => `<option value="${esc(c.key)}" ${c.key === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  main.innerHTML = tabs + `<div class="lib">
    <div class="lib-side">
      <div class="card">
        ${(lib.areas || [{ key: 'conv', label: 'Conveyancing' }]).map(a => `<h3 class="lib-area">${a.key === 'tax' ? '🔒 ' : ''}${esc(a.label)} checklists</h3>
          ${a.key === 'tax' ? '<p class="muted small" style="margin:-4px 0 6px">Only admins and staff with Taxation access see these and the tax jobs that use them.</p>' : ''}
          ${lib.checklists.filter(c => (c.area || 'conv') === a.key).map(c => `<div class="lib-item ${c.key === sel ? 'on' : ''}" onclick="TF.clPick('${esc(c.key)}')"><b>${esc(c.name)}</b><span class="muted small">${c.stages} stages · ${c.items} items${a.key === 'tax' ? '' : ` · ${c.milestones} ◆ milestones`}</span></div>`).join('') || '<p class="muted small">None yet.</p>'}
          <div class="row" style="margin:8px 0 14px;flex-wrap:wrap"><button class="sm" onclick="TF.clNew(null, '${a.key}')">+ New ${a.key === 'tax' ? 'taxation' : 'conveyancing'} checklist</button></div>`).join('')}
        ${sel ? `<button class="sm" onclick="TF.clNew('${esc(sel)}')">Copy the selected checklist</button>` : ''}
      </div>
      <div class="card" style="margin-top:12px">
        <h3>New matters get</h3>
        <p class="sec small" style="margin-top:-4px">The checklist each matter type starts with. You can still pick another one when opening a matter.</p>
        ${TFW.MATTER_TYPES.filter(t => lib.types[t.key] !== undefined || t.area !== 'tax').map(t => `<label class="f">${esc(t.short)} – ${esc(t.label)}<select onchange="TF.clType('${t.key}', this.value)">${clOptions(lib.types[t.key], t.area)}</select></label>`).join('')}
      </div>
    </div>
    <div class="lib-main">${detail ? libDetailHTML(detail) : '<div class="card empty">Create a checklist to get started.</div>'}</div>
  </div>`;
}
function libDetailHTML(d) {
  const c = d.checklist;
  const taxL = c.area === 'tax';
  const fromOpts = cur => TFW.STAGE_FROM.filter(f => !taxL || f.key !== 'finance' || cur === 'finance').map(f => `<option value="${f.key}" ${f.key === cur ? 'selected' : ''}>${taxL && f.key === 'settlement' ? 'Due date' : f.label}</option>`).join('');
  return `<div class="card" style="margin-bottom:12px">
      <div class="row" style="flex-wrap:wrap"><input value="${esc(c.name)}" style="font-size:16px;font-weight:600;max-width:420px" onchange="TF.clRename('${esc(c.key)}', this.value)" aria-label="Checklist name">
        <span class="spacer"></span>${d.resettable ? `<button class="sm" onclick="TF.clReset('${esc(c.key)}')">Reset to the Raikan defaults</button>` : ''}
        <button class="sm danger" onclick="TF.clDelete('${esc(c.key)}')">Delete checklist</button></div>
      <p class="sec small">Changes here apply to matters opened from now on. Matters already open keep their own copy – except ◆ milestone settings, which also update open matters that have the item.</p>
      ${taxL ? '<div class="ms-help small">🔒 <b>Taxation checklist</b> – only admins and staff with Taxation access see it. Stage dates count back from the tax job’s due date (period end / lodgement).</div>' : ''}
      <div class="ms-help small" style="${taxL ? 'display:none' : ''}"><b>◆ Milestones</b> are the items you want on the Readiness Board and the matter’s Gantt chart. Each one gets its due date automatically (from the stage, or a set number of days from opening / finance / settlement). Click ◆ next to an item to set it up.
        <span class="muted">This checklist has ${d.items.filter(t => t.ms).length} milestone${d.items.filter(t => t.ms).length === 1 ? '' : 's'}${d.items.some(t => t.ms) ? ': ' + d.items.filter(t => t.ms).map(t => esc(t.ms.label)).join(', ') : ''}.</span></div>
    </div>` +
    d.stages.map((s, i) => {
      const tops = d.items.filter(t => t.stage === s.key && !t.parent_id);
      return `<div class="card lib-stage">
        <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:8px">
          <input value="${esc(s.label)}" style="font-weight:600;max-width:260px" onchange="TF.stSave(${s.id}, {label: this.value})" aria-label="Stage name">
          <span class="muted small">Due</span><input type="number" value="${s.days}" style="width:72px" onchange="TF.stSave(${s.id}, {days: this.value})" aria-label="Days">
          <span class="muted small">days from</span><select style="width:auto" onchange="TF.stSave(${s.id}, {from: this.value})">${fromOpts(s.from_kind)}</select>
          <input value="${esc(s.when_text)}" placeholder="Note, e.g. Settlement − 2 weeks" style="max-width:220px" onchange="TF.stSave(${s.id}, {when: this.value})" aria-label="Stage note">
          <span class="spacer"></span>
          <button class="ghost sm" title="Move stage up" ${i === 0 ? 'disabled' : ''} onclick="TF.stSave(${s.id}, {move:-1}, true)">↑</button>
          <button class="ghost sm" title="Move stage down" ${i === d.stages.length - 1 ? 'disabled' : ''} onclick="TF.stSave(${s.id}, {move:1}, true)">↓</button>
          <button class="ghost sm danger" onclick="TF.stDelete(${s.id}, '${esc(s.label).replace(/'/g, '&#39;')}')">Delete stage</button>
        </div>
        <button class="sm ghost" onclick="TF.stToggle(${s.id})">${(S.libOpen || {})[s.id] ? '▾ Hide' : '▸ Show'} ${d.items.filter(t => t.stage === s.key).length} items</button>${d.items.filter(t => t.stage === s.key && t.ms).length ? ` <span class="muted small">◆ ${d.items.filter(t => t.stage === s.key && t.ms).map(t => esc(t.ms.label)).join(', ')}</span>` : ''}
        ${(S.libOpen || {})[s.id] ? `<div style="margin-top:6px">${tops.map(t => tplRow(t, false, c.key, s.key) + d.items.filter(x => x.parent_id === t.id).map(x => tplRow(x, true)).join('')).join('') || '<p class="muted small">No items in this stage yet.</p>'}
        <div class="row" style="margin-top:6px"><input placeholder="Add an item to ${esc(s.label)}" id="tadd_${esc(s.key)}" style="max-width:420px" onkeydown="if(event.key==='Enter')TF.tplAdd('${esc(c.key)}','${esc(s.key)}',null)"><button class="sm" onclick="TF.tplAdd('${esc(c.key)}','${esc(s.key)}',null)">Add item</button></div></div>` : ''}
      </div>`;
    }).join('') +
    `<div class="card"><h3>Add a stage</h3>
      <div class="row" style="flex-wrap:wrap;gap:8px"><input id="newStLabel" placeholder="Stage name, e.g. RTU / mortgagee consent" style="max-width:300px">
      <span class="muted small">Due</span><input id="newStDays" type="number" value="0" style="width:72px"><span class="muted small">days from</span><select id="newStFrom" style="width:auto">${fromOpts('opened')}</select>
      <button class="primary sm" onclick="TF.stAdd('${esc(c.key)}')">Add stage</button></div></div>`;
}
function msSummary(ms) {
  if (!ms) return '';
  const due = ms.from ? `${ms.days ? (ms.days > 0 ? '+' : '') + ms.days + ' days from ' : ''}${ms.from === 'opened' ? 'opening' : ms.from} ` : 'stage due date';
  return `<span class="pill p-violet ms-tag" title="Milestone: on the Readiness Board as “${esc(ms.label)}”, due ${esc(due)}">◆ ${esc(ms.label)}</span><span class="muted small">due: ${esc(due)}</span>`;
}
function tplRow(t, sub, clKey, stage) {
  return `<div class="row tpl-row ${t.ms ? 'is-ms' : ''}" style="${sub ? 'margin-left:28px' : ''}">
    <button class="ghost sm ${t.ms ? 'ms-on' : ''}" title="${t.ms ? 'Milestone settings' : 'Make this a milestone (Readiness Board column, Gantt chart, automatic due date)'}" onclick="TF.tplMs(${t.id})">◆</button>
    <input value="${esc(t.title)}" onchange="TF.tplSave(${t.id}, {title: this.value})" style="${sub ? 'height:28px;font-size:12.5px' : ''}">${msSummary(t.ms)}
    <button class="ghost sm" title="Move up" onclick="TF.tplSave(${t.id}, {move:-1}, true)">↑</button>
    <button class="ghost sm" title="Move down" onclick="TF.tplSave(${t.id}, {move:1}, true)">↓</button>
    ${sub ? '' : `<button class="ghost sm" title="Add a sub-item" onclick="TF.tplAdd('${esc(clKey)}','${esc(stage)}',${t.id})">＋ sub-item</button>`}
    <button class="ghost sm danger" title="Remove" onclick="TF.tplDel(${t.id})">✕</button></div>`;
}

/* ---------------- actions ---------------- */
function rerenderMatter() { const h = location.hash.split('/'); if (h[1] === 'matters' && h[2]) renderMatter(+h[2], h[3]); }
Object.assign(window.TF, {
  matterForm,
  async matterStatus(id, status) { try { await api('PUT', '/api/matters/' + id, { status }); await refreshMatterRefs(); toast('Matter marked ' + status); refreshView(); } catch (e) { errToast(e); } },
  async deleteMatter(id) {
    if (!(await askConfirm('Delete this matter?', 'Its checklist, tasks and attachments are deleted too. This can’t be undone.'))) return;
    try { await api('DELETE', '/api/matters/' + id); await refreshMatterRefs(); toast('Matter deleted'); location.hash = '#/matters'; } catch (e) { errToast(e); }
  },
  async applyChecklist(id, key) { try { await api('POST', `/api/matters/${id}/checklist/apply`, { checklist_key: key }); delete S.openStages[id]; closeModal(); toast('Checklist added'); rerenderMatter(); } catch (e) { errToast(e); } },
  async addChecklist(id) {
    let lib; try { lib = await api('GET', '/api/library'); } catch (e) { return errToast(e); }
    const def = lib.types[S.matter.type] || '';
    openModal(`<h2>Add a checklist</h2><p class="sec" style="margin-top:-6px">Its stages and items are added to this matter. Items the matter already has aren’t added twice.</p>
      <label class="f">Checklist<select id="addClSel">${lib.checklists.filter(c => (c.area || 'conv') === TFW.areaOf(S.matter.type)).map(c => `<option value="${esc(c.key)}" ${c.key === def ? 'selected' : ''}>${esc(c.name)} (${c.stages} stages, ${c.items} items)</option>`).join('')}</select></label>
      <div class="foot"><button onclick="TF.closeModal()">Cancel</button><button class="primary" onclick="TF.applyChecklist(${id}, $('#addClSel').value)">Add checklist</button></div>`);
  },
  stageToggle(mid, key) { const o = S.openStages[mid] || (S.openStages[mid] = {}); o[key] = !o[key]; drawChecklist(S.matter); },
  stagesAll(mid, val) { S.openStages[mid] = Object.fromEntries(S.matter.stages.map(s => [s.key, val])); drawChecklist(S.matter); },
  async itemSet(id, patch, redraw) {
    try {
      await api('PUT', '/api/items/' + id, patch);
      if (redraw) rerenderMatter();
      else { const row = document.querySelector(`.ci[data-id="${id}"]`); if (row) { row.classList.add('saved'); setTimeout(() => row.classList.remove('saved'), 600); } }
    } catch (e) { errToast(e); rerenderMatter(); }
  },
  async itemAdd(mid, stage, parentId) {
    const inp = $('#add_' + stage);
    const title = parentId ? ((await askText('Add a sub-item', { placeholder: 'Sub-item name', ok: 'Add' })) || '').trim() : inp && inp.value.trim();
    if (!title) return;
    try { await api('POST', `/api/matters/${mid}/items`, { stage, title, parent_id: parentId || null }); rerenderMatter(); } catch (e) { errToast(e); }
  },
  itemAddSub(id, stage) { TF.itemAdd(S.matter.id, stage, id); },
  async itemDel(id) { if (!(await askConfirm('Remove this item from the checklist?', '', 'Remove'))) return; try { await api('DELETE', '/api/items/' + id); rerenderMatter(); } catch (e) { errToast(e); } },
  itemNote(id) {
    const all = S.matter.stages.flatMap(s => s.items.flatMap(i => [i, ...i.children]));
    const it = all.find(x => x.id === id); if (!it) return;
    openModal(`<h2>${esc(it.title)}</h2><p class="sec small" style="margin-top:-6px">Notes, contact details, or why a date changed.</p>
      <textarea id="itNote" rows="7" autofocus>${esc(it.note)}</textarea>
      <div class="foot"><button onclick="TF.closeModal()">Cancel</button><button class="primary" id="itSave">Save</button></div>`);
    $('#itSave').onclick = async () => { try { await api('PUT', '/api/items/' + id, { note: $('#itNote').value }); closeModal(); rerenderMatter(); } catch (e) { errToast(e); } };
  },
  itemAssign(id, stageKey) {
    const all = S.matter.stages.flatMap(s => s.items.flatMap(i => [i, ...i.children]));
    const it = all.find(x => x.id === id); const st = S.matter.stages.find(s => s.key === stageKey);
    openModal(`<h2>Assign as a task</h2><p class="sec" style="margin-top:-6px">${esc(it.title)} · ${esc(st.label)} · ${esc(S.matter.code)} ${esc(TYPE_SHORT[S.matter.type])}</p>
      <form id="asForm"><div class="grid3">
        <label class="f">Assign to<select name="assignee_id">${userOptions(it.person_id || S.me.id, false)}</select></label>
        <label class="f">Due${it.ms && it.due ? ' <span class="muted">(milestone date)</span>' : ''}<input type="date" name="due_date" value="${esc(it.due || st.due || '')}"></label>
        <label class="f">Priority<select name="priority">${PRIORITY.map(p => `<option value="${p.key}" ${p.key === 'normal' ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label></div>
        <label class="f">Instructions<textarea name="description" rows="3" placeholder="Anything they need to know"></textarea></label>
        <p class="muted small">When the task is moved to Done, this checklist item is marked Done too.</p>
        <div class="foot"><button type="button" onclick="TF.closeModal()">Cancel</button><button class="primary">Create task</button></div></form>`);
    $('#asForm').onsubmit = async e => {
      e.preventDefault();
      try { await api('POST', `/api/items/${id}/assign`, Object.fromEntries(new FormData(e.target))); closeModal(); toast('Task created'); rerenderMatter(); } catch (err) { errToast(err); }
    };
  },
  async rdSet(mid, key, value, redraw) {
    try {
      const m = await api('PUT', `/api/matters/${mid}/readiness`, { key, value });
      if (redraw) return rerenderMatter();
      const tr = document.querySelector(`tr[data-mid="${mid}"]`);
      if (tr && m && m.id) tr.outerHTML = rdRow(m, S.rdCols || []);
    } catch (e) { errToast(e); }
  },
  async rdItem(mid, itemId, value) {
    try {
      const r = await api('PUT', '/api/items/' + itemId, { status: value });
      const tr = document.querySelector(`tr[data-mid="${mid}"]`);
      if (tr && r.matter) tr.outerHTML = rdRow(r.matter, S.rdCols || []);
    } catch (e) { errToast(e); renderReadiness(); }
  },
  rdFilter(k, v) { const f = rdFilters(); f[k] = v; store('rdf', f); renderReadiness(); },
  rdType(k) { const f = rdFilters(); f.types = !k ? [] : f.types.includes(k) ? f.types.filter(x => x !== k) : [...f.types, k]; store('rdf', f); renderReadiness(); },
  async itemMs(id, on) {
    try { await api('PUT', '/api/items/' + id, { ms: on ? {} : null }); toast(on ? 'Marked as a milestone' : 'No longer a milestone'); rerenderMatter(); } catch (e) { errToast(e); }
  },
  ganttEdit(id) {
    const x = (S.matter.milestones || []).find(i => i.id === id); if (!x) return;
    openModal(`<h2>◆ ${esc(x.label)}</h2><p class="sec small" style="margin-top:-6px">${esc(x.title)} · ${esc(x.stage_label)} · ${x.due ? 'due ' + esc(fmtDate(x.due)) : 'no date yet'}</p>
      <div class="grid2"><label class="f">Status<select id="geSt">${statusOptionsHTML(x.statuses, x.status)}</select></label>
      <label class="f">Person<select id="gePer"><option value="">–</option>${S.users.filter(u => u.active || u.id === x.person_id).map(u => `<option value="${u.id}" ${u.id === x.person_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label></div>
      <div class="foot"><button onclick="TF.itemAssign(${x.id}, '${esc(x.stage)}')">➜ Assign as a task</button><span class="spacer"></span><button onclick="TF.closeModal()">Cancel</button><button class="primary" id="geSave">Save</button></div>`);
    $('#geSave').onclick = async () => { try { await api('PUT', '/api/items/' + id, { status: $('#geSt').value, person_id: $('#gePer').value || null }); closeModal(); rerenderMatter(); } catch (e) { errToast(e); } };
  },
  tplMs(id) {
    const d = S.libDetail; const t = d && d.items.find(i => i.id === id); if (!t) return;
    const ms = t.ms || { label: t.title.length > 24 ? '' : t.title, statuses: [], ready: [], readySdr: [], gstOnly: false, from: '', days: null, lead: null };
    const st = d.stages.find(s => s.key === t.stage) || {};
    const fromOpts = [['', `The stage’s due date (${st.days ? st.days + ' days from ' : ''}${(TFW.STAGE_FROM.find(f => f.key === st.from_kind) || { label: '' }).label.toLowerCase()})`], ['opened', 'Days from matter opened'], ['finance', 'Days from finance date'], ['settlement', 'Days from settlement date']];
    openModal(`<h2>◆ Milestone – ${esc(t.title)}</h2>
      <p class="sec small" style="margin-top:-6px">A milestone is a column on the Readiness Board and a bar on each matter’s Gantt chart, with its due date worked out automatically.</p>
      <label class="row small" style="gap:8px;margin-bottom:12px"><input type="checkbox" id="msOn" ${t.ms ? 'checked' : ''} style="width:auto;height:auto"> <b>This item is a milestone</b></label>
      <div id="msBody">
      <div class="grid2"><label class="f">Column name on the Readiness Board<input id="msLabel" value="${esc(ms.label)}" placeholder="${esc(t.title.slice(0, 24))}" maxlength="40"></label>
        <label class="f">Work starts <span class="muted">(days before due – for the Gantt bar)</span><input id="msLead" type="number" min="0" value="${ms.lead == null ? '' : ms.lead}" placeholder="When the stage opens"></label></div>
      <div class="grid2"><label class="f">Due date<select id="msFrom">${fromOpts.map(([k, l]) => `<option value="${k}" ${ms.from === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="f" id="msDaysBox">Days <span class="muted">(minus = before, e.g. −14)</span><input id="msDays" type="number" value="${ms.days == null ? 0 : ms.days}"></label></div>
      <label class="f">Status labels <span class="muted">(one per line – leave blank to use the normal checklist labels)</span><textarea id="msStatuses" rows="4" placeholder="Requested&#10;Received&#10;Stuck">${esc(ms.statuses.join('\n'))}</textarea></label>
      <div class="f small" style="margin-bottom:10px"><div class="sec" style="margin-bottom:4px">Counts as done <span class="muted">(green on the board)</span></div><div id="msReady" class="ms-ready"></div></div>
      <div class="grid2"><label class="f">Done when SDR is claimed <span class="muted">(optional, comma separated)</span><input id="msSdr" value="${esc(ms.readySdr.join(', '))}" placeholder="e.g. SDR Confirm"></label>
        <label class="row small" style="gap:8px;margin-top:18px"><input type="checkbox" id="msGst" ${ms.gstOnly ? 'checked' : ''} style="width:auto;height:auto"> Only when “GST applies” is ticked</label></div>
      ${d.open_matters ? `<label class="row small" style="gap:8px"><input type="checkbox" id="msAdd" ${t.ms ? '' : 'checked'} style="width:auto;height:auto"> Also add it to the ${d.open_matters} open matter${d.open_matters === 1 ? '' : 's'} using this checklist that don’t have the item yet</label>` : ''}
      </div>
      <div class="foot"><button onclick="TF.closeModal()">Cancel</button><button class="primary" id="msSave">Save</button></div>`, true);
    const body = $('#msBody'), on = $('#msOn');
    const readyBox = () => {
      const labels = $('#msStatuses').value.split('\n').map(x => x.trim()).filter(Boolean);
      const list = labels.length ? labels : TFW.COMPLETE;
      const cur = new Set(($('#msReady').dataset.cur ? JSON.parse($('#msReady').dataset.cur) : (ms.ready.length ? ms.ready : list.filter(TFW.isComplete))));
      $('#msReady').innerHTML = labels.length ? list.map(l => `<label class="chip ${cur.has(l) ? 'on' : ''}"><input type="checkbox" value="${esc(l)}" ${cur.has(l) ? 'checked' : ''} style="display:none">${esc(l)}</label>`).join('') : '<span class="muted">The normal finished labels (Done, Received, Signed, Not Required …)</span>';
      $$('#msReady input').forEach(c => c.onchange = () => { c.parentElement.classList.toggle('on', c.checked); $('#msReady').dataset.cur = JSON.stringify($$('#msReady input').filter(i => i.checked).map(i => i.value)); });
    };
    const sync = () => { body.style.opacity = on.checked ? 1 : .45; body.style.pointerEvents = on.checked ? '' : 'none'; $('#msDaysBox').style.visibility = $('#msFrom').value ? '' : 'hidden'; };
    on.onchange = sync; $('#msFrom').onchange = sync; $('#msStatuses').oninput = readyBox; readyBox(); sync();
    $('#msSave').onclick = async () => {
      const payload = on.checked ? { label: $('#msLabel').value.trim() || t.title.slice(0, 40), lead: $('#msLead').value, from: $('#msFrom').value, days: $('#msFrom').value ? $('#msDays').value : null,
        statuses: $('#msStatuses').value, ready: $$('#msReady input').filter(i => i.checked).map(i => i.value), readySdr: $('#msSdr').value, gstOnly: $('#msGst').checked } : null;
      try {
        const r = await api('PUT', '/api/checklist-templates/' + id, { ms: payload, add_to_open: !!($('#msAdd') && $('#msAdd').checked) });
        closeModal();
        toast(payload ? `Milestone saved${r.updated ? ` · ${r.updated} open item${r.updated === 1 ? '' : 's'} updated` : ''}${r.added ? ` · added to ${r.added} matter${r.added === 1 ? '' : 's'}` : ''}` : 'No longer a milestone');
        renderAdmin('checklists');
      } catch (e) { errToast(e); }
    };
  },
  stToggle(id) { S.libOpen = S.libOpen || {}; S.libOpen[id] = !S.libOpen[id]; renderAdmin('checklists'); },
  clPick(k) { store('clKey', k); renderAdmin('checklists'); },
  async clNew(copyFrom, area) {
    const name = ((await askText(copyFrom ? 'Copy checklist' : area === 'tax' ? 'New taxation checklist' : 'New checklist', { placeholder: area === 'tax' ? 'Checklist name, e.g. DBS - New client, or BAS quarterly' : 'Checklist name, e.g. LD – Land division (Torrens)', ok: 'Create', text: copyFrom ? 'The copy starts with the same stages and items.' : 'It starts empty. Add stages, then items.' })) || '').trim();
    if (!name) return;
    try { const r = await api('POST', '/api/library', { name, copy_from: copyFrom || null, area: area || 'conv' }); store('clKey', r.key); toast('Checklist created'); renderAdmin('checklists'); } catch (e) { errToast(e); }
  },
  async clRename(k, name) { try { await api('PUT', '/api/library/' + encodeURIComponent(k), { name }); toast('Saved'); renderAdmin('checklists'); } catch (e) { errToast(e); } },
  async clDelete(k) {
    if (!(await askConfirm('Delete this checklist?', 'Its stages and items are removed from the library. Matters already open keep their copy.'))) return;
    try { await api('DELETE', '/api/library/' + encodeURIComponent(k)); store('clKey', null); toast('Checklist deleted'); renderAdmin('checklists'); } catch (e) { errToast(e); }
  },
  async clType(type, key) { try { await api('PUT', '/api/library-types', { [type]: key }); toast('Saved'); } catch (e) { errToast(e); } },
  async clReset(k) {
    if (!(await askConfirm('Reset this checklist?', 'Its stages and items go back to the Raikan defaults. Matters already open are not changed.', 'Replace'))) return;
    try { await api('POST', `/api/library/${encodeURIComponent(k)}/reset`); toast('Checklist reset'); renderAdmin('checklists'); } catch (e) { errToast(e); }
  },
  async stSave(id, patch, redraw) { try { await api('PUT', '/api/library-stages/' + id, patch); if (redraw) renderAdmin('checklists'); else toast('Saved'); } catch (e) { errToast(e); } },
  async stDelete(id, label) {
    if (!(await askConfirm(`Delete the stage “${label}”?`, 'Its items are removed from this checklist too.'))) return;
    try { await api('DELETE', '/api/library-stages/' + id); renderAdmin('checklists'); } catch (e) { errToast(e); }
  },
  async stAdd(k) {
    const label = $('#newStLabel').value.trim(); if (!label) return toast('Enter the stage name first.', true);
    try { await api('POST', `/api/library/${encodeURIComponent(k)}/stages`, { label, days: $('#newStDays').value, from: $('#newStFrom').value }); renderAdmin('checklists'); } catch (e) { errToast(e); }
  },
  async tplSave(id, patch, redraw) { try { await api('PUT', '/api/checklist-templates/' + id, patch); if (redraw) renderAdmin('checklists'); else toast('Saved'); } catch (e) { errToast(e); } },
  async tplDel(id) { if (!(await askConfirm('Remove this item?', 'Its sub-items are removed too.', 'Remove'))) return; try { await api('DELETE', '/api/checklist-templates/' + id); renderAdmin('checklists'); } catch (e) { errToast(e); } },
  async tplAdd(clKey, stage, parentId) {
    const title = parentId ? ((await askText('Add a sub-item', { placeholder: 'Sub-item name', ok: 'Add' })) || '').trim() : (($('#tadd_' + stage) || {}).value || '').trim();
    if (!title) return parentId ? null : toast('Enter the item first.', true);
    try { await api('POST', '/api/checklist-templates', { checklist_key: clKey, stage, parent_id: parentId, title }); renderAdmin('checklists'); } catch (e) { errToast(e); }
  },
});
