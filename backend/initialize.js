const { DatabaseSync } = require('node:sqlite');
const { initSchema } = require('../core/schema');

// Seed only an entirely empty library. Generate the defaults from the existing
// engine in memory; never open or import the office's data/taskforce.db file.
// Batch the resulting rows so a first cloud start avoids hundreds of round trips.
async function seedFreshDefaults(db) {
  const tables = ['checklists', 'checklist_templates', 'checklist_stages', 'settings', 'holidays'];
  const total = await db.prepare('SELECT ' + tables.map(table => `(SELECT COUNT(*) FROM ${table})`).join(' + ') + ' AS n').get();
  if (total.n !== 0) return;
  const local = new DatabaseSync(':memory:');
  try {
    await initSchema(local);
    for (const table of tables) {
      const rows = local.prepare(`SELECT * FROM ${table}`).all();
      if (!rows.length) continue;
      await db.prepare(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::"${db.schema}"."${table}", ?::jsonb)`).run(JSON.stringify(rows));
      if (table !== 'settings') await db.prepare(`SELECT setval(pg_get_serial_sequence(?, 'id'), (SELECT MAX(id) FROM ${table}), true)`).get(`${db.schema}.${table}`);
    }
  } finally { local.close(); }
}
module.exports = { seedFreshDefaults };
