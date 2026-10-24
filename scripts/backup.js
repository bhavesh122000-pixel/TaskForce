// Nightly backup: copies the database and all attached files into a dated folder.
// Run on its own with:  npm run backup
const fs = require('fs');
const path = require('path');

function defaultBackupDir(dataDir) { return path.join(path.dirname(dataDir), 'backups'); }
const stampNow = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, `${p(d.getHours())}${p(d.getMinutes())}`, `${p(d.getHours())}:${p(d.getMinutes())}`]; };

async function runBackup(db, dataDir, getSetting, setSetting) {
  const root = await getSetting('backup_dir', '') || defaultBackupDir(dataDir);
  const keep = Math.max(1, parseInt(await getSetting('backup_keep', '14'), 10) || 14);
  const [day, hm, hhmm] = stampNow();
  const dest = path.join(root, `taskforce-${day}_${hm}`);
  fs.mkdirSync(dest, { recursive: true });
  const dbFile = path.join(dest, 'taskforce.db');
  if (fs.existsSync(dbFile)) fs.rmSync(dbFile);
  await db.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);
  const uploads = path.join(dataDir, 'uploads');
  if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(dest, 'uploads'), { recursive: true });
  const old = fs.readdirSync(root).filter(n => /^taskforce-\d{4}-\d{2}-\d{2}_\d{4}$/.test(n)).sort();
  while (old.length > keep) fs.rmSync(path.join(root, old.shift()), { recursive: true, force: true });
  await setSetting('last_backup', `${day} ${hhmm} → ${dest}`);
  return dest;
}

module.exports = { runBackup, defaultBackupDir };

if (require.main === module) {
  if (process.env.TF_BACKEND !== 'sqlite') {
    require('../server').createApplication().then(async runtime => {
      try { console.log('Backup saved to', await runtime.platform.withRequest(() => runtime.platform.backup(runtime.core.getSetting, runtime.core.setSetting))); }
      finally { await runtime.close(); }
    }).catch(error => { console.error('Backup failed:', error.message); process.exitCode = 1; });
  } else {
  const { DatabaseSync } = require('node:sqlite');
  const dataDir = process.env.TF_DATA_DIR || path.join(__dirname, '..', 'data');
  const db = new DatabaseSync(path.join(dataDir, 'taskforce.db'));
  const get = (k, d = '') => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : d; };
  const set = (k, v) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
  runBackup(db, dataDir, get, set).then(dest => console.log('Backup saved to', dest))
    .catch(error => { console.error('Backup failed:', error.message); process.exitCode = 1; })
    .finally(() => db.close());
  }
}
