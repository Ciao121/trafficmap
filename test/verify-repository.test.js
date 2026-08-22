import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findInstallationSpecificReferences } from '../scripts/repository-rules.js';

test('allows the official public demo link in the README', () => {
  const readme = fs.readFileSync(
    new URL('../README.md', import.meta.url),
    'utf8'
  );

  assert.deepEqual(
    findInstallationSpecificReferences([['README.md', readme]]),
    []
  );
});

test('rejects installation-specific domains in application files', () => {
  const failures = findInstallationSpecificReferences([
    ['app.js', "const endpoint = 'https://spadacenta.com/socket';"],
    ['src/agent.js', "const host = 'spadacenta.com';"]
  ]);

  assert.deepEqual(failures, [
    'installation-specific domain found in app.js',
    'installation-specific domain found in src/agent.js'
  ]);
});

test('rejects real Let\'s Encrypt installation paths', () => {
  const failures = findInstallationSpecificReferences([
    ['config.example.json', '"certificate": "/etc/letsencrypt/live/example.com/fullchain.pem"']
  ]);

  assert.deepEqual(failures, [
    'installation-specific TLS path found in config.example.json'
  ]);
});
