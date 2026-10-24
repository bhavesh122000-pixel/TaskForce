const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool } = require('pg');
const { connectionOptions } = require('./connection');

const TABLES = ['users', 'sessions', 'matters', 'matter_items', 'checklist_templates', 'tasks', 'checklist_items', 'notes', 'activity', 'attachments', 'callbacks', 'notifications', 'checklists', 'checklist_stages', 'matter_stages', 'settings', 'email_parts', 'file_tokens', 'holidays', 'leave', 'time_entries', 'work_logs', 'login_codes', 'callback_log'];
const IDS = new Set(TABLES.filter(t => !['sessions', 'settings', 'file_tokens'].includes(t)));

// Translate the engine's SQLite placeholders and small dialect differences.
// Quoted values are protected before rewriting identifiers or operators.
function translate(sql, schema = 'taskforce_app') {
  const literals = [];
  let text = sql.replace(/'(?:''|[^'])*'/g, value => `__TF_LITERAL_${literals.push(value) - 1}__`);
  // SQLite's MAX row is used for repeat-caller suggestions and recent activity.
  if (/SELECT caller_name, phone, email, company, matter_id, MAX\(created_at\) AS last/i.test(text)) {
    text = text.replace(/SELECT caller_name, phone, email, company, matter_id, MAX\(created_at\) AS last FROM callbacks WHERE ([\s\S]+) GROUP BY caller_name, phone ORDER BY last DESC LIMIT 8/i,
      'SELECT * FROM (SELECT DISTINCT ON (caller_name, phone) caller_name, phone, email, company, matter_id, created_at AS last FROM callbacks WHERE $1 ORDER BY caller_name, phone, created_at DESC, id ASC) recent ORDER BY last DESC LIMIT 8');
  }
  text = text.replace(/GROUP BY t\.id ORDER BY at DESC/i, 'GROUP BY t.id, m.code, m.type ORDER BY at DESC');
  if (/SELECT c\.caller_name, l\.kind, MAX\(l\.created_at\) AS at/i.test(text)) {
    text = text.replace(/SELECT c\.caller_name, l\.kind, MAX\(l\.created_at\) AS at FROM callback_log l JOIN callbacks c ON c\.id = l\.callback_id WHERE ([\s\S]+) GROUP BY c\.id ORDER BY at DESC LIMIT 6/i,
      'SELECT caller_name, kind, at FROM (SELECT DISTINCT ON (c.id) c.caller_name, l.kind, l.created_at AS at FROM callback_log l JOIN callbacks c ON c.id = l.callback_id WHERE $1 ORDER BY c.id, l.created_at DESC, l.id ASC) recent ORDER BY at DESC LIMIT 6');
  }
  let index = 0;
  text = text.replace(/\?/g, () => `$${++index}`);
  text = text.replace(/\bIS\s+(\$\d+)/gi, 'IS NOT DISTINCT FROM $1');
  text = text.replace(/\bLIKE\b/gi, 'ILIKE');
  // Preserve COLLATE NOCASE equality for the original email and matter code.
  const where = text.search(/\bWHERE\b/i);
  if (where >= 0) text = text.slice(0, where) + text.slice(where).replace(/\b((?:\w+\.)?(?:email|code))\s*(=|<>|!=)\s*(\$\d+)/gi, 'lower($1) $2 lower($3)');
  text = sqliteNullOrder(text);
  const names = [...TABLES, 'upload_grants'].join('|');
  text = text.replace(new RegExp(`\\b(FROM|JOIN|UPDATE|INTO)\\s+(${names})\\b`, 'gi'), (_, keyword, name) => `${keyword} "${schema}"."${name.toLowerCase()}"`);
  return text.replace(/__TF_LITERAL_(\d+)__/g, (_, i) => literals[+i]);
}

function sqliteNullOrder(text) {
  // SQLite sorts NULL first in ascending order and last in descending order.
  // Track parentheses so nested ORDER BY clauses and expressions stay intact.
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
      if (depth === 0 && (text[i] === ')' || /^(?:LIMIT|OFFSET|FETCH|FOR)\b/i.test(text.slice(i)))) { finish(i); break; }
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
  const connections = pool || new Pool({ ...connectionOptions(connectionString), max: 3, idleTimeoutMillis: 10000 });
  const context = new AsyncLocalStorage();
  async function query(sql, params = []) {
    const current = context.getStore();
    if (!current) throw new Error('Database queries must run inside withConnection().');
    return normalize(await current.client.query(translate(sql, schema), params));
  }
  return {
    dialect: 'postgres', schema,
    async withConnection(callback) {
      if (context.getStore()) return callback();
      const client = await connections.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('TimeZone', $1, true)", [timezone]);
        // Keep each engine operation in the same order as the original single
        // office database, including across different serverless instances.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [schema]);
        const result = await context.run({ client, savepoints: [] }, callback);
        const commit = await client.query('COMMIT');
        if (commit.command === 'ROLLBACK') throw new Error('The database transaction could not be committed.');
        return result;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    },
    prepare(sql) {
      return {
        async get(...params) { return (await query(sql, params)).rows[0]; },
        async all(...params) { return (await query(sql, params)).rows; },
        async run(...params) {
          const table = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(sql)?.[1]?.toLowerCase();
          const withId = IDS.has(table) && !/\bRETURNING\b/i.test(sql);
          const result = await query(sql + (withId ? ' RETURNING id' : ''), params);
          return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id || 0 };
        },
      };
    },
    async exec(sql) {
      const current = context.getStore();
      if (!current) throw new Error('Database exec requires withConnection().');
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
}
module.exports = { createPostgres, translate, TABLES };
