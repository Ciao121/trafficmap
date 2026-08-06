import {
  maskIp
} from './ip-utils.js';

function validatePort(value) {
  const port = Number(value);

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    return null;
  }

  return port;
}

function normalizeProtocol(value) {
  const protocol =
    String(value || 'tcp')
      .trim()
      .toLowerCase();

  return protocol === 'tcp'
    ? 'tcp'
    : null;
}

function createClientKey(
  protocol,
  localPort,
  ip
) {
  return `${protocol}:${localPort}:${ip}`;
}

export class TrafficStore {
  constructor(config, geoIpCache) {
    this.config = config;
    this.geoIpCache = geoIpCache;

    /*
     * Key:
     *
     * protocol:localPort:remoteIp
     *
     * Example:
     *
     * tcp:443:1.2.3.4
     */
    this.clients = new Map();

    this.startedAt = Date.now();
  }

  async record(
    ip,
    direction,
    bytes,
    localPort,
    protocol = 'tcp',
    timestamp = Date.now()
  ) {
    const safePort =
      validatePort(localPort);

    const safeProtocol =
      normalizeProtocol(protocol);

    if (
      !safePort ||
      !safeProtocol
    ) {
      return;
    }

    const key =
      createClientKey(
        safeProtocol,
        safePort,
        ip
      );

    let client =
      this.clients.get(key);

    if (!client) {
      client = {
        key,
        ip,

        displayIp:
          this.config.privacy.maskIp
            ? maskIp(ip)
            : ip,

        protocol:
          safeProtocol,

        localPort:
          safePort,

        geo: null,
        geoPending: true,

        firstSeen:
          timestamp,

        lastSeen:
          timestamp,

        bytesIn: 0,
        bytesOut: 0,

        packetsIn: 0,
        packetsOut: 0,

        buckets:
          new Map()
      };

      this.clients.set(
        key,
        client
      );

      this.geoIpCache
        .lookup(ip)
        .then(
          (geo) => {
            const current =
              this.clients.get(key);

            if (!current) {
              return;
            }

            current.geo =
              geo?.error
                ? null
                : geo;

            current.geoPending =
              false;
          }
        )
        .catch(
          () => {
            const current =
              this.clients.get(key);

            if (!current) {
              return;
            }

            current.geo = null;
            current.geoPending = false;
          }
        );
    }

    const safeBytes =
      Math.max(
        0,
        Number(bytes) || 0
      );

    client.lastSeen =
      timestamp;

    const second =
      Math.floor(
        timestamp / 1000
      );

    let bucket =
      client.buckets.get(second);

    if (!bucket) {
      bucket = {
        bytesIn: 0,
        bytesOut: 0,
        packetsIn: 0,
        packetsOut: 0
      };

      client.buckets.set(
        second,
        bucket
      );
    }

    if (direction === 'in') {
      client.bytesIn +=
        safeBytes;

      client.packetsIn += 1;

      bucket.bytesIn +=
        safeBytes;

      bucket.packetsIn += 1;

      return;
    }

    client.bytesOut +=
      safeBytes;

    client.packetsOut += 1;

    bucket.bytesOut +=
      safeBytes;

    bucket.packetsOut += 1;
  }

  cleanup(now = Date.now()) {
    const oldestBucket =
      Math.floor(
        (
          now -
          this.config.dashboard
            .recentWindowSeconds *
          1000
        ) / 1000
      ) - 2;

    const forgetBefore =
      now -
      this.config.dashboard
        .forgetAfterMinutes *
      60_000;

    for (
      const [key, client]
      of this.clients
    ) {
      for (
        const second
        of client.buckets.keys()
      ) {
        if (
          second <
          oldestBucket
        ) {
          client.buckets.delete(
            second
          );
        }
      }

      if (
        client.lastSeen <
        forgetBefore
      ) {
        this.clients.delete(key);
      }
    }
  }

  snapshot(
    serverInfo,
    selectedPort,
    selectedProtocol = 'tcp',
    viewerIp = ''
  ) {
    const now =
      Date.now();

    this.cleanup(now);

    const safePort =
      validatePort(selectedPort) ||
      443;

    const safeProtocol =
      normalizeProtocol(
        selectedProtocol
      ) || 'tcp';

    const recentFrom =
      Math.floor(
        (
          now -
          this.config.dashboard
            .recentWindowSeconds *
          1000
        ) / 1000
      );

    const pulseFrom =
      Math.floor(
        (
          now -
          this.config.dashboard
            .pulseWindowSeconds *
          1000
        ) / 1000
      );

    const inactiveBefore =
      now -
      this.config.dashboard
        .inactiveAfterSeconds *
      1000;

    const clients = [];

    let matchingClients = 0;
    let mappedClients = 0;
    let activeClients = 0;

    let bytesIn = 0;
    let bytesOut = 0;

    let packetsIn = 0;
    let packetsOut = 0;

    let recentBytesIn = 0;
    let recentBytesOut = 0;

    for (
      const client
      of this.clients.values()
    ) {
      if (
        client.protocol !==
          safeProtocol ||
        client.localPort !==
          safePort
      ) {
        continue;
      }

      matchingClients += 1;

      let windowIn = 0;
      let windowOut = 0;

      let pulseIn = 0;
      let pulseOut = 0;

      for (
        const [second, bucket]
        of client.buckets
      ) {
        if (
          second >=
          recentFrom
        ) {
          windowIn +=
            bucket.bytesIn;

          windowOut +=
            bucket.bytesOut;
        }

        if (
          second >=
          pulseFrom
        ) {
          pulseIn +=
            bucket.bytesIn;

          pulseOut +=
            bucket.bytesOut;
        }
      }

      const active =
        client.lastSeen >=
        inactiveBefore;

      const isViewer =
        Boolean(
          viewerIp &&
          client.ip === viewerIp
        );

      if (active) {
        activeClients += 1;
      }

      bytesIn +=
        client.bytesIn;

      bytesOut +=
        client.bytesOut;

      packetsIn +=
        client.packetsIn;

      packetsOut +=
        client.packetsOut;

      recentBytesIn +=
        windowIn;

      recentBytesOut +=
        windowOut;

      if (!client.geo) {
        continue;
      }

      mappedClients += 1;

      clients.push({
        ip:
          client.displayIp,

        isViewer,

        protocol:
          client.protocol,

        localPort:
          client.localPort,

        latitude:
          client.geo.latitude,

        longitude:
          client.geo.longitude,

        city:
          client.geo.city,

        region:
          client.geo.region,

        country:
          client.geo.country,

        countryCode:
          client.geo.countryCode,

        isp:
          client.geo.isp,

        asn:
          client.geo.asn,

        firstSeen:
          client.firstSeen,

        lastSeen:
          client.lastSeen,

        active,

        bytesIn:
          client.bytesIn,

        bytesOut:
          client.bytesOut,

        packetsIn:
          client.packetsIn,

        packetsOut:
          client.packetsOut,

        recentBytesIn:
          windowIn,

        recentBytesOut:
          windowOut,

        pulseBytesIn:
          pulseIn,

        pulseBytesOut:
          pulseOut
      });
    }

    return {
      type: 'snapshot',

      generatedAt:
        now,

      startedAt:
        this.startedAt,

      server:
        serverInfo,

      config: {
        monitoredPort:
          safePort,

        monitoredProtocol:
          safeProtocol,

        recentWindowSeconds:
          this.config.dashboard
            .recentWindowSeconds,

        pulseWindowSeconds:
          this.config.dashboard
            .pulseWindowSeconds,

        map:
          this.config.map
      },

      totals: {
        clients:
          matchingClients,

        mappedClients,
        activeClients,

        bytesIn,
        bytesOut,

        packetsIn,
        packetsOut,

        recentBytesIn,
        recentBytesOut
      },

      clients
    };
  }
}
