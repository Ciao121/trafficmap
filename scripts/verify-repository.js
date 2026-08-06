import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const requireFile = (name) => fs.existsSync(path.join(root, name)) || failures.push(`file mancante: ${name}`);
const forbid = (condition, message) => condition && failures.push(message);

for (const name of ['.gitignore', 'config.example.json', 'CHANGELOG.md', 'AGENTS.md', '.github/workflows/ci.yml']) requireFile(name);
forbid(fs.existsSync(path.join(root, 'install.sh')), 'install.sh deve essere assente');
forbid(fs.existsSync(path.join(root, 'systemd')), 'la directory systemd deve essere assente');

let packageJson;
for (const name of ['package.json', 'config.example.json']) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    if (name === 'package.json') packageJson = parsed;
  } catch (error) { failures.push(`${name} non è JSON valido: ${error.message}`); }
}

if (packageJson) {
  for (const script of ['start', 'check', 'test', 'test:coverage', 'verify:repo', 'verify']) {
    forbid(!packageJson.scripts?.[script], `script npm mancante: ${script}`);
  }
  const changelog = fs.existsSync(path.join(root, 'CHANGELOG.md')) ? fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8') : '';
  forbid(!changelog.includes(`## [${packageJson.version}]`), 'versione assente dal changelog');
}

const gitignore = fs.existsSync(path.join(root, '.gitignore')) ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8') : '';
forbid(!/^config\.json$/m.test(gitignore), 'config.json non ignorato');
forbid(!/^data\/geoip-cache\.json$/m.test(gitignore), 'data/geoip-cache.json non ignorato');

const textFiles = ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'config.example.json', 'app.js', ...fs.readdirSync(path.join(root, 'src')).filter((x) => x.endsWith('.js')).map((x) => `src/${x}`)];
const combined = textFiles.filter((x) => fs.existsSync(path.join(root, x))).map((x) => fs.readFileSync(path.join(root, x), 'utf8')).join('\n');
for (const [pattern, label] of [[/install\.sh/i, 'riferimento a install.sh'], [/src\/server\.js/i, 'riferimento a src/server.js'], [/spadacenta|\/etc\/letsencrypt\/live\//i, 'dominio o percorso TLS reale']]) forbid(pattern.test(combined), label);
const readme = fs.existsSync(path.join(root, 'README.md')) ? fs.readFileSync(path.join(root, 'README.md'), 'utf8') : '';
forbid(/systemd|daemon|systemctl|journalctl|\/opt\//i.test(readme), 'documentazione operativa di daemonizzazione presente');

if (fs.existsSync(path.join(root, '.git'))) {
  const tracked = spawnSync('git', ['ls-files', '--', 'config.json', 'data/geoip-cache.json'], { cwd: root, encoding: 'utf8' });
  if (tracked.status === 0 && tracked.stdout.trim()) failures.push(`file locali sensibili tracciati: ${tracked.stdout.trim().replaceAll('\n', ', ')}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`[verify:repo] ${failure}`);
  process.exitCode = 1;
} else console.log('[verify:repo] repository coerente');
