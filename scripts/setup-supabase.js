const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { connectionOptions } = require('../backend/connection');
const { createStorage } = require('../backend/storage');

async function setup() {
  const pool = new Pool(connectionOptions());
  try {
    // These scripts preserve an existing account/password and existing records.
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'setup.sql'), 'utf8'));
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'connect.sql'), 'utf8'));
    await createStorage().ensureBucket();
    console.log('Supabase tables and private file storage are ready. Existing app data was preserved.');
  } finally { await pool.end(); }
}
if (require.main === module) setup().catch(error => { console.error('Supabase setup failed:', error.code || error.message); process.exitCode = 1; });
module.exports = { setup };
