const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const appSource = fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const source = appSource.split('/* ---------------- polling ---------------- */')[1].split('/* ---------------- admin ---------------- */')[0];
function browser() {
  const calls = [], timers = new Map(), events = {};
  const S = { me:{id:1}, version:null };
  let response = { version:'v1', versions:{tasks:'a',matterRefs:'a',matters:'a',callbacks:'a',people:'a',users:'a',time:'a',library:'a',settings:'a'} };
  let intercept, blocked = false, dragging = false;
  const document = { hidden:false, activeElement:null, title:'TaskForce', addEventListener:(name,callback) => { events[name]=callback; }, querySelector:() => dragging ? {} : null };
  const context = vm.createContext({
    S, document, location:{hash:'#/board'}, window:{}, Math,
    setTimeout:(callback,ms) => { const id = Symbol(); timers.set(id,{callback,ms}); return id; }, clearTimeout:id => timers.delete(id),
    $:selector => selector === '#modal' && blocked ? {} : null,
    api:async (method,url) => { calls.push(url); if (intercept) await intercept(url); if (url==='/api/poll') return response; if(url==='/api/me') return {user:{id:1}}; return []; },
    refreshView:async () => { calls.push('render'); }, drawDrawer:()=>{},closeDrawer:()=>{},
    loadPeopleDates:async()=>calls.push('people'),refreshTime:async()=>calls.push('clock'),
  });
  vm.runInContext(source,context);
  return { context, S, calls, timers, document, events,
    poll:()=>context.poll(), next:(key) => { response={...response,version:response.version+'x',versions:{...response.versions,[key]:response.versions[key]+'x'}}; },
    intercept:fn => {intercept=fn;}, block:value=>{blocked=value;}, drag:value=>{dragging=value;},
  };
}
test('polling merges overlapping requests into one',async()=>{
  const b=browser();let release;b.intercept(()=>new Promise(resolve=>{release=resolve;}));
  const first=b.poll(),second=b.poll();assert.equal(first,second);assert.equal(b.calls.length,1);release();await first;
});
test('callback-only changes do not reload the task board or reference data',async()=>{
  const b=browser();await b.poll();b.calls.length=0;b.next('callbacks');await b.poll();assert.deepEqual(b.calls,['/api/poll']);
  b.context.location.hash='#/callbacks';b.next('callbacks');await b.poll();assert.equal(b.calls.filter(url=>url==='render').length,1);
});
test('a task edit refreshes the active board without fetching holidays or matter references',async()=>{
  const b=browser();await b.poll();b.calls.length=0;b.next('tasks');await b.poll();assert.deepEqual(b.calls,['/api/poll','render']);
});
test('hidden, editing and dragging tabs retain pending changes until safe to refresh',async()=>{
  for (const state of ['hidden','typing','modal','dragging']) {
    const b=browser();await b.poll();b.calls.length=0;b.next('tasks');
    if(state==='hidden')b.document.hidden=true;
    if(state==='typing')b.document.activeElement={tagName:'INPUT'};
    if(state==='modal')b.block(true);
    if(state==='dragging')b.drag(true);
    await b.poll();assert.deepEqual(b.calls,['/api/poll'],state);
    b.document.hidden=false;b.document.activeElement=null;b.block(false);b.drag(false);
    await b.poll();assert.equal(b.calls.filter(url=>url==='render').length,1,state);
  }
});
test('automatic polls use jitter and a slower schedule while hidden',async()=>{
  const b=browser();b.context.startPolling();let timer=[...b.timers.values()][0];assert.ok(timer.ms>=0&&timer.ms<=3000);
  b.document.hidden=true;b.events.visibilitychange();timer=[...b.timers.values()][0];assert.ok(timer.ms>=60000&&timer.ms<=65000);
  b.context.stopPolling();assert.equal(b.timers.size,0);
});
test('a failed refresh retries on the next poll rather than accepting the version',async()=>{
  const b=browser();await b.poll();b.next('matterRefs');b.intercept(url=>{if(url!=='/api/poll')throw new Error('offline');});
  await b.poll();b.intercept(null);await b.poll();assert.equal(b.calls.filter(url=>url==='/api/matters?status=all&brief=1').length,2);
});
