const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const multer = require('multer');
const { createCore } = require('../core/api');
const { createPostgres } = require('./postgres');
const { createStorage } = require('./storage');
const { createCloudPlatform } = require('./platform');
const { handleDirectUpload } = require('./uploads');
const { requestOptions } = require('./locks');

async function createApplication(options = {}) {
  let { db, storage, platform } = options;
  let fileConfig = {};
  try { fileConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); } catch { /* optional office configuration */ }
  const loginModeOverride = ['password', 'either', 'code', 'both'].includes(fileConfig.login_mode) ? fileConfig.login_mode : null;
  db ||= createPostgres(); storage ||= createStorage();
  platform ||= createCloudPlatform({ db, storage, loginModeOverride });
  if (!options.skipStorageCheck) await storage.ensureBucket();
  await db.withConnection(async () => {
    const admin = await db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1 LIMIT 1").get();
    if (!admin) throw new Error('No active Supabase admin exists. Run npm run setup:supabase first.');
    await db.prepare('SELECT id FROM upload_grants LIMIT 1').get();
  }, { readOnly: true });
  const core = await db.withConnection(() => createCore({ db, platform }));
  const withRequest = (callback, options) => platform.withRequest ? platform.withRequest(callback, options) : db.withConnection(callback, options);
  const app = express();
  app.disable('x-powered-by');
  if (process.env.VERCEL) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/workflow.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'core', 'workflow.js')));
  app.get('/vendor/mammoth.js', (req, res) => res.sendFile(require.resolve('mammoth/mammoth.browser.min.js')));
  app.get('/hosting.json', (req, res) => res.json({ directUploads: true }));
  app.get('/api/health', (req, res) => {
    const commit = process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || '';
    res.json({ ok: true, commit: /^[a-f0-9]{40}$/i.test(commit) ? commit : null });
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', express.json({ limit: '2mb' }));
  app.post('/api/setup', (req, res) => res.status(403).json({ error: 'Only an admin can create accounts. Sign in with the account supplied by your admin.' }));

  const upload = multer({
    storage: multer.diskStorage({
      destination(req, file, callback) {
        try { req.uploadDir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'tf-upload-')); callback(null, req.uploadDir); } catch (error) { callback(error); }
      },
      filename(req, file, callback) { callback(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).slice(0, 12).replace(/[^.\w]/g, '')); },
    }), limits: { fileSize: 100 * 1024 * 1024, files: 20 },
  });
  const cleanup = req => { if (req.uploadDir) fs.rmSync(req.uploadDir, { recursive: true, force: true }); };
  const tokenFrom = req => /(?:^|;\s*)tf_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1] || null;
  app.all('/api/*', async (req, res, next) => {
    const field = req.method === 'POST' && core.uploadField(req.path);
    if (!field || !req.is('multipart/form-data')) return next();
    try {
      const access = await withRequest(() => core.handle({ method: 'GET', path: '/api/me', token: tokenFrom(req) }), { readOnly: true });
      if (access.status !== 200) return res.status(access.status).json(access.body);
      const middleware = field === 'file' ? upload.single('file') : upload.array('files', 20);
      middleware(req, res, error => {
        if (!error) return next();
        cleanup(req);
        res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Files can be up to 100 MB each.' : 'Upload failed: ' + error.message });
      });
    } catch (error) { next(error); }
  });
  async function jobs() {
    const alreadyRan = (last, at = Date.now()) => Math.floor(at / 600000) === Math.floor(Number(last) / 600000);
    // Most external calls arrive after another trigger already completed work.
    // Check without a write lock; repeat the check inside the transaction below.
    if (await withRequest(async () => alreadyRan(await core.getSetting('scheduler_last_run', '0')), { readOnly: true })) return { ok: true, skipped: true };
    const state = await withRequest(async () => {
      // Duplicate triggers must not fill the pool waiting for the coordinator;
      // the winning run needs connections for its short record transactions.
      if (!(await db.tryLockKey('scheduler'))) return { ok:true, skipped:true };
      const startedAt = Date.now();
      const lastRun = Number(await core.getSetting('scheduler_last_run', '0'));
      if (alreadyRan(lastRun, startedAt)) return { ok: true, skipped: true };
      await core.runJobs({ transaction: (callback, scope = {}) => {
        const options = scope.taskId
          ? requestOptions(db, core, { method:'PUT', path:`/api/tasks/${scope.taskId}` })
          : { scoped:true, before:() => db.lockKeys([scope.matterId && `matter:${scope.matterId}`, scope.callbackId && `callback:${scope.callbackId}`]) };
        return withRequest(callback, { ...options, independent:true });
      } });
      await core.setSetting('scheduler_last_run', String(startedAt));
      const d = new Date(), p = n => String(n).padStart(2, '0');
      const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      const backupDue = `${p(d.getHours())}:${p(d.getMinutes())}` >= (await core.getSetting('backup_time', '22:00') || '22:00') && !(await core.getSetting('last_backup', '')).startsWith(day);
      return { ok: true, backupDue };
    }, { coordinator:true });
    if (state.backupDue) await platform.backup();
    return { ok: true, ...(state.skipped ? { skipped: true } : {}) };
  }
  app.get('/api/cron', async (req, res, next) => {
    const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ''}`), actual = Buffer.from(req.get('authorization') || '');
    if (!process.env.CRON_SECRET || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return res.status(401).json({ error: 'Unauthorized.' });
    try { res.json(await jobs()); } catch (error) { next(error); }
  });
  app.all('/api/*', async (req, res, next) => {
    try {
      const fixName = name => { try { const text = Buffer.from(name, 'latin1').toString('utf8'); return text.includes('�') ? name : text; } catch { return name; } };
      const files = (req.files || (req.file ? [req.file] : [])).map(file => ({ name: fixName(file.originalname), size: file.size, type: file.mimetype, path: file.path, stored: file.filename }));
      const context = { method: req.method, path: req.path, query: req.query, body: req.body || {}, files, token: tokenFrom(req), ip: req.ip, origin: `${req.protocol}://${req.get('host')}` };
      const result = await withRequest(async () => {
        const output = await handleDirectUpload({ req, context, db, core, storage });
        return output || core.handle(context);
      }, requestOptions(db, core, context));
      const body = result.body || {};
      const cookie = { httpOnly: true, secure: req.secure || !!process.env.VERCEL, sameSite: 'lax', path: '/' };
      if (body._session) { res.cookie('tf_session', body._session, { ...cookie, maxAge: 30 * 86400e3 }); delete body._session; }
      if (body._clearSession) { res.clearCookie('tf_session', cookie); delete body._clearSession; }
      if (body._file) return res.type(body._file.mime).attachment(body._file.filename).send(body._file.content);
      if (body._download) {
        const file = body._download;
        return res.redirect(302, await storage.signedDownload(file.stored_name, file.filename, file.inline));
      }
      res.status(result.status).json(body);
    } catch (error) { next(error); }
    finally { cleanup(req); }
  });
  app.use((error, req, res, next) => {
    cleanup(req);
    console.error('[request]', error.message);
    if (!res.headersSent) res.status(error.status || 503).json({ error: error.status === 400 || error.code === 'TF_LOCK_BUSY' ? error.message : 'The service is temporarily unavailable. Please try again.' });
  });
  return { app, core, db, storage, platform, jobs, requestOptions: context => requestOptions(db, core, context), port: parseInt(process.env.PORT || fileConfig.port || '3000', 10) || 3000, close: () => db.close() };
}
module.exports = { createApplication };
