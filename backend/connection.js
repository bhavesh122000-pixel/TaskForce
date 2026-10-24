const fs = require('node:fs');
const path = require('node:path');

function connectionOptions(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('Set DATABASE_URL in the ignored .env.local file.');
  const url = new URL(connectionString);
  const project = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(process.env.SUPABASE_URL || '')?.[1];
  if (project) {
    const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(url.hostname)?.[1];
    const pooled = decodeURIComponent(url.username).split('.')[1];
    if ((direct && direct !== project) || (pooled && pooled !== project)) throw new Error('DATABASE_URL and SUPABASE_URL refer to different projects.');
  }
  // A URL sslmode can override node-postgres's explicit TLS configuration.
  // Keep certificate and hostname verification enabled with the bundled CA.
  for (const option of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(option);
  return { connectionString: url.toString(), connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: true, ca: fs.readFileSync(path.join(__dirname, '..', 'certs', 'supabase-ca.crt'), 'utf8') } };
}
module.exports = { connectionOptions };
