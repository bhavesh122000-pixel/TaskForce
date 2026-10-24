const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool } = require('pg');
const { connectionOptions } = require('./connection');

const TABLES = ['users', 'sessions', 'matters', 'matter_items', 'checklist_templates', 'tasks', 'checklist_items', 'notes', 'activity', 'attachments', 'callbacks', 'notifications', 'checklists', 'checklist_stages', 'matter_stages', 'settings', 'email_parts', 'file_tokens', 'holidays', 'leave', 'time_entries', 'work_logs', 'login_codes', 'callback_log'];
const IDS = new Set(TABLES.filter(t => !['sessions', 'settings', 'file_tokens'].includes(t)));

// Parameter binding and schema qualification for application SQL. The query
// sources use PostgreSQL syntax; values are always passed separately to pg.
function compileSql(sql, schema = 'taskforce_app') {
  const literals = [];
  let text = sql.replace(/'(?:''|[^'])*'/g, value => `__TF_LITERAL_${literals.push(value) - 1}__`);
  let index = 0;
  text = text.replace(/\?/g, () => `$${++index}`);
  text = explicitNullOrder(text);
  const names = [...TABLES, 'upload_grants'].join('|');
  text = text.replace(new RegExp(`\\b(FROM|JOIN|UPDATE|INTO)\\s+(${names})\\b`, 'gi'), (_, keyword, name) => `${keyword} "${schema}"."${name.toLowerCase()}"`);
  return text.replace(/__TF_LITERAL_(\d+)__/g, (_, i) => literals[+i]);
}

// Keep the application's established ordering explicit in PostgreSQL.
function explicitNullOrder(text) {
  const pattern = /\bORDER\s+BY\s+/gi;
  const edits = [];
  let match;
  while ((match = pattern.exec(text))) {
    let start = pattern.lastIndex, depth = 0, i = start;
    const finish = end => {
      const item = text.slice(start, end).trim();
      if (item && !/\bNULLS\s+(FIRST|LAST)\b/i.test(item)) edits.push({ at: end, value: /\bDESC\s*$/i.test(item) ? ' NULLS LAST' : ' NULLS FIRST' });
    };
    for (; i < text.length; i++) {
      if (depth === 0 && (text[i] === ')' || /^(?:LIMIT|OFFSET|FETCH|FOR|RETURNING)\b/i.test(text.slice(i)))) { finish(i); break; }
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      else if (text[i] === ',' && depth === 0) { finish(i); start = i + 1; }
    }
    if (i === text.length) finish(i);
  }
  for (const edit of edits.sort((a, b) => b.at - a.at)) text = text.slice(0, edit.at) + edit.value + ' ' + text.slice(edit.at);
  return text;
}

function normalize(result) {
  for (const row of result.rows) for (const field of result.fields || []) {
    if ((field.dataTypeID === 20 || field.dataTypeID === 1700) && row[field.name] != null) {
      const number = Number(row[field.name]);
      if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds JavaScript safe range.');
      row[field.name] = number;
    }
  }
  return result;
}

function createPostgres({ connectionString = process.env.DATABASE_URL, pool, schema = process.env.SUPABASE_DB_SCHEMA || 'taskforce_app', timezone = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid SUPABASE_DB_SCHEMA.');
  if (!pool && !connectionString) throw new Error('Set DATABASE_URL to the Supabase PostgreSQL connection string in .env.local.');
  const max = Math.min(20, Math.max(2, parseInt(process.env.PG_POOL_MAX || '5', 10) || 5));
  const connections = pool || new Pool({ ...connectionOptions(connectionString), max, idleTimeoutMillis: 30000 });
  connections.on?.('error', error => console.error('[postgres pool]', error.code || error.message));
  const context = new AsyncLocalStorage(), compiled = new Map();
  function sqlText(sql) {
    if (!compiled.has(sql)) {
      if (compiled.size >= 1000) compiled.clear();
      compiled.set(sql, compileSql(sql, schema));
    }
    return compiled.get(sql);
  }
  async function query(sql, params = []) {
    const current = context.getStore();
    if (!current) throw new Error('Database queries must run inside withConnection().');
    if (current.readOnly && !/^\s*(SELECT|WITH)\b/i.test(sql)) throw new Error('A read-only request attempted to modify the database.');
    const client = current.client || await connections.connect();
    try { return normalize(await client.query(sqlText(sql), params)); }
    finally { if (!current.client) client.release(); }
  }
  const db = {
    dialect: 'postgres', schema,
    // The cache belongs to one request, so permission/settings changes are visible
    // to the next request. Writes invalidate it inside the current request too.
    memo(key, loader) {
      const current = context.getStore();
      if (!current) return loader();
      if (!current.cache.has(key)) current.cache.set(key, Promise.resolve().then(loader));
      return current.cache.get(key);
    },
    async withConnection(callback, { readOnly = false, independent = false } = {}) {
      if (context.getStore() && !independent) return callback();
      if (readOnly) return context.run({ readOnly: true, cache: new Map() }, callback);
      const client = await connections.connect();
      const current = { client, readOnly: false, savepoints: [], cache: new Map() };
      try {
        await client.query('BEGIN');
        // Writes retain cross-process ordering for multi-record business rules.
        // Ordinary page reads do not take this lock or hold a transaction open.
        await client.query("SELECT set_config('TimeZone', $1, true), pg_advisory_xact_lock(hashtextextended($2, 0))", [timezone, schema]);
        const result = await context.run(current, callback);
        const rejected = result?.status >= 400 && !result.commitOnError;
        const commit = await client.query(rejected ? 'ROLLBACK' : 'COMMIT');
        if (!rejected && commit.command === 'ROLLBACK') throw new Error('The database transaction could not be committed.');
        return result;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    },
    prepare(sql) {
      return {
        async get(...params) { return (await query(sql, params)).rows[0]; },
        async all(...params) { return (await query(sql, params)).rows; },
        async run(...params) {
          const current = context.getStore();
          if (current?.readOnly) throw new Error('A read-only request attempted to modify the database.');
          current?.cache.clear();
          const table = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(sql)?.[1]?.toLowerCase();
          const withId = IDS.has(table) && !/\bRETURNING\b/i.test(sql);
          const result = await query(sql + (withId ? ' RETURNING id' : ''), params);
          return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id || 0 };
        },
      };
    },
    async reserveIds(table, count) {
      if (!IDS.has(table) || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid ID allocation.');
      if (context.getStore()?.readOnly) throw new Error('ID allocation requires a write transaction.');
      if (!count) return [];
      return (await query('SELECT nextval(pg_get_serial_sequence(?, \'id\')) AS id FROM generate_series(1, ?::int)', [`${schema}.${table}`, count])).rows.map(row => row.id);
    },
    async insertMany(table, columns, rows) {
      if (!TABLES.includes(table) || columns.some(column => !/^[a-z_]+$/.test(column))) throw new Error('Invalid bulk insert target.');
      if (context.getStore()?.readOnly) throw new Error('Bulk inserts require a write transaction.');
      context.getStore()?.cache.clear();
      for (let start = 0; start < rows.length; start += 500) {
        const batch = rows.slice(start, start + 500);
        if (batch.some(row => row.length !== columns.length)) throw new Error('Invalid bulk insert row.');
        await query(`INSERT INTO ${table} (${columns.map(column => `"${column}"`).join(',')}) VALUES ${batch.map(() => '(' + columns.map(() => '?').join(',') + ')').join(',')}`, batch.flat());
      }
    },
    async exec(sql) {
      const current = context.getStore();
      if (!current?.client || current.readOnly) throw new Error('Database exec requires a write transaction.');
      current.cache.clear();
      const command = sql.trim().replace(/;$/, '').toUpperCase();
      if (command === 'BEGIN') {
        const name = `tf_${current.savepoints.length + 1}`;
        await current.client.query(`SAVEPOINT ${name}`); current.savepoints.push(name); return;
      }
      if (command === 'COMMIT' || command === 'ROLLBACK') {
        const name = current.savepoints.pop();
        if (!name) throw new Error('No engine transaction is active.');
        if (command === 'ROLLBACK') await current.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await current.client.query(`RELEASE SAVEPOINT ${name}`); return;
      }
      await query(sql);
    },
    close: () => connections.end(),
  };
  return db;
}
module.exports = { createPostgres, compileSql, TABLES };
