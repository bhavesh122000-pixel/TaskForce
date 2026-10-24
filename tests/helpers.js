const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createPostgres } = require('../backend/postgres');

async function database({ onQuery = () => {}, delay = () => 0 } = {}) {
  const pg = new PGlite();
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  for (const file of ['setup.sql', 'connect.sql']) await pg.exec(fs.readFileSync(path.join(__dirname, '..', 'supabase', file), 'utf8'));
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      const previous = tail; let release;
      tail = new Promise(resolve => { release = resolve; }); await previous;
      return { async query(sql, parameters) { onQuery(sql); const ms = delay(); if (ms) await new Promise(resolve => setTimeout(resolve, ms)); const result = await pg.query(sql, parameters); return { ...result, rowCount: result.affectedRows, command: '' }; }, release };
    },
    end: () => pg.close(),
  };
  return createPostgres({ pool, timezone: 'Australia/Adelaide' });
}

function memoryStorage() {
  const files = new Map();
  return {
    files, bucket: 'test-private', ensureBucket: async () => {},
    randomName: filename => crypto.randomBytes(16).toString('hex') + path.extname(filename || ''),
    async put(name, data) { files.set(name, Buffer.from(data)); return name; },
    async get(name) { if (!files.has(name)) throw new Error('File missing'); return files.get(name); },
    async size(name) { return files.get(name)?.length ?? -1; },
    async remove(names) { for (const name of names) files.delete(name); },
    async copy(source, destination) { if (!files.has(source)) throw new Error('File missing'); files.set(destination, files.get(source)); },
    async list(prefix = '') {
      const names = new Map();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix + '/')) continue;
        const relative = key.slice(prefix.length + 1), name = relative.split('/')[0];
        names.set(name, { name, id: relative.includes('/') ? null : 'file' });
      }
      return [...names.values()];
    },
    async signedUpload(name) { return 'https://storage.example/' + name; },
    async signedDownload(name) { return 'https://storage.example/' + name; },
  };
}
module.exports = { database, memoryStorage };
