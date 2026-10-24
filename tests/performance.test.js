const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { database, memoryStorage } = require('./helpers');
const { createApplication } = require('../backend/app');
const { passwords } = require('../backend/platform');

test('PostgreSQL read budgets, transaction rollback and cache isolation', async t => {
  let queries = [];
  const db = await database({ onQuery: sql => queries.push(sql) });
  const runtime = await createApplication({ db, storage: memoryStorage() });
  const call = (method, path, body = {}, query = {}) => runtime.platform.withRequest(
    () => runtime.core.handle({ method, path, body, query, token: 'performance-admin' }),
    runtime.requestOptions({ method, path, body, token:'performance-admin' })
  );
  try {
    await db.withConnection(async () => {
      await db.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES ('performance-admin',1,'2099-01-01')").run();
      await db.insertMany('users', ['name','email','initials','password_hash'], Array.from({length:20}, (_, i) => [`Employee ${i}`,`employee${i}@example.com`,'E','disabled']));
      await db.insertMany('matters', ['code','type','created_by'], Array.from({length:20}, (_, i) => [`SPEED${i}`,'P',1]));
      await db.prepare("INSERT INTO tasks(title,created_by,matter_id) VALUES ('Detail',1,1)").run();
    });
    await t.test('read query counts stay bounded as staff and matters grow', async () => {
      for (const [path, limit] of [['/api/me',2],['/api/settings',2],['/api/poll',2],['/api/tasks/1',2],['/api/time/sheet',3],['/api/matters',5]]) {
        queries = [];
        const result = await call('GET', path, {}, { from:'2026-10-01',to:'2026-10-31' });
        assert.equal(result.status,200,path);
        assert.ok(queries.length <= limit, `${path}: ${queries.length} queries exceeds ${limit}`);
        assert.ok(queries.every(sql => !/^(BEGIN|COMMIT|ROLLBACK)|pg_advisory/i.test(sql)), 'reads must not acquire the write lock');
      }
    });
    await t.test('a failed route rolls back partial database changes', async () => {
      await db.withConnection(async () => {
        await db.prepare("INSERT INTO settings(key,value) VALUES ('should_rollback','yes')").run();
        return { status:400,body:{error:'Rejected'} };
      });
      const row = await db.withConnection(() => db.prepare("SELECT value FROM settings WHERE key = 'should_rollback'").get(), {readOnly:true});
      assert.equal(row,undefined);
    });
    await t.test('read scopes reject accidental writes', async () => {
      await assert.rejects(db.withConnection(() => db.prepare("UPDATE users SET name = 'wrong'").run(), {readOnly:true}), /read-only/);
    });
    await t.test('settings are cached only within the request', async () => {
      await call('GET','/api/settings');
      await db.withConnection(() => runtime.core.setSetting('firm_name','Fresh setting'));
      assert.equal((await call('GET','/api/settings')).body.firm_name,'Fresh setting');
    });
    await t.test('clock-in and repeated task completion remain single operations', async () => {
      const task = (await call('POST','/api/tasks',{title:'Repeated',due_date:'2027-01-01',repeat:'weekly',checklist:['one','two']})).body;
      const completed = await Promise.all([call('PUT',`/api/tasks/${task.id}`,{status:'done'}),call('PUT',`/api/tasks/${task.id}`,{status:'done'})]);
      assert.ok(completed.every(r => r.status === 200));
      const next = (await call('GET','/api/tasks')).body.filter(row => row.series_id === task.id);
      assert.equal(next.length,1);
      assert.equal((await call('GET',`/api/tasks/${next[0].id}`)).body.checklist.length,2);
      await Promise.all([call('POST','/api/time/clock-in'),call('POST','/api/time/clock-in')]);
      const clock = await db.withConnection(() => db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE user_id = 1 AND clock_out IS NULL').get(),{readOnly:true});
      assert.equal(clock.n,1);
    });
    await t.test('batched checklist copies preserve parents and do not duplicate on reapply', async () => {
      const created = await call('POST','/api/matters',{code:'BATCHED',type:'P'});
      assert.equal(created.status,200);
      const path = `/api/matters/${created.body.id}`;
      const before = (await call('GET',path)).body;
      assert.ok(before.stages.some(stage => stage.items.some(item => item.children.length)));
      assert.ok(before.milestones.length > 0);
      assert.equal((await call('POST',path+'/checklist/apply',{checklist_key:'BC-P'})).status,200);
      const after = (await call('GET',path)).body;
      assert.deepEqual(after.stages,before.stages);
      assert.deepEqual(after.milestones,before.milestones);
    });
    await t.test('employee timesheets cannot request another user', async () => {
      await db.withConnection(() => db.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES ('performance-staff',2,'2099-01-01')").run());
      const result = await runtime.platform.withRequest(() => runtime.core.handle({method:'GET',path:'/api/time/sheet',token:'performance-staff',query:{user:'1'}}),{readOnly:true});
      assert.equal(result.status,200);
      assert.deepEqual(result.body.users.map(u => u.user_id),[2]);
    });
    // Scheduler coordination uses multiple real connections and is covered in
    // postgres-concurrency.test.js; this single-connection fixture cannot model it.
    await t.test('poll versions distinguish datasets and detect edits within one second', async () => {
      const before = (await call('GET','/api/poll')).body.versions;
      await call('PUT','/api/tasks/1',{title:'Edited once'});
      const first = (await call('GET','/api/poll')).body.versions;
      await call('PUT','/api/tasks/1',{title:'Edited twice'});
      const second = (await call('GET','/api/poll')).body.versions;
      assert.notEqual(first.tasks,before.tasks);
      assert.notEqual(second.tasks,first.tasks);
      for (const key of ['users','people','matterRefs','callbacks','library','settings']) assert.equal(second[key],before[key],key);
      await db.withConnection(() => runtime.core.setSetting('scheduler_last_run',String(Date.now())));
      assert.deepEqual((await call('GET','/api/poll')).body.versions,second);
    });
    await t.test('existing password hashes still authenticate', async () => {
      const salt = 'old-password-format';
      const oldHash = `${salt}:${crypto.scryptSync('legacy-password',salt,64).toString('hex')}`;
      assert.equal(await passwords.checkPassword('legacy-password',oldHash),true);
      assert.equal(await passwords.checkPassword('wrong-password',oldHash),false);
    });
    await t.test('failed login codes still retain their attempt counter', async () => {
      await db.withConnection(async () => {
        await runtime.core.setSetting('login_mode','code');
        await runtime.core.setSetting('smtp_host','smtp.example.com');
        await runtime.core.setSetting('smtp_from','sender@example.com');
        await db.prepare("INSERT INTO login_codes(user_id,code_hash,purpose,expires_at,created_at) VALUES (1,?,'login','2099-01-01','2026-10-24')").run(await passwords.hashPassword('123456'));
      });
      const failed = await call('POST','/api/login/code',{email:'bhavesh122000@gmail.com',code:'000000'});
      assert.equal(failed.status,401);
      const row = await db.withConnection(() => db.prepare('SELECT tries FROM login_codes ORDER BY id DESC LIMIT 1').get(),{readOnly:true});
      assert.equal(row.tries,1);
    });
  } finally { await runtime.close(); }
});

test('backup file transfers release the database for normal writes', async () => {
  const db = await database(), storage = memoryStorage();
  const runtime = await createApplication({ db, storage });
  let release, signal;
  const copying = new Promise(resolve => { signal = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const put = storage.put.bind(storage);
  storage.put = async (name,data) => { if (name.endsWith('/database.json')) { signal(); await blocked; } return put(name,data); };
  const backup = runtime.platform.backup();
  try {
    await copying;
    // This would deadlock with the old transaction held across the storage wait.
    await db.withConnection(() => db.prepare("INSERT INTO settings(key,value) VALUES ('during_backup','yes')").run());
    release();
    const prefix = await backup;
    const snapshot = JSON.parse(storage.files.get(prefix+'/database.json'));
    assert.ok(!snapshot.tables.settings.some(row => row.key === 'during_backup'));
  } finally { release(); await backup.catch(() => {}); await runtime.close(); }
});
