const crypto = require('node:crypto');

function bad(message) { return Object.assign(new Error(message), { status: 400 }); }
async function handleDirectUpload({ req, context, db, core, storage }) {
  if (req.method !== 'POST') return null;
  const isGrant = req.path === '/api/storage/uploads';
  if (!isGrant && !core.uploadField(req.path)) return null;
  if (!isGrant && !req.body?._cloudUploads) return null;
  const me = await core.handle({ ...context, method: 'GET', path: '/api/me' });
  if (me.status !== 200) return me;
  if (isGrant) {
    const target = String(req.body.target || '');
    const field = core.uploadField(target);
    const task = /^\/api\/tasks\/(\d+)\/attachments$/.exec(target);
    if (!field || (!task && target !== '/api/parse-email')) throw bad('Invalid upload destination.');
    if (task) {
      const permission = await core.handle({ ...context, method: 'GET', path: `/api/tasks/${task[1]}` });
      if (permission.status !== 200) return permission;
    }
    const files = req.body.files;
    if (!Array.isArray(files) || !files.length || files.length > (field === 'file' ? 1 : 20)) throw bad('Choose between 1 and 20 files.');
    await db.prepare('DELETE FROM upload_grants WHERE expires_at < ?').run(Date.now());
    const grants = [];
    for (const file of files) {
      if (typeof file.name !== 'string' || !file.name || file.name.length > 500 || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 100 * 1024 * 1024) throw bad('Files can be up to 100 MB each.');
      const id = crypto.randomUUID(), stored = storage.randomName(file.name);
      await db.prepare('INSERT INTO upload_grants (id,user_id,target,stored,filename,size,mime,expires_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, me.body.user.id, target, stored, file.name, file.size, String(file.type || 'application/octet-stream').slice(0, 200), Date.now() + 2 * 3600000);
      grants.push({ id, url: await storage.signedUpload(stored) });
    }
    return { status: 200, body: { uploads: grants } };
  }
  const ids = req.body._cloudUploads;
  const maximum = core.uploadField(req.path) === 'file' ? 1 : 20;
  if (!Array.isArray(ids) || !ids.length || ids.length > maximum || new Set(ids).size !== ids.length || ids.some(id => !/^[a-f0-9-]{36}$/.test(id))) throw bad('Upload the files again.');
  const files = [];
  for (const id of ids) {
    const grant = await db.prepare('SELECT * FROM upload_grants WHERE id = ? AND user_id = ? AND target = ? AND expires_at > ?').get(id, me.body.user.id, req.path, Date.now());
    if (!grant) throw bad('Upload expired. Upload the files again.');
    if (await storage.size(grant.stored) !== grant.size) throw bad('The uploaded file is incomplete. Upload it again.');
    files.push({ name: grant.filename, size: grant.size, type: grant.mime, stored: grant.stored, direct: true });
  }
  const result = await core.handle({ ...context, files });
  if (result.status === 200) for (const id of ids) await db.prepare('DELETE FROM upload_grants WHERE id = ?').run(id);
  return result;
}
module.exports = { handleDirectUpload };
