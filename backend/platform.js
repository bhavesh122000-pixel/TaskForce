const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { readEmailFile } = require('../emailparse');
const { sendMail, isConfigured } = require('../mailer');
const { TABLES } = require('./postgres');

const passwords = {
  async hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
  },
  async checkPassword(password, stored) {
    const [salt, hash] = String(stored).split(':');
    return !!salt && /^[a-f0-9]{128}$/.test(hash || '') && crypto.timingSafeEqual(crypto.scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
  },
  randomToken: () => crypto.randomBytes(32).toString('hex'),
};
function mimeFor(filename) {
  return ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', eml: 'message/rfc822' })[path.extname(filename || '').slice(1).toLowerCase()] || 'application/octet-stream';
}

function createCloudPlatform({ db, storage, loginModeOverride = null }) {
  const requestContext = new AsyncLocalStorage();
  const platform = {
    ...passwords, storageMode: 'supabase', supportsOpenLinks: true, supportsLoginCodes: true, loginModeOverride,
    mailConfigured: isConfigured,
    sendMail(get, options) {
      const promise = sendMail(get, options);
      const context = requestContext.getStore();
      if (context) context.mail.push(promise);
      return promise;
    },
    async storeFile(file) {
      if (!file.direct) await storage.put(file.stored, await fs.readFile(file.path), file.type || mimeFor(file.name));
      return file.stored;
    },
    async storeBytes(bytes, filename) { const name = storage.randomName(filename); await storage.put(name, Buffer.from(bytes), mimeFor(filename)); return name; },
    async readEmail(source, filename) {
      if (source.upload?.path) return readEmailFile(source.upload.path, filename);
      const name = source.upload?.stored || source.stored_name;
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tf-email-'));
      try { const file = path.join(dir, 'email'); await fs.writeFile(file, await storage.get(name)); return await readEmailFile(file, filename); }
      finally { await fs.rm(dir, { recursive: true, force: true }); }
    },
    async discardUpload(file) {
      if (file.path) await fs.rm(file.path, { force: true });
      if (file.direct) await storage.remove([file.stored]);
    },
    async deleteFile(name) {
      // Delete after database commit so a rolled-back request cannot lose a file.
      const context = requestContext.getStore();
      if (context) context.deletions.push(name); else await storage.remove([name]);
    },
    defaultBackupDir: () => 'Supabase private backups',
    async backup(get, set) {
      const prefix = 'backups/' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(4).toString('hex');
      const data = {};
      for (const table of TABLES) data[table] = await db.prepare(`SELECT * FROM ${table}`).all();
      const names = [...new Set([...data.attachments, ...data.email_parts].map(file => file.stored_name))];
      for (const name of names) await storage.copy(name, `${prefix}/files/${name}`);
      await storage.put(`${prefix}/database.json`, Buffer.from(JSON.stringify({ version: 1, schema: db.schema, tables: data })), 'application/json');
      const d = new Date(), p = n => String(n).padStart(2, '0');
      await set('last_backup', `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} → ${prefix}`);
      const keep = Math.max(1, parseInt(await get('backup_keep', '14'), 10) || 14);
      const old = (await storage.list('backups')).filter(item => item.id == null).sort((a, b) => a.name.localeCompare(b.name));
      while (old.length > keep) {
        const folder = old.shift().name;
        const files = await storage.list(`backups/${folder}/files`);
        await storage.remove([...files.map(file => `backups/${folder}/files/${file.name}`), `backups/${folder}/database.json`]);
      }
      return prefix;
    },
    async withRequest(callback) {
      const context = { mail: [], deletions: [] };
      const result = await requestContext.run(context, () => db.withConnection(async () => {
        try { return await callback(); }
        finally { await Promise.allSettled(context.mail); }
      }));
      if (context.deletions.length) await storage.remove(context.deletions).catch(error => console.error('[storage cleanup]', error.message));
      return result;
    },
  };
  return platform;
}
module.exports = { createCloudPlatform, passwords };
