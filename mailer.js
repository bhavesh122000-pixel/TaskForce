// Email alerts (SMTP settings are entered in Admin > Email alerts)
const nodemailer = require('nodemailer');

async function smtpConfig(getSetting) {
  return {
    host: await getSetting('smtp_host'),
    port: parseInt(await getSetting('smtp_port', '587'), 10) || 587,
    secure: await getSetting('smtp_secure', '0') === '1',
    user: await getSetting('smtp_user'),
    pass: await getSetting('smtp_pass'),
    from: await getSetting('smtp_from') || await getSetting('smtp_user'),
  };
}
async function isConfigured(getSetting) { const c = await smtpConfig(getSetting); return !!(c.host && c.from); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function sendMail(getSetting, { to, subject, text, link }) {
  if (!await isConfigured(getSetting) || !to) return false;
  const c = await smtpConfig(getSetting);
  const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined });
  const appUrl = (await getSetting('app_url') || '').replace(/\/$/, '');
  const fullLink = link && appUrl ? appUrl + link : '';
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222">
    <p style="margin:0 0 12px">${escapeHtml(text).replace(/\n/g, '<br>')}</p>
    ${fullLink ? `<p><a href="${escapeHtml(fullLink)}" style="background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open in TaskForce</a></p>` : ''}
    <p style="color:#888;font-size:12px;margin-top:20px">Sent by TaskForce. You can turn off email alerts under My account.</p></div>`;
  await transport.sendMail({ from: c.from, to, subject: '[TaskForce] ' + subject, text: text + (fullLink ? '\n\n' + fullLink : ''), html });
  return true;
}

module.exports = { sendMail, isConfigured };
