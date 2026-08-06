import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function mergeDeep(base, override) {
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

export function loadConfig() {
  const examplePath = path.join(projectRoot, 'config.example.json');
  const configPath = process.env.TRAFFIC_MAP_CONFIG
    ? path.resolve(process.env.TRAFFIC_MAP_CONFIG)
    : path.join(projectRoot, 'config.json');

  const defaults = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  let config = defaults;

  if (fs.existsSync(configPath)) {
    config = mergeDeep(defaults, JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } else {
    console.warn(`[config] ${configPath} not found; using config.example.json`);
  }

  config.__projectRoot = projectRoot;
  config.geoip.cacheFile = path.resolve(projectRoot, config.geoip.cacheFile);

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

  return config;
}
