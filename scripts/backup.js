// Save a PostgreSQL snapshot and attached files to private Supabase storage.
require('../server').createApplication().then(async runtime => {
  try { console.log('Backup saved to', await runtime.platform.backup()); }
  finally { await runtime.close(); }
}).catch(error => { console.error('Backup failed:', error.message); process.exitCode = 1; });
