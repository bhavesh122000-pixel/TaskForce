/* TaskForce – previewing attachments, reading emails (with their attachments) and opening files in Outlook / Word */
'use strict';

const PREVIEW_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'csv', 'docx'];
const OPEN_EXT = ['msg', 'eml', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'rtf', 'jpg', 'jpeg', 'png', 'gif', 'ppt', 'pptx'];
const extOf = n => (String(n || '').split('.').pop() || '').toLowerCase();
const canPreview = n => PREVIEW_EXT.includes(extOf(n));
const canOpen = n => OPEN_EXT.includes(extOf(n));
const fileUrl = (kind, id) => kind === 'part' ? `/api/parts/${id}` : `/api/attachments/${id}`;
const MIME_BY_EXT = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv' };

async function getBlob(kind, id) {
  if (window.TF_LOCAL && TF_LOCAL.getBlob) return TF_LOCAL.getBlob(kind, id);
  const r = await fetch(fileUrl(kind, id));
  if (!r.ok) { let m = 'Couldn’t load the file.'; try { m = (await r.json()).error || m; } catch { /* not json */ } throw new Error(m); }
  return r.blob();
}
function downloadFile(kind, id) {
  if (window.TF_LOCAL && TF_LOCAL.downloadKind) return TF_LOCAL.downloadKind(kind, id);
  location.href = fileUrl(kind, id);
}
let mammothLoading = null;
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  if (!mammothLoading) mammothLoading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'vendor/mammoth.js';
    s.onload = () => res(window.mammoth); s.onerror = () => rej(new Error('Word preview isn’t available.'));
    document.head.appendChild(s);
  });
  return mammothLoading;
}

// PDF pages drawn with pdf.js (used where the browser's own PDF viewer can't be embedded)
let pdfjsLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsLoading) pdfjsLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js'; res(window.pdfjsLib); };
    s.onerror = () => rej(new Error('PDF preview isn’t available here. Download the file instead.'));
    document.head.appendChild(s);
  });
  return pdfjsLoading;
}
async function renderPdfPages(box, blob) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  box.innerHTML = '<div class="pv-pdf"></div>';
  const wrap = box.firstChild;
  const width = Math.min(box.clientWidth - 24, 900) || 700;
  for (let n = 1; n <= Math.min(pdf.numPages, 40); n++) {
    const page = await pdf.getPage(n);
    const v0 = page.getViewport({ scale: 1 });
    const scale = width / v0.width, ratio = window.devicePixelRatio || 1;
    const vp = page.getViewport({ scale: scale * ratio });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height; c.style.width = (vp.width / ratio) + 'px';
    wrap.appendChild(c);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  }
  if (pdf.numPages > 40) wrap.insertAdjacentHTML('beforeend', `<div class="pv-empty">Showing the first 40 of ${pdf.numPages} pages. Download the file to see the rest.</div>`);
}

// Render a file into a container element
async function renderPreview(box, kind, id, filename) {
  const ext = extOf(filename);
  box.innerHTML = '<div class="pv-empty">Loading preview…</div>';
  try {
    if (!canPreview(filename)) {
      box.innerHTML = `<div class="pv-empty">There’s no preview for ${esc(ext.toUpperCase() || 'this')} files.${canOpen(filename) ? '<br>Use <b>Open in ' + appName(filename) + '</b> or Download.' : '<br>Download it to open it.'}</div>`;
      return;
    }
    let blob = await getBlob(kind, id);
    if (MIME_BY_EXT[ext] && blob.type !== MIME_BY_EXT[ext]) blob = new Blob([blob], { type: MIME_BY_EXT[ext] });
    if (ext === 'pdf' && window.TF_LOCAL && TF_LOCAL.usePdfJs) {
      await renderPdfPages(box, blob);
    } else if (ext === 'pdf') {
      const url = URL.createObjectURL(blob);
      box.innerHTML = `<iframe class="pv-frame" src="${url}#view=FitH" title="${esc(filename)}"></iframe>`;
    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      box.innerHTML = `<div class="pv-img"><img src="${URL.createObjectURL(blob)}" alt="${esc(filename)}"></div>`;
    } else if (ext === 'txt' || ext === 'csv') {
      const text = await blob.text();
      box.innerHTML = `<pre class="pv-text">${esc(text.slice(0, 200000))}</pre>`;
    } else if (ext === 'docx') {
      const mammoth = await loadMammoth();
      const out = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
      const doc = new DOMParser().parseFromString(out.value, 'text/html');
      doc.querySelectorAll('script,iframe,object,embed,link,style').forEach(x => x.remove());
      doc.querySelectorAll('*').forEach(el => [...el.attributes].forEach(a => { if (/^on/i.test(a.name) || (a.name === 'href' && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name); }));
      box.innerHTML = `<div class="pv-doc">${doc.body.innerHTML || '<p class="muted">This document looks empty.</p>'}</div>`;
    }
  } catch (e) {
    box.innerHTML = `<div class="pv-empty">${esc(e.message || 'Couldn’t show a preview.')}</div>`;
  }
}
function appName(filename) {
  const e = extOf(filename);
  if (e === 'msg' || e === 'eml') return 'Outlook';
  if (['doc', 'docx', 'rtf'].includes(e)) return 'Word';
  if (['xls', 'xlsx', 'csv'].includes(e)) return 'Excel';
  if (['ppt', 'pptx'].includes(e)) return 'PowerPoint';
  if (e === 'pdf') return 'PDF viewer';
  return 'app';
}
function fileButtons(kind, id, filename) {
  return `${canOpen(filename) && !(window.TF_LOCAL && TF_LOCAL.noOpenLinks) ? `<button class="sm" onclick="TF.openInApp('${kind}', ${id})" title="Opens a temporary copy – nothing is saved to your folders">Open in ${appName(filename)}</button>` : ''}
    <button class="sm" onclick="TF.dl('${kind}', ${id})">Download</button>`;
}

// Preview any task attachment in a pop-up
function previewFile(kind, id, filename) {
  openModal(`<div class="row" style="margin-bottom:10px"><h2 style="margin:0;flex:1;word-break:break-all">${esc(filename)}</h2>${fileButtons(kind, id, filename)}<button class="sm primary" onclick="TF.closeModal()">Close</button></div>
    <div id="pvBox" class="pv-box"></div>`, true);
  $('#modal').classList.add('modal-xl');
  renderPreview($('#pvBox'), kind, id, filename);
}

// Read an attached email, with its own attachments listed and previewable
async function readEmail(attId) {
  const a = ((S.drawerTask && S.drawerTask.attachments) || []).find(x => x.id === attId) || { id: attId, filename: 'email.msg' };
  openModal(`<div class="pv-empty">Opening email…</div>`, true);
  $('#modal').classList.add('modal-xl');
  let r;
  try { r = await api('GET', `/api/attachments/${attId}/parts`); } catch (e) { closeModal(); return errToast(e); }
  const m = r.meta || a.email_meta || {};
  $('#modal').innerHTML = `
    <div class="row" style="align-items:flex-start;margin-bottom:8px"><h2 style="margin:0;flex:1">${esc(m.subject || '(no subject)')}</h2>
      ${fileButtons('attachment', a.id, a.filename)}<button class="sm primary" onclick="TF.closeModal()">Close</button></div>
    <div class="email-head">
      <div><span class="muted">From:</span> ${esc(m.from || '')}</div>
      ${m.to ? `<div><span class="muted">To:</span> ${esc(m.to)}</div>` : ''}
      ${m.cc ? `<div><span class="muted">Cc:</span> ${esc(m.cc)}</div>` : ''}
      ${m.date ? `<div><span class="muted">Date:</span> ${new Date(m.date).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</div>` : ''}
    </div>
    ${r.parts.length ? `<div class="em-atts">${r.parts.map(p => { const k = fileKind(p.filename); return `<div class="em-att" data-pid="${p.id}" onclick="TF.showPart(${p.id})" title="${canPreview(p.filename) ? 'Click to preview' : 'No preview – open or download'}">
        <span class="ficon ${k.cls}">${k.label}</span><span class="em-att-name">${esc(p.filename)}<span class="muted small"> ${fmtSize(p.size)}</span></span></div>`; }).join('')}</div>` : ''}
    <div id="emPart" class="hidden"><div class="row" style="margin:8px 0"><b id="emPartName" style="flex:1;word-break:break-all"></b><span id="emPartBtns" class="row" style="gap:6px"></span><button class="sm ghost" onclick="TF.hidePart()">Back to email</button></div><div id="emPartBox" class="pv-box"></div></div>
    <div id="emBody" class="email-body">${esc(m.body || '(This email has no text body.)')}</div>`;
  S.emailParts = r.parts;
  const first = r.parts.find(p => canPreview(p.filename));
  if (first && r.parts.length === 1) showPart(first.id);
}
function showPart(pid) {
  const p = (S.emailParts || []).find(x => x.id === pid); if (!p) return;
  $$('.em-att').forEach(x => x.classList.toggle('on', +x.dataset.pid === pid));
  $('#emPart').classList.remove('hidden'); $('#emBody').classList.add('hidden');
  $('#emPartName').textContent = p.filename;
  $('#emPartBtns').innerHTML = fileButtons('part', p.id, p.filename);
  renderPreview($('#emPartBox'), 'part', p.id, p.filename);
}
function hidePart() { $('#emPart').classList.add('hidden'); $('#emBody').classList.remove('hidden'); $$('.em-att').forEach(x => x.classList.remove('on')); }

// Open straight in Outlook / Word through the small helper installed on each PC
async function openInApp(kind, id) {
  try {
    const r = await api('POST', '/api/open-link', { kind, id });
    const url = `${location.origin}/api/open/${r.token}/${encodeURIComponent(r.filename)}`;
    const b64 = btoa(unescape(encodeURIComponent(url))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    let launched = false;
    const onBlur = () => { launched = true; };
    window.addEventListener('blur', onBlur, { once: true });
    location.href = 'taskforce-open:' + b64;
    toast(`Opening ${r.filename} in ${appName(r.filename)}…`);
    setTimeout(() => {
      window.removeEventListener('blur', onBlur);
      if (!launched && !store('openerOk')) openerHint();
    }, 4000);
  } catch (e) { errToast(e); }
}
function openerHint() {
  let b = $('#openerHint');
  if (!b) { b = document.createElement('div'); b.id = 'openerHint'; b.className = 'hint-card'; document.body.appendChild(b); }
  b.innerHTML = `<b>Nothing opened?</b><div class="small" style="margin:4px 0 8px">This PC needs the one-off “Open in Outlook” setup first. If Outlook did open, you can ignore this.</div>
    <div class="row"><button class="sm primary" onclick="TF.getOpener()">Set up this PC</button><button class="sm" onclick="TF.openerWorks()">It opened</button><button class="sm ghost" onclick="this.closest('.hint-card').remove()">Close</button></div>`;
}
function openerSetupHTML() {
  if (window.TF_LOCAL && TF_LOCAL.noOpenLinks) return '';
  return `<h3 style="margin-top:16px">Open emails in Outlook</h3>
    <p class="sec small" style="margin-top:-4px">One-off setup on each PC. After it, <b>Open in Outlook</b> opens attached emails and documents straight in Outlook, Word or your PDF viewer. A temporary copy is used, so nothing is saved into your folders.</p>
    <button type="button" class="sm" onclick="TF.getOpener()">Download the setup for this PC</button>
    <span class="muted small">Run the file it downloads (double-click). No admin rights needed.</span>`;
}

Object.assign(window.TF, {
  dl: downloadFile,
  preview: previewFile,
  readEmail, showPart, hidePart, openInApp,
  getOpener() {
    if (window.TF_LOCAL) return toast('The Outlook helper is set up from the office version of TaskForce.', true);
    location.href = '/api/opener-installer';
    store('openerOk', true);
    const h = $('#openerHint'); if (h) h.remove();
    toast('Run the downloaded file, then click Open again.');
  },
  openerWorks() { store('openerOk', true); const h = $('#openerHint'); if (h) h.remove(); },
});
