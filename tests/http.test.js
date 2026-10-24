const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../backend/app');
const { passwords } = require('../backend/platform');
const { database, memoryStorage } = require('./helpers');

test('HTTP sessions, direct uploads, file privacy, backups and concurrent writes', async t => {
  const db = await database(), storage = memoryStorage(), password = 'http-test-password';
  await db.withConnection(async () => db.prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(await passwords.hashPassword(password)));
  const runtime = await createApplication({ db, storage });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(method, url, body, cookie, headers = {}) {
    const response = await fetch(base + url, { method, headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    return { status: response.status, data: await response.json().catch(() => null), headers: response.headers };
  }
  let cookie, staffCookie, task;
  try {
    await t.test('admin login, public signup disabled and admin-only account creation', async () => {
      const login = await request('POST', '/api/login', { email: 'bhavesh122000@gmail.com', password });
      assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly/);
      cookie = login.headers.get('set-cookie').split(';')[0];
      assert.equal((await request('POST', '/api/setup', {})).status, 403);
      assert.equal((await request('POST', '/api/users', { name: 'No' })).status, 401);
      assert.equal((await request('POST', '/api/users', { name: 'Staff', email: 'http@example.com', password }, cookie)).status, 200);
      const loginStaff = await request('POST', '/api/login', { email: 'http@example.com', password });
      staffCookie = loginStaff.headers.get('set-cookie').split(';')[0];
      assert.equal((await request('POST', '/api/users', { name: 'No', email: 'no@example.com', password }, staffCookie)).status, 403);
    });
    await t.test('parallel writes both persist', async () => {
      const results = await Promise.all(['One', 'Two'].map(title => request('POST', '/api/tasks', { title }, cookie)));
      assert.ok(results.every(result => result.status === 200)); task = results[0].data;
      assert.equal((await request('GET', '/api/tasks', undefined, cookie)).data.length, 2);
    });
    await t.test('signed grants are bound to the user and cannot be replayed', async () => {
      const target = `/api/tasks/${task.id}/attachments`;
      const grant = await request('POST', '/api/storage/uploads', { target, files: [{ name: 'proof.txt', size: 5, type: 'text/plain' }] }, cookie);
      assert.equal(grant.status, 200);
      const upload = grant.data.uploads[0];
      storage.files.set(new URL(upload.url).pathname.slice(1), Buffer.from('hello'));
      const body = { _cloudUploads: [upload.id] };
      assert.equal((await request('POST', target, body, staffCookie)).status, 400);
      const attached = await request('POST', target, body, cookie);
      assert.equal(attached.status, 200); assert.equal(attached.data.attachments.length, 1);
      assert.equal((await request('POST', target, body, cookie)).status, 400);
      const id = attached.data.attachments[0].id;
      assert.equal((await request('GET', `/api/attachments/${id}`)).status, 401);
      assert.equal((await request('GET', `/api/attachments/${id}`, undefined, cookie)).status, 302);
    });
    await t.test('multipart uploads and email extraction still use the original engine', async () => {
      const form = new FormData();
      const email = 'From: sender@example.com\r\nTo: recipient@example.com\r\nSubject: Contract review\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="parts"\r\n\r\n--parts\r\nContent-Type: text/plain\r\n\r\nPlease review.\r\n--parts\r\nContent-Type: text/plain; name="inner.txt"\r\nContent-Disposition: attachment; filename="inner.txt"\r\n\r\nInner content\r\n--parts--';
      form.append('files', new Blob([email], { type: 'message/rfc822' }), 'message.eml');
      const result = await request('POST', `/api/tasks/${task.id}/attachments`, form, cookie);
      assert.equal(result.status, 200);
      const attachment = result.data.attachments.find(item => item.filename === 'message.eml');
      const parsed = await request('GET', `/api/attachments/${attachment.id}/parts`, undefined, cookie);
      assert.equal(parsed.status, 200); assert.equal(parsed.data.meta.subject, 'Contract review'); assert.equal(parsed.data.parts.length, 1);
    });
    await t.test('Taxation upload grants respect staff access', async () => {
      const matter = await request('POST', '/api/matters', { code: 'TAXHTTP', type: 'TAX', client: 'Private' }, cookie);
      const task = await request('POST', '/api/tasks', { title: 'Private', matter_id: matter.data.id }, cookie);
      const grant = await request('POST', '/api/storage/uploads', { target: `/api/tasks/${task.data.id}/attachments`, files: [{ name: 'tax.txt', size: 3 }] }, staffCookie);
      assert.equal(grant.status, 403);
    });
    await t.test('cloud backup contains records and copies attachments privately', async () => {
      assert.equal((await request('POST', '/api/backup', {}, staffCookie)).status, 403);
      const result = await request('POST', '/api/backup', {}, cookie);
      assert.equal(result.status, 200);
      const snapshot = JSON.parse(storage.files.get(result.data.dir + '/database.json'));
      assert.equal(snapshot.tables.users.length, 2);
      assert.ok([...storage.files.keys()].some(key => key.startsWith(result.data.dir + '/files/')));
    });
    await t.test('static files and cron authorization', async () => {
      for (const url of ['/', '/app.js', '/workflow.js', '/vendor/mammoth.js', '/hosting.json']) assert.equal((await fetch(base + url)).status, 200);
      assert.equal((await request('GET', '/api/cron')).status, 401);
    });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close(); }
});
