// Conservative lock classification. Unknown/administrative operations keep the
// exclusive schema gate. Ordinary edits share it and lock only related records.
function requestOptions(db, core, { method, path, body = {}, token }) {
  if (core.isReadOnly(method, path)) return { readOnly: true, pinRead: path !== '/api/backup' };
  const get = (sql, ...values) => db.prepare(sql).get(...values);
  const idKey = (kind, id) => Number.isSafeInteger(+id) && +id > 0 ? `${kind}:${+id}` : null;
  const scoped = (before, queueKey = null) => ({ scoped: true, before, queueKey });
  const taskLocks = async (id, board = false) => {
    if (!idKey('task', id)) return;
    // Take the task lock before reading its associations. No other classified
    // operation takes task locks after matter locks, avoiding a lock-order cycle.
    await db.lockKeys([idKey('task', id)]);
    const task = await get('SELECT t.matter_id, i.matter_id AS item_matter_id FROM tasks t LEFT JOIN matter_items i ON i.id = t.item_id WHERE t.id = ?', +id);
    await db.lockKeys([board && 'board-order', idKey('matter', task?.matter_id), idKey('matter', task?.item_matter_id), idKey('matter', body.matter_id)]);
  };
  const direct = /^\/api\/tasks\/(\d+)(?:\/(copy|move|checklist|notes|attachments))?$/.exec(path);
  if (direct && ['POST','PUT','DELETE'].includes(method)) {
    const board = ['copy','move'].includes(direct[2]) || body.status !== undefined;
    return scoped(() => taskLocks(direct[1],board),board ? 'board-order' : `task:${direct[1]}`);
  }
  const child = /^\/api\/(checklist|notes|attachments)\/(\d+)(?:\/(parts))?$/.exec(path);
  if (child) {
    const table = { checklist:'checklist_items', notes:'notes', attachments:'attachments' }[child[1]];
    return scoped(async () => {
      const row = await get(`SELECT task_id FROM ${table} WHERE id = ?`, +child[2]);
      await taskLocks(row?.task_id);
    },`${child[1]}:${child[2]}`);
  }
  if (path === '/api/tasks' && method === 'POST') return scoped(() => db.lockKeys(['board-order', idKey('matter', body.matter_id)]),'board-order');
  const matter = /^\/api\/matters\/(\d+)(?:\/(readiness|checklist\/apply|items))?$/.exec(path);
  if (matter && method !== 'DELETE') {
    // Changes to a matter code/type also share the creation/rename registry lock.
    const board = !matter[2] && ['unconditional','finance_date','settlement_date','status','code'].some(key => body[key] !== undefined);
    return scoped(() => db.lockKeys([
      idKey('matter', matter[1]),
      board && 'board-order',
      (body.code !== undefined || body.type !== undefined) && 'matter-codes',
    ]),board ? 'board-order' : `matter:${matter[1]}`);
  }
  if (path === '/api/matters' && method === 'POST') return scoped(() => db.lockKeys(['board-order','matter-codes']),'board-order');
  const item = /^\/api\/items\/(\d+)(?:\/(assign))?$/.exec(path);
  if (item) return scoped(async () => {
    const row = await get('SELECT matter_id FROM matter_items WHERE id = ?', +item[1]);
    await db.lockKeys([idKey('matter', row?.matter_id), (body.status !== undefined || item[2]) && 'board-order']);
  });
  if (path === '/api/callbacks' && method === 'POST') return scoped(() => db.lockKeys([idKey('matter', body.matter_id)]));
  const callback = /^\/api\/callbacks\/(\d+)(?:\/(attempt|done|reopen|note))?$/.exec(path);
  if (callback) return scoped(async () => {
    await db.lockKeys([idKey('callback', callback[1])]);
    const row = await get('SELECT matter_id FROM callbacks WHERE id = ?', +callback[1]);
    await db.lockKeys([callback[2] === 'attempt' && body.task_title && 'board-order', idKey('matter', row?.matter_id), idKey('matter', body.matter_id)]);
  },callback[2] === 'attempt' && body.task_title ? 'board-order' : `callback:${callback[1]}`);
  if (/^\/api\/time\/(clock-in|clock-out|log)$/.test(path)) return scoped(async () => {
    const row = await get('SELECT user_id FROM sessions WHERE token = ?', token || '');
    await db.lockKeys([idKey('time-user', row?.user_id)]);
  },`time-session:${token || ''}`);
  if (path === '/api/storage/uploads') return scoped(() => db.lockKeys(['upload-grants']),'upload-grants');
  if (['/api/parse-email','/api/open-link','/api/notifications/read'].includes(path)) return scoped(async () => {});
  if (/^\/api\/login(?:\/(code|send-code))?$/.test(path)) {
    const key=`login:${String(body.email || '').trim().toLowerCase()}`;
    return scoped(() => db.lockKeys([key]),key);
  }
  if (path === '/api/logout') return scoped(async () => {});
  return {queueKey:'maintenance'};
}
module.exports = { requestOptions };
