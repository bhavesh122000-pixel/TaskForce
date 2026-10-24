// Reads .eml and Outlook .msg files: the email itself (for the Read view)
// and the files attached inside it (so they can be previewed in TaskForce).
const fs = require('fs');
const { simpleParser } = require('mailparser');
const MsgReader = require('@kenjiuno/msgreader').default;

const MAX_BODY = 30000;

function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

async function readEml(buf) {
  const m = await simpleParser(buf);
  const addr = a => (a && a.text) || '';
  const parts = (m.attachments || [])
    .filter(a => !(a.related || (a.contentDisposition === 'inline' && a.cid && /^image\//.test(a.contentType))))
    .map((a, i) => ({ filename: a.filename || `attachment-${i + 1}`, mime: a.contentType || '', bytes: a.content }));
  return {
    meta: { subject: m.subject || '', from: addr(m.from), to: addr(m.to), cc: addr(m.cc), date: m.date ? m.date.toISOString() : '',
      body: (m.text || htmlToText(m.html) || '').slice(0, MAX_BODY), attachments: parts.map(p => p.filename) },
    parts,
  };
}

function readMsg(buf) {
  const reader = new MsgReader(buf);
  const d = reader.getFileData();
  if (d.error) throw new Error(d.error);
  const recips = d.recipients || [];
  const fmt = r => (r.name && r.email && r.name !== r.email) ? `${r.name} <${r.email}>` : (r.email || r.name || '');
  const senderAddr = d.senderSmtpAddress || (d.senderEmail && d.senderEmail.includes('@') ? d.senderEmail : '') || d.creatorSMTPAddress || '';
  let from = d.senderName ? (senderAddr && senderAddr !== d.senderName ? `${d.senderName} <${senderAddr}>` : d.senderName) : senderAddr;
  if (!from && d.headers) { const mm = /^From:\s*(.+(?:\r?\n[ \t].+)*)/mi.exec(d.headers); if (mm) from = mm[1].replace(/\s+/g, ' ').trim(); }
  if (!from) from = d.inetAcctName || d.senderEmail || '';
  let date = d.messageDeliveryTime || d.clientSubmitTime || '';
  if (date) { const dt = new Date(date); if (!isNaN(dt)) date = dt.toISOString(); }
  const parts = [];
  (d.attachments || []).forEach((a, i) => {
    if (a.attachmentHidden || (a.pidContentId && /^image\//.test(a.attachMimeTag || ''))) return; // signature / inline images
    try {
      const x = reader.getAttachment(a);
      let name = x.fileName || a.fileName || (a.innerMsgContent ? `${(a.innerMsgContentFields && a.innerMsgContentFields.subject) || 'Attached email'}.msg` : `attachment-${i + 1}`);
      parts.push({ filename: name, mime: a.attachMimeTag || '', bytes: Buffer.from(x.content) });
    } catch (e) { console.error('[email parse] attachment skipped:', e.message); }
  });
  return {
    meta: { subject: d.subject || '', from, to: recips.filter(r => !r.recipType || r.recipType === 'to').map(fmt).join(', '), cc: recips.filter(r => r.recipType === 'cc').map(fmt).join(', '),
      date, body: String(d.body || htmlToText(d.bodyHtml) || '').slice(0, MAX_BODY), attachments: parts.map(p => p.filename) },
    parts,
  };
}

// Returns { meta, parts } or null if the file couldn't be read
async function readEmailFile(filePath, filename) {
  try {
    const buf = fs.readFileSync(filePath);
    if (/\.eml$/i.test(filename)) return await readEml(buf);
    if (/\.msg$/i.test(filename)) return readMsg(buf);
  } catch (e) { console.error('[email parse] could not read', filename, e.message); }
  return null;
}

module.exports = { readEmailFile };
