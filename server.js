// The existing app engine, connected to Supabase by default.
const fs = require('node:fs');
const path = require('node:path');
const envFile = path.join(__dirname, '.env.local');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const { createApplication } = require('./backend/app');
let application;
function getApplication() {
  if (!application) application = createApplication().catch(error => { application = null; throw error; });
  return application;
}
module.exports = async (req, res) => {
  try { const runtime = await getApplication(); runtime.app(req, res); }
  catch (error) { console.error('[startup]', error.message); res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Server configuration is incomplete. Check the server logs.' })); }
};
module.exports.createApplication = createApplication;
if (require.main === module) {
  getApplication().then(runtime => {
    runtime.app.listen(runtime.port, '0.0.0.0', () => console.log(`TaskForce is running at http://localhost:${runtime.port} using Supabase PostgreSQL.`));
    if (process.env.TF_SCHEDULER !== 'external') {
      setInterval(() => runtime.jobs().catch(error => console.error('[jobs]', error.message)), 10 * 60e3).unref();
      setTimeout(() => runtime.jobs().catch(error => console.error('[jobs]', error.message)), 5000).unref();
    }
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
