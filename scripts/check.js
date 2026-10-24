const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const directory of ['.', 'backend', 'core', 'public', 'scripts', 'api', 'tests']) {
  if (!fs.existsSync(directory)) continue;
  for (const filename of fs.readdirSync(directory).filter(name => name.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(directory, filename)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
console.log('JavaScript and Vercel configuration checks passed.');
