import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export function mergeDeep(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeDeep(base[key] ?? {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function loadConfig(options = {}) {
  const root = options.projectRoot || projectRoot;
  const examplePath = options.examplePath || path.join(root, 'config.example.json');
  const configPath = options.configPath || (process.env.TRAFFIC_MAP_CONFIG
    ? path.resolve(process.env.TRAFFIC_MAP_CONFIG)
    : path.join(root, 'config.json'));

  const defaults = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  let config = defaults;

  if (fs.existsSync(configPath)) {
    config = mergeDeep(defaults, JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } else {
    console.warn(`[config] ${configPath} not found; using config.example.json`);
  }

  config.__projectRoot = root;
  config.geoip.cacheFile = path.resolve(root, config.geoip.cacheFile);

  const port = Number(config.monitor.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('monitor.port must be an integer between 1 and 65535');
  }
  config.monitor.port = port;

  for (const key of ['snapshotIntervalMs', 'inactiveAfterSeconds', 'forgetAfterMinutes', 'recentWindowSeconds', 'pulseWindowSeconds']) {
    const n = Number(config.dashboard[key]);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`dashboard.${key} must be greater than zero`);
    config.dashboard[key] = n;
  }

  if (!config.dashboard?.tls?.certificate) {
    throw new Error('dashboard.tls.certificate must be configured');
  }
  if (!config.dashboard?.tls?.privateKey) {
    throw new Error('dashboard.tls.privateKey must be configured');
  }

  return config;
}
