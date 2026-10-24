const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { connectionOptions } = require('../backend/connection');
const { createPostgres, TABLES } = require('../backend/postgres');
const { createApplication } = require('../backend/app');
const { createCloudPlatform } = require('../backend/platform');
const { memoryStorage } = require('./helpers');
const { handleDirectUpload } = require('../backend/uploads');

// Opt in explicitly. All writes are confined to a uniquely named temporary
// schema, never the application's configured schema, and removed in finally.
test('real PostgreSQL: ten users, record isolation and competing updates', {skip:process.env.TASKFORCE_PG_TEST !== '1',timeout:600000}, async t => {
  const schema=`tf_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  assert.match(schema,/^tf_test_[0-9]+_[a-f0-9]+$/);
  const testUrl=process.env.TASKFORCE_TEST_DATABASE_URL || process.env.DATABASE_URL;
  const controlUrl=new URL(testUrl);
  // A separate idle session-pooler control connection consumes a server slot.
  // Use transaction pooling for fixture setup so it releases that slot between
  // queries; application traffic still uses exactly the configured test URL.
  if(controlUrl.hostname.endsWith('.pooler.supabase.com') && controlUrl.port==='5432')controlUrl.port='6543';
  const setup=new Pool({...connectionOptions(controlUrl.toString()),max:1});
  let runtime;
  const reports=[];
  const fixture=async()=>{
    await setup.query(`
      TRUNCATE ${[...TABLES,'upload_grants'].map(name => `${schema}."${name}"`).join(',')} RESTART IDENTITY CASCADE;
      INSERT INTO ${schema}.users(id,name,email,initials,password_hash,role,email_alerts)
        SELECT n,'Tester '||n,'tester'||n||'@example.invalid','T','disabled',CASE WHEN n=1 THEN 'admin' ELSE 'staff' END,0 FROM generate_series(1,10)n;
      INSERT INTO ${schema}.sessions(token,user_id,expires_at) SELECT 'load-user-'||n,n,'2099-01-01' FROM generate_series(1,10)n;
      INSERT INTO ${schema}.matters(id,code,type,client,responsible_id,created_by,settlement_date,created_at,updated_at)
        SELECT n,'LOAD'||n,'P','Fixture client',n,1,'2027-01-29','2026-10-01 09:00:00','2026-10-01 09:00:00' FROM generate_series(1,10)n;
      INSERT INTO ${schema}.matter_stages(matter_id,key,label,from_kind,days,position)
        SELECT n,'stage'||s,'Stage '||s,'settlement',-s,s FROM generate_series(1,10)n CROSS JOIN generate_series(1,5)s;
      INSERT INTO ${schema}.matter_items(matter_id,stage,title,ms,position)
        SELECT n,'stage'||((i%5)+1),'Item '||i,CASE WHEN i%4=0 THEN '{"label":"Review","from":"settlement","days":-3,"statuses":["Done"]}' ELSE NULL END,i FROM generate_series(1,10)n CROSS JOIN generate_series(1,100)i;
      INSERT INTO ${schema}.tasks(id,title,matter_id,assignee_id,created_by,due_date,position)
        SELECT n,'Fixture task '||n,((n-1)%10)+1,((n-1)%10)+1,1,'2027-01-20',n FROM generate_series(1,100)n;
      INSERT INTO ${schema}.checklist_items(task_id,text,position) SELECT n,'Check',0 FROM generate_series(1,100)n;
      INSERT INTO ${schema}.holidays(date,name) VALUES('2027-01-26','Australia Day');
      INSERT INTO ${schema}.settings(key,value) VALUES('backup_time','99:99'),('library_version','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
      SELECT setval(pg_get_serial_sequence('${schema}.users','id'),10),setval(pg_get_serial_sequence('${schema}.matters','id'),10),setval(pg_get_serial_sequence('${schema}.tasks','id'),100);
    `);
  };
  function call(method,route,body={},user=1,query={}) {
    const context={method,path:route,body,query,token:`load-user-${user}`};
    return runtime.platform.withRequest(async()=>{
      const upload = await handleDirectUpload({req:{method,path:route,body},context,db:runtime.db,core:runtime.core,storage:runtime.storage});
      return upload || runtime.core.handle(context);
    },runtime.requestOptions ? runtime.requestOptions(context) : {readOnly:runtime.core.isReadOnly(method,route)});
  }
  async function good(...args) { const result=await call(...args); assert.equal(result.status,200,`${args[0]} ${args[1]}: ${JSON.stringify(result.body)}`);return result.body; }
  async function open(profile,max) {
    const old=profile==='baseline';
    const root=process.env.TASKFORCE_BASELINE_DIR;
    const adapter=old ? require(path.join(root,'backend','postgres')) : {createPostgres};
    const application=old ? require(path.join(root,'backend','app')).createApplication : createApplication;
    const cloud=old ? require(path.join(root,'backend','platform')).createCloudPlatform : createCloudPlatform;
    const pool=new Pool({...connectionOptions(process.env.TASKFORCE_TEST_DATABASE_URL || process.env.DATABASE_URL),max,idleTimeoutMillis:30000});
    const db=adapter.createPostgres({pool,schema,timezone:'Australia/Adelaide'}),storage=memoryStorage();
    const platform=cloud({db,storage});platform.deferLibrary=true;
    try {
      runtime=await application({db,storage,platform});
      // Release successful checkouts even if the provider cannot supply the
      // requested count. Never strand clients on a failed warm-up.
      const clients=await Promise.allSettled(Array.from({length:max},()=>pool.connect()));
      clients.filter(result=>result.status==='fulfilled').forEach(result=>result.value.release());
      if(clients.some(result=>result.status==='rejected'))throw Object.assign(new Error('The provider could not supply the requested warm connections.'),{code:'TEST_POOL_CAPACITY'});
      return pool;
    } catch(error) { await db.close();runtime=null;throw error; }
  }
  try {
    for(const file of ['setup.sql','connect.sql'])await setup.query(fs.readFileSync(path.join(__dirname,'..','supabase',file),'utf8').replaceAll('taskforce_app',schema));
    const profiles=process.env.TASKFORCE_PG_RACES_ONLY === '1' ? [] : process.env.TASKFORCE_PG_POOLS
      ? process.env.TASKFORCE_PG_POOLS.split(',').map(Number).filter(n=>[5,10,15].includes(n)).map(n=>['current',n])
      : process.env.TASKFORCE_BASELINE_DIR ? [['baseline',5],['current',5],['current',10],['current',15]] : [['current',10]];
    let reference;
    if(process.env.TASKFORCE_PG_POOLS && process.env.TASKFORCE_BASELINE_DIR){
      await fixture();await open('baseline',1);reference=await good('GET','/api/matters',{},1,{status:'all'});await runtime.close();runtime=null;
    }
    for(const [profile,max] of profiles){
      console.log(`Starting ${profile}, pool ${max}, ten concurrent fixture users.`);
      await fixture();let pool;
      try{pool=await open(profile,max);}catch(error){
        if(max<=10 || error.code!=='TEST_POOL_CAPACITY')throw error;
        const metrics={profile,pool:max,capacityLimited:true};reports.push(metrics);console.log('TEN_USER_RESULT '+JSON.stringify(metrics));
        if(process.env.TASKFORCE_RESULTS_FILE)fs.writeFileSync(process.env.TASKFORCE_RESULTS_FILE,JSON.stringify(reports,null,2));
        continue;
      }
      const response=await good('GET','/api/matters',{},1,{status:'all'});
      if(reference)assert.deepEqual(response,reference,'milestone and matter responses must match the deployed baseline');else reference=response;
      await runtime.db.withConnection(()=>runtime.core.setSetting('scheduler_last_run',String(Date.now())));
      const checklistByTask=new Map((await setup.query(`SELECT task_id,id FROM ${schema}.checklist_items`)).rows.map(row=>[+row.task_id,+row.id]));
      const timings={};let waiting=0;
      const sample=setInterval(()=>{waiting=Math.max(waiting,pool.waitingCount);},10);
      const timed=async(name,fn)=>{const started=performance.now();const result=await fn();(timings[name]||=[]).push(performance.now()-started);return result;};
      const started=performance.now();
      try{
        const settled=await Promise.allSettled(Array.from({length:10},async(_,index)=>{
          const user=index+1;
          for(let round=0;round<1;round++){
            await timed('poll',()=>good('GET','/api/poll',{},user));
            await timed('matters',()=>good('GET','/api/matters',{},user,{status:'all'}));
            await timed('note',()=>good('POST',`/api/tasks/${user}/notes`,{body:`Load ${profile} ${round}`},user));
            await timed('checklist',()=>good('PUT',`/api/checklist/${checklistByTask.get(user)}`,{done:round===0},user));
          }
        }));
        const counts=await setup.query(`SELECT (SELECT count(*) FROM ${schema}.notes) AS notes,(SELECT count(*) FROM ${schema}.tasks) AS tasks`);
        const failures=settled.filter(result=>result.status==='rejected');
        if(profile!=='baseline'){assert.equal(failures.length,0,failures.map(result=>result.reason.message).join('; '));assert.equal(+counts.rows[0].notes,10);}
        assert.equal(+counts.rows[0].tasks,100);
        const metrics={profile,pool:max,totalMs:Math.round(performance.now()-started),failedUsers:failures.length,failureReasons:failures.map(result=>result.reason.code || result.reason.message),maxPoolWaiting:waiting,routes:{}};
        for(const [name,values]of Object.entries(timings)){values.sort((a,b)=>a-b);metrics.routes[name]={requests:values.length,p50:Math.round(values[Math.floor(values.length*.5)]),p95:Math.round(values[Math.min(values.length-1,Math.ceil(values.length*.95)-1)])};}
        reports.push(metrics);console.log('TEN_USER_RESULT '+JSON.stringify(metrics));
        if(process.env.TASKFORCE_RESULTS_FILE)fs.writeFileSync(process.env.TASKFORCE_RESULTS_FILE,JSON.stringify(reports,null,2));
      }finally{clearInterval(sample);await runtime.close();runtime=null;}
    }
    await fixture();await open('current',10);
    await t.test('a slow upload does not block a different matter or normal reads',async()=>{
      const target='/api/tasks/1/attachments';const storage=runtime.storage;
      const grant=(await good('POST','/api/storage/uploads',{target,files:[{name:'fixture.txt',size:5,type:'text/plain'}]})).uploads[0];
      const checklists=(await setup.query(`INSERT INTO ${schema}.checklist_items(task_id,text,position) SELECT 1,'Contended '||n,n FROM generate_series(1,10)n RETURNING id`)).rows;
      let release,entered;const ready=new Promise(resolve=>{entered=resolve;});const blocked=new Promise(resolve=>{release=resolve;});
      storage.size=async()=>{entered();await blocked;return 5;};
      const upload=call('POST',target,{_cloudUploads:[grant.id]});
      let queued=[];
      let timer;
      try{
        await ready;
        // Different child records all need the blocked task lock. They must
        // release their connections while waiting so another user can work.
        queued=checklists.map(row=>good('PUT',`/api/checklist/${row.id}`,{done:true}));
        const completed=await Promise.race([Promise.all([good('POST','/api/tasks/2/notes',{body:'Other matter'},2),good('GET','/api/tasks',{},3)]).then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),12000);})]);
        assert.equal(completed,true,'unrelated work should finish while the upload is deliberately blocked');
      }finally{clearTimeout(timer);release();assert.equal((await upload).status,200);await Promise.all(queued);}
    });
    await t.test('ten simultaneous clock-ins and repeated completions create one result',async()=>{
      await Promise.all(Array.from({length:10},()=>good('POST','/api/time/clock-in',{},1)));
      assert.equal(+(await setup.query(`SELECT count(*) FROM ${schema}.time_entries WHERE user_id=1 AND clock_out IS NULL`)).rows[0].count,1);
      const task=await good('POST','/api/tasks',{title:'Repeat race',repeat:'weekly',due_date:'2027-01-01',checklist:['one','two']});
      await Promise.all(Array.from({length:10},()=>good('PUT',`/api/tasks/${task.id}`,{status:'done'})));
      const next=(await good('GET','/api/tasks')).filter(row=>row.series_id===task.id);
      assert.equal(next.length,1);assert.equal((await good('GET',`/api/tasks/${next[0].id}`)).checklist.length,2);
    });
    await t.test('concurrent callback attempts preserve both log entries and the attempt count',async()=>{
      const callback=await good('POST','/api/callbacks',{caller_name:'Synthetic caller',phone:'000',assignee_id:2,matter_id:2});
      await Promise.all([good('POST',`/api/callbacks/${callback.id}/attempt`,{result:'No answer',retry_minutes:30},2),good('POST',`/api/callbacks/${callback.id}/attempt`,{result:'No answer',retry_minutes:30},2)]);
      const updated=await good('GET',`/api/callbacks/${callback.id}`,{},2);
      assert.equal(updated.attempts,2);assert.equal(updated.log.filter(row=>row.kind==='attempt').length,2);
    });
    await t.test('simultaneous scheduler triggers run once and skipped calls do not write',async()=>{
      await runtime.db.withConnection(()=>runtime.core.setSetting('scheduler_last_run','0'));
      const results=await Promise.all(Array.from({length:10},()=>runtime.jobs()));
      assert.equal(results.filter(row=>row.skipped).length,9);
      const original=runtime.db.withConnection;
      let writes=0;
      runtime.db.withConnection=(callback,options={})=>{if(!options.readOnly)writes++;return original(callback,options);};
      try{assert.equal((await runtime.jobs()).skipped,true);assert.equal(writes,0);}finally{runtime.db.withConnection=original;}
    });
    await t.test('due scheduler work does not hold the schema lock across unrelated tasks',async()=>{
      await setup.query(`UPDATE ${schema}.tasks SET due_date='2000-01-01',overdue_notified=0 WHERE id=1`);
      await runtime.db.withConnection(()=>runtime.core.setSetting('scheduler_last_run','0'));
      const original=runtime.db.lockKeys;
      let release,entered,held=false,timer;
      const ready=new Promise(resolve=>{entered=resolve;});const blocked=new Promise(resolve=>{release=resolve;});
      runtime.db.lockKeys=async keys=>{if(keys.includes('task:1')&&!held){held=true;entered();await blocked;}return original(keys);};
      const jobs=runtime.jobs();
      try{
        await ready;
        const completed=await Promise.race([good('POST','/api/tasks/2/notes',{body:'During overdue scheduler'},2).then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),12000);})]);
        assert.equal(completed,true,'normal work should finish while scheduler task processing is blocked');
      }finally{clearTimeout(timer);release();await jobs;runtime.db.lockKeys=original;}
      assert.equal(+(await setup.query(`SELECT count(*) FROM ${schema}.notifications WHERE task_id=1 AND kind='overdue'`)).rows[0].count,1);
    });
    if(process.env.TASKFORCE_RESULTS_FILE)fs.writeFileSync(process.env.TASKFORCE_RESULTS_FILE,JSON.stringify(reports,null,2));
  }finally{
    if(runtime)await runtime.close();
    try{await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);console.log('Temporary test schema removed.');}finally{await setup.end();}
  }
});
