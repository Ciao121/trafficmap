import fs from 'node:fs';
import path from 'node:path';

export class GeoIpCache {
  constructor(config) {
    this.config = config;
    this.cache = new Map();
    this.pending = new Map();
    this.dirty = false;
    this.load();
  }

  load() {
    const file = this.config.cacheFile;
    if (!fs.existsSync(file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [ip, entry] of Object.entries(parsed)) this.cache.set(ip, entry);
      console.log(`[geoip] loaded ${this.cache.size} cached IPs`);
    } catch (error) {
      console.error(`[geoip] unable to load cache: ${error.message}`);
    }
  }

  async lookup(ip) {
    const cached = this.cache.get(ip);
    if (cached) {
      if (!cached.negativeUntil || cached.negativeUntil > Date.now()) return cached;
      this.cache.delete(ip);
    }
    if (this.pending.has(ip)) return this.pending.get(ip);

    const promise = this.fetchLookup(ip).finally(() => this.pending.delete(ip));
    this.pending.set(ip, promise);
    return promise;
  }

  async fetchLookup(ip) {
    const url = this.config.endpointTemplate.replace('{ip}', encodeURIComponent(ip));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'traffic-map-monitor/1.0' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const latitude = Number(data.latitude ?? data.lat);
      const longitude = Number(data.longitude ?? data.lon ?? data.lng);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('GeoIP response has no valid coordinates');
      }
      const entry = {
        ip,
        latitude,
        longitude,
        city: data.city || '',
        region: data.region || data.region_name || '',
        country: data.country_name || data.country || '',
        countryCode: data.country_code || data.country_code2 || '',
        isp: data.isp || data.org || '',
        asn: data.asn || '',
        updatedAt: Date.now()
      };
      this.cache.set(ip, entry);
      this.dirty = true;
      return entry;
    } catch (error) {
      const entry = {
        ip,
        error: error.name === 'AbortError' ? 'timeout' : error.message,
        negativeUntil: Date.now() + this.config.negativeCacheMinutes * 60_000,
        updatedAt: Date.now()
      };
      this.cache.set(ip, entry);
      this.dirty = true;
      return entry;
    } finally {
      clearTimeout(timer);
    }
  }

  persist() {
    if (!this.dirty) return;
    const file = this.config.cacheFile;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const object = Object.fromEntries(this.cache.entries());
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(object, null, 2));
    fs.renameSync(temp, file);
    this.dirty = false;
  }
}
