const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPostgres } = require('../backend/postgres');
test('a read request reuses one client and releases it on success and failure', async()=>{
  let acquired=0,released=0;
  const pool={connect:async()=>{acquired++;return {query:async()=>({rows:[{n:1}],fields:[]}),release:()=>released++};},end:async()=>{}};
  const db=createPostgres({pool});
  await db.withConnection(async()=>{
    await db.prepare('SELECT 1 AS n').get();
    await db.prepare('SELECT 1 AS n').get();
  },{readOnly:true});
  assert.equal(acquired,1);assert.equal(released,1);
  await assert.rejects(db.withConnection(async()=>{await db.prepare('SELECT 1 AS n').get();throw new Error('failure');},{readOnly:true}),/failure/);
  assert.equal(acquired,2);assert.equal(released,2);
  await db.withConnection(async()=>{}, {readOnly:true,pinRead:false});
  assert.equal(acquired,2,'a storage-only wrapper must not hold an unused connection');
});
test('contended locks release the client before retrying and never replay a started handler',async()=>{
  let acquired=0,released=0,attempts=0,handlers=0;
  const pool={connect:async()=>{acquired++;return {query:async sql=>({rows:sql.includes('pg_try_advisory')?[{locked:++attempts>1}]:[],fields:[]}),release:()=>released++};},end:async()=>{}};
  const db=createPostgres({pool});
  await db.withConnection(async()=>{handlers++;},{scoped:true,before:()=>db.lockKeys(['task:1'])});
  assert.equal(handlers,1);assert.equal(acquired,2);assert.equal(released,2);
  await assert.rejects(db.withConnection(async()=>{handlers++;throw Object.assign(new Error('handler failed'),{code:'TF_LOCK_BUSY'});},{scoped:true,before:()=>db.lockKeys(['task:1'])}),/handler failed/);
  assert.equal(handlers,2);assert.equal(acquired,3);assert.equal(released,3);
});
test('queued edits wait outside the pool so unrelated reads retain a connection',async()=>{
  let acquired=0,released=0,unblock,entered;
  const pool={connect:async()=>{acquired++;return {query:async()=>({rows:[],fields:[]}),release:()=>released++};},end:async()=>{}};
  const db=createPostgres({pool});
  const ready=new Promise(resolve=>{entered=resolve;});const blocked=new Promise(resolve=>{unblock=resolve;});
  const first=db.withConnection(async()=>{entered();await blocked;},{scoped:true,queueKey:'task:1'});
  await ready;
  const second=db.withConnection(async()=>{}, {scoped:true,queueKey:'task:1'});
  await db.withConnection(async()=>{await db.prepare('SELECT 1').all();},{readOnly:true});
  assert.equal(acquired,2,'only the active edit and independent read should acquire clients');
  unblock();await Promise.all([first,second]);assert.equal(acquired,3);assert.equal(released,3);
});
