const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the exact inline program run by GitHub, including its exit status.
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'taskforce-cron.yml'), 'utf8').replace(/\r\n/g, '\n');
const script = workflow.split("node <<'NODE'\n")[1].split('\n          NODE')[0];
async function check(responses, env = {}) {
  const calls = [], logs = [];
  const process = { env: { TASKFORCE_URL: 'https://taskforce.example/', CRON_SECRET: 'test-only-secret', ...env }, exitCode: 0 };
  await vm.runInNewContext(script, {
    process, URL, AbortSignal, Date,
    console: { log: message => logs.push(message), warn: message => logs.push(message), error: message => logs.push(message) },
    setTimeout: callback => { callback(); },
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      const next = responses[Math.min(calls.length - 1, responses.length - 1)];
      if (next instanceof Error) throw next;
      return new Response(next.body, { status: next.status || 200 });
    },
  });
  assert.ok(!logs.join('\n').includes('test-only-secret'));
  return { calls, logs, exitCode: process.exitCode };
}
test('scheduled job verifies actual JSON success', async () => {
  const result = await check([{body:'{"ok":true}'}]);
  assert.equal(result.exitCode,0);
  assert.equal(result.calls.length,1);
  assert.equal(result.calls[0].url,'https://taskforce.example/api/cron');
});
test('Render loading HTML is retried instead of reported as success', async () => {
  const result = await check([{body:'<html>Service waking up</html>'},{body:'{"ok":true,"skipped":true}'}]);
  assert.equal(result.exitCode,0);
  assert.equal(result.calls.length,2);
});
test('persistent HTML or an error JSON body fails the workflow', async () => {
  for (const body of ['<html>Loading</html>','{"ok":false}','{}']) {
    const result = await check([{body}]);
    assert.equal(result.exitCode,1);
    assert.equal(result.calls.length,3);
  }
});
test('authorization and missing-endpoint failures are explicit', async () => {
  for (const status of [401,403,404]) {
    const result = await check([{status,body:'{}'}]);
    assert.equal(result.exitCode,1);
    assert.equal(result.calls.length,1);
  }
});
test('transient HTTP and connection failures are retried', async () => {
  for (const first of [{status:503,body:'{}'},new Error('connection failed')]) {
    const result = await check([first,{body:'{"ok":true}'}]);
    assert.equal(result.exitCode,0);
    assert.equal(result.calls.length,2);
  }
});
test('missing secrets and malformed base URLs fail before a request is sent', async () => {
  for (const env of [{CRON_SECRET:''},{TASKFORCE_URL:'http://taskforce.example'},{TASKFORCE_URL:'https://taskforce.example/api/cron'}]) {
    const result = await check([],env);
    assert.equal(result.exitCode,1);
    assert.equal(result.calls.length,0);
  }
});
