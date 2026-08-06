import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const requireFile = (name) => fs.existsSync(path.join(root, name)) || failures.push(`missing file: ${name}`);
const forbid = (condition, message) => condition && failures.push(message);

for (const name of ['.gitignore', 'config.example.json', 'CHANGELOG.md', 'AGENTS.md', '.github/workflows/ci.yml']) requireFile(name);
forbid(fs.existsSync(path.join(root, 'install.sh')), 'install.sh must be absent');
forbid(fs.existsSync(path.join(root, 'systemd')), 'the systemd directory must be absent');

let packageJson;
for (const name of ['package.json', 'config.example.json']) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    if (name === 'package.json') packageJson = parsed;
  } catch (error) { failures.push(`${name} is not valid JSON: ${error.message}`); }
}

if (packageJson) {
  for (const script of ['start', 'check', 'test', 'test:coverage', 'verify:repo', 'verify']) {
    forbid(!packageJson.scripts?.[script], `missing npm script: ${script}`);
  }
  const changelog = fs.existsSync(path.join(root, 'CHANGELOG.md')) ? fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8') : '';
  forbid(!changelog.includes(`## [${packageJson.version}]`), 'version is missing from the changelog');
}

const gitignore = fs.existsSync(path.join(root, '.gitignore')) ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8') : '';
forbid(!/^config\.json$/m.test(gitignore), 'config.json is not ignored');
forbid(!/^data\/geoip-cache\.json$/m.test(gitignore), 'data/geoip-cache.json is not ignored');

const textFiles = ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'config.example.json', 'app.js', ...fs.readdirSync(path.join(root, 'src')).filter((x) => x.endsWith('.js')).map((x) => `src/${x}`)];
const combined = textFiles.filter((x) => fs.existsSync(path.join(root, x))).map((x) => fs.readFileSync(path.join(root, x), 'utf8')).join('\n');
for (const [pattern, label] of [[/install\.sh/i, 'reference to install.sh'], [/src\/server\.js/i, 'reference to src/server.js'], [/spadacenta|\/etc\/letsencrypt\/live\//i, 'installation-specific domain or TLS path']]) forbid(pattern.test(combined), label);
const readme = fs.existsSync(path.join(root, 'README.md')) ? fs.readFileSync(path.join(root, 'README.md'), 'utf8') : '';
forbid(/systemd|daemon|systemctl|journalctl|\/opt\//i.test(readme), 'resident-process operational documentation is present');

const decodeTerms = (encodedTerms) => encodedTerms.map((value) => Buffer.from(value, 'base64').toString('utf8'));
const knownItalianPhrases = decodeTerms([
  'TWVzc2FnZ2lvIFdlYlNvY2tldA==',
  'TmVzc3VuIHRyYWZmaWNv',
  'UG9ydGEgbW9uaXRvcmF0YQ==',
  'TG9jYWxpdMOgIG5vbiBkaXNwb25pYmlsZQ==',
  'ZGV2ZSBlc3NlcmU=',
  'dmVycsOgIGF2dmlhdG8=',
  'Y29uZmlndXJhemlvbmUgZGkgZXNlbXBpbw==',
  'dHJhZmZpY28gcmVjZW50ZQ==',
  'YXJyZXN0byBwcm9ncmFtbWF0bw==',
  'ZmlsZSBtYW5jYW50ZQ==',
  'bm9uIMOoIEpTT04gdmFsaWRv'
]);
const prohibitedToolReferences = decodeTerms([
  'Q29kZXg=',
  'Q2hhdEdQVA==',
  'T3BlbkFJ',
  'QUktZ2VuZXJhdGVk',
  'Z2VuZXJhdGVkIGJ5IEFJ'
]);
const obsoleteBrandReferences = decodeTerms([
  'U2VydmVyTWFw',
  'U2VydmVyIE1hcA=='
]);

const listed = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
if (listed.status === 0) {
  for (const relativePath of listed.stdout.split(/\r?\n/).filter(Boolean)) {
    const content = fs.readFileSync(path.join(root, relativePath));
    if (content.includes(0)) continue;
    const text = content.toString('utf8');
    for (const phrase of knownItalianPhrases) {
      if (text.toLocaleLowerCase('en').includes(phrase.toLocaleLowerCase('en'))) failures.push(`known Italian phrase found in ${relativePath}`);
    }
    for (const reference of prohibitedToolReferences) {
      if (text.toLocaleLowerCase('en').includes(reference.toLocaleLowerCase('en'))) failures.push(`development tool reference found in ${relativePath}`);
    }
    for (const reference of obsoleteBrandReferences) {
      if (text.includes(reference)) failures.push(`obsolete product name found in ${relativePath}`);
    }
  }
}

if (fs.existsSync(path.join(root, '.git'))) {
  const tracked = spawnSync('git', ['ls-files', '--', 'config.json', 'data/geoip-cache.json'], { cwd: root, encoding: 'utf8' });
  if (tracked.status === 0 && tracked.stdout.trim()) failures.push(`tracked sensitive local files: ${tracked.stdout.trim().replaceAll('\n', ', ')}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`[verify:repo] ${failure}`);
  process.exitCode = 1;
} else console.log('[verify:repo] repository is consistent');
