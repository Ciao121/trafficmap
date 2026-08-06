import https from 'node:https';
import fs from 'node:fs';

import {
  WebSocketServer,
  WebSocket
} from 'ws';

import {
  loadConfig
} from './config.js';

import {
  GeoIpCache
} from './geoip-cache.js';

import {
  isPrivateOrReserved,
  normalizeIp
} from './ip-utils.js';

import {
  TrafficStore
} from './traffic-store.js';

import {
  TcpdumpMonitor
} from './tcpdump-monitor.js';

import {
  DEFAULT_ACTIVITY_WINDOW,
  DEFAULT_MONITORED_PORT,
  normalizeTimestamp,
  sendJson as serializeAndSendJson,
  shouldRecordIp,
  validateActivityWindow,
  validatePort
} from './protocol.js';

const MONITOR_STOP_GRACE_MS = 5000;

const config =
  loadConfig();

const certificatePath =
  config.dashboard.tls.certificate;

const privateKeyPath =
  config.dashboard.tls.privateKey;

if (
  !fs.existsSync(
    certificatePath
  )
) {
  throw new Error(
    `TLS certificate not found: ${certificatePath}`
  );
}

if (
  !fs.existsSync(
    privateKeyPath
  )
) {
  throw new Error(
    `TLS private key not found: ${privateKeyPath}`
  );
}

const httpsServer =
  https.createServer(
    {
      cert:
        fs.readFileSync(
          certificatePath
        ),

      key:
        fs.readFileSync(
          privateKeyPath
        )
    },
    (
      request,
      response
    ) => {
      response.writeHead(
        404,
        {
          'content-type':
            'text/plain; charset=utf-8',

          'cache-control':
            'no-store'
        }
      );

      response.end(
        'Not found'
      );
    }
  );

const wss =
  new WebSocketServer({
    server:
      httpsServer,

    path:
      '/ws'
  });

const geoIpCache =
  new GeoIpCache(
    config.geoip
  );

const store =
  new TrafficStore(
    config,
    geoIpCache
  );

const socketStates =
  new WeakMap();

let packetSequence = 0;
let monitoringActive = false;

let snapshotTimer = null;
let persistTimer = null;
let delayedStopTimer = null;

let lifecycleTransition =
  Promise.resolve();

function queueLifecycleTransition(
  operation
) {
  lifecycleTransition =
    lifecycleTransition.then(
      operation,
      operation
    );

  return lifecycleTransition;
}

function sendJson(
  socket,
  payload
) {
  serializeAndSendJson(socket, payload, WebSocket.OPEN);
}

async function resolveServerInfo() {
  const configuredLatitude =
    config.server.latitude ===
      null ||
    config.server.latitude ===
      ''
      ? null
      : Number(
          config.server.latitude
        );

  const configuredLongitude =
    config.server.longitude ===
      null ||
    config.server.longitude ===
      ''
      ? null
      : Number(
          config.server.longitude
        );

  const configured = {
    name:
      config.server.name ||
      'Server',

    latitude:
      Number.isFinite(
        configuredLatitude
      )
        ? configuredLatitude
        : null,

    longitude:
      Number.isFinite(
        configuredLongitude
      )
        ? configuredLongitude
        : null,

    publicIp:
      normalizeIp(
        config.server.publicIp ||
        ''
      )
  };

  if (
    configured.latitude !== null &&
    configured.longitude !== null
  ) {
    return configured;
  }

  if (
    !config.server.autoLocate
  ) {
    return {
      ...configured,

      latitude: 0,
      longitude: 0,
      city: '',
      country: ''
    };
  }

  try {
    const targetIp =
      configured.publicIp;

    const endpointTemplate =
      config.geoip
        .endpointTemplate;

    const url =
      targetIp
        ? endpointTemplate.replace(
            '{ip}',
            encodeURIComponent(
              targetIp
            )
          )
        : endpointTemplate
            .replace(
              '/{ip}',
              '/'
            )
            .replace(
              '{ip}',
              ''
            );

    const response =
      await fetch(
        url,
        {
          headers: {
            'user-agent':
              'trafficmap/1.0'
          },

          signal:
            AbortSignal.timeout(
              Number(
                config.geoip
                  .timeoutMs
              ) || 5000
            )
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    const latitude =
      Number(
        data.latitude ??
        data.lat
      );

    const longitude =
      Number(
        data.longitude ??
        data.lon ??
        data.lng
      );

    return {
      name:
        config.server.name ||
        'Server',

      publicIp:
        configured.publicIp ||
        normalizeIp(
          data.ip ||
          data.ip_address ||
          ''
        ),

      latitude:
        Number.isFinite(
          latitude
        )
          ? latitude
          : 0,

      longitude:
        Number.isFinite(
          longitude
        )
          ? longitude
          : 0,

      city:
        data.city || '',

      country:
        data.country_name ||
        data.country ||
        ''
    };
  } catch (error) {
    console.error(
      `[server-geo] ${error.message}`
    );

    return {
      ...configured,

      latitude: 0,
      longitude: 0,
      city: '',
      country: ''
    };
  }
}

const serverInfo =
  await resolveServerInfo();

function buildFilteredSnapshot(
  state
) {
  const snapshot =
    store.snapshot(
      serverInfo,
      state.monitoredPort,
      state.protocol,
      state.viewerIp
    );

  const now =
    Date.now();

  const thresholdMilliseconds =
    state.activityWindowSeconds *
    1000;

  /*
   * The client viewing the map is no longer excluded.
   *
   * TrafficStore sets isViewer by comparing
   * the actual IP addresses.
   */
  const clients =
    snapshot.clients.filter(
      (client) => {
        const lastSeen =
          normalizeTimestamp(
            client.lastSeen
          );

        if (!lastSeen) {
          return false;
        }

        return (
          Math.max(
            0,
            now - lastSeen
          ) <=
          thresholdMilliseconds
        );
      }
    );

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
    of clients
  ) {
    mappedClients += 1;

    if (client.active) {
      activeClients += 1;
    }

    bytesIn +=
      Number(
        client.bytesIn || 0
      );

    bytesOut +=
      Number(
        client.bytesOut || 0
      );

    packetsIn +=
      Number(
        client.packetsIn || 0
      );

    packetsOut +=
      Number(
        client.packetsOut || 0
      );

    recentBytesIn +=
      Number(
        client.recentBytesIn || 0
      );

    recentBytesOut +=
      Number(
        client.recentBytesOut || 0
      );
  }

  return {
    ...snapshot,

    clients,

    totals: {
      clients:
        clients.length,

      mappedClients,
      activeClients,

      bytesIn,
      bytesOut,

      packetsIn,
      packetsOut,

      recentBytesIn,
      recentBytesOut
    },

    activityWindowSeconds:
      state.activityWindowSeconds
  };
}

function sendSnapshot(socket) {
  const state =
    socketStates.get(socket);

  if (!state) {
    return;
  }

  sendJson(
    socket,
    buildFilteredSnapshot(
      state
    )
  );
}

function broadcastSnapshots() {
  for (
    const socket
    of wss.clients
  ) {
    if (
      socket.readyState ===
      WebSocket.OPEN
    ) {
      sendSnapshot(socket);
    }
  }
}

function broadcastPacketEvent(
  packet
) {
  const ip =
    normalizeIp(
      packet.clientIp
    );

  const localPort =
    validatePort(
      packet.localPort
    );

  const protocol =
    String(
      packet.protocol ||
      'tcp'
    ).toLowerCase();

  const bytes =
    Math.max(
      0,
      Number(
        packet.bytes
      ) || 0
    );

  if (
    !ip ||
    bytes <= 0 ||
    protocol !== 'tcp'
  ) {
    return;
  }

  packetSequence += 1;

  const event = {
    type:
      'packet',

    sequence:
      packetSequence,

    timestamp:
      Date.now(),

    ip,

    direction:
      packet.direction ===
        'out'
        ? 'out'
        : 'in',

    bytes,
    localPort,
    protocol
  };

  for (
    const socket
    of wss.clients
  ) {
    if (
      socket.readyState !==
      WebSocket.OPEN
    ) {
      continue;
    }

    const state =
      socketStates.get(socket);

    if (!state) {
      continue;
    }

    if (
      state.protocol !==
        protocol ||
      state.monitoredPort !==
        localPort
    ) {
      continue;
    }

    /*
     * The event is also sent to the browser
     * currently viewing the dashboard.
     */
    sendJson(
      socket,
      {
        ...event,

        isViewer:
          Boolean(
            state.viewerIp &&
            state.viewerIp === ip
          )
      }
    );
  }
}

const monitor =
  new TcpdumpMonitor(
    config.monitor,
    (packet) => {
      const ip =
        normalizeIp(
          packet.clientIp
        );

      if (!ip) {
        return;
      }

      if (!shouldRecordIp(
        ip,
        {
          ...config.privacy,
          excludedIps: (config.privacy.excludedIps || []).map(normalizeIp)
        },
        isPrivateOrReserved
      )) {
        return;
      }

      broadcastPacketEvent(
        packet
      );

      store
        .record(
          ip,
          packet.direction,
          packet.bytes,
          packet.localPort,
          packet.protocol
        )
        .catch(
          (error) => {
            console.error(
              `[store] ${error.message}`
            );
          }
        );
    }
  );

function handleSocketMessage(
  socket,
  rawData
) {
  let message;

  try {
    message =
      JSON.parse(
        rawData.toString()
      );
  } catch {
    return;
  }

  const state =
    socketStates.get(socket);

  if (!state) {
    return;
  }

  if (
    message?.type ===
    'set_activity_window'
  ) {
    state.activityWindowSeconds =
      validateActivityWindow(
        message.seconds
      );

    sendJson(
      socket,
      {
        type:
          'activity_window',

        seconds:
          state.activityWindowSeconds
      }
    );

    sendSnapshot(socket);
    return;
  }

  if (
    message?.type ===
    'set_monitored_port'
  ) {
    state.monitoredPort =
      validatePort(
        message.port
      );

    state.protocol =
      'tcp';

    console.log(
      `[websocket] ${
        state.viewerIp ||
        'unknown'
      } monitors TCP port ${
        state.monitoredPort
      }`
    );

    sendJson(
      socket,
      {
        type:
          'monitored_port',

        port:
          state.monitoredPort,

        protocol:
          state.protocol
      }
    );

    sendSnapshot(socket);
  }
}

function startTimers() {
  if (!snapshotTimer) {
    const interval =
      Number(
        config.dashboard
          .snapshotIntervalMs
      ) || 1000;

    snapshotTimer =
      setInterval(
        broadcastSnapshots,
        interval
      );

    snapshotTimer.unref?.();
  }

  if (!persistTimer) {
    const interval =
      (
        Number(
          config.geoip
            .persistIntervalSeconds
        ) || 60
      ) * 1000;

    persistTimer =
      setInterval(
        () => {
          geoIpCache.persist();
        },
        interval
      );

    persistTimer.unref?.();
  }
}

function stopTimers() {
  if (snapshotTimer) {
    clearInterval(
      snapshotTimer
    );

    snapshotTimer = null;
  }

  if (persistTimer) {
    clearInterval(
      persistTimer
    );

    persistTimer = null;
  }
}

function cancelDelayedStop() {
  if (!delayedStopTimer) {
    return;
  }

  clearTimeout(
    delayedStopTimer
  );

  delayedStopTimer = null;

  console.log(
    '[agent] scheduled stop canceled'
  );
}

function requestMonitoringStart() {
  cancelDelayedStop();

  queueLifecycleTransition(
    async () => {
      if (
        wss.clients.size === 0
      ) {
        return;
      }

      startTimers();

      if (
        monitoringActive &&
        monitor.isRunning()
      ) {
        broadcastSnapshots();
        return;
      }

      console.log(
        '[agent] first client connected: starting global TCP monitoring'
      );

      try {
        await monitor.start();

        monitoringActive = true;

        broadcastSnapshots();
      } catch (error) {
        monitoringActive = false;

        console.error(
          `[agent] capture start failed: ${error.message}`
        );
      }
    }
  );
}

function executeMonitoringStop() {
  delayedStopTimer = null;

  queueLifecycleTransition(
    async () => {
      if (
        wss.clients.size > 0
      ) {
        return;
      }

      console.log(
        '[agent] no clients for 5 seconds: stopping monitoring'
      );

      stopTimers();

      try {
        await monitor.stop();
      } catch (error) {
        console.error(
          `[agent] capture stop failed: ${error.message}`
        );
      }

      monitoringActive = false;

      geoIpCache.persist();
    }
  );
}

function scheduleMonitoringStop() {
  if (
    wss.clients.size > 0 ||
    delayedStopTimer
  ) {
    return;
  }

  console.log(
    '[agent] no clients connected: stop scheduled in 5 seconds'
  );

  delayedStopTimer =
    setTimeout(
      executeMonitoringStop,
      MONITOR_STOP_GRACE_MS
    );

  delayedStopTimer.unref?.();
}

wss.on(
  'connection',
  (
    socket,
    request
  ) => {
    const rawRemoteAddress =
      request.socket
        .remoteAddress ||
      '';

    const viewerIp =
      normalizeIp(
        rawRemoteAddress
      );

    const state = {
      viewerIp,

      activityWindowSeconds:
        DEFAULT_ACTIVITY_WINDOW,

      monitoredPort:
        DEFAULT_MONITORED_PORT,

      protocol:
        'tcp'
    };

    socketStates.set(
      socket,
      state
    );

    console.log(
      `[websocket] client connected: ${
        viewerIp ||
        rawRemoteAddress ||
        'unknown'
      }`
    );

    requestMonitoringStart();

    sendJson(
      socket,
      {
        type:
          'viewer',

        ip:
          viewerIp
      }
    );

    socket.on(
      'message',
      (rawData) => {
        handleSocketMessage(
          socket,
          rawData
        );
      }
    );

    socket.on(
      'error',
      (error) => {
        console.error(
          `[websocket] client error: ${error.message}`
        );
      }
    );

    socket.on(
      'close',
      () => {
        console.log(
          `[websocket] client disconnected: ${
            viewerIp ||
            rawRemoteAddress ||
            'unknown'
          }`
        );

        setImmediate(
          () => {
            if (
              wss.clients.size === 0
            ) {
              scheduleMonitoringStop();
            }
          }
        );
      }
    );
  }
);

httpsServer.on(
  'error',
  (error) => {
    console.error(
      `[agent] ${error.message}`
    );

    process.exit(1);
  }
);

httpsServer.listen(
  config.dashboard.listenPort,
  config.dashboard.listenHost,
  () => {
    console.log(
      `[agent] HTTPS WebSocket listening on ${
        config.dashboard.listenHost
      }:${config.dashboard.listenPort}/ws`
    );

    console.log(
      '[agent] ready; tcpdump will start when the first client connects'
    );

    console.log(
      '[agent] capture mode: all TCP ports'
    );
  }
);

let shuttingDown =
  false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `[shutdown] ${signal}`
  );

  if (delayedStopTimer) {
    clearTimeout(
      delayedStopTimer
    );

    delayedStopTimer = null;
  }

  stopTimers();

  monitor
    .stop()
    .catch(
      (error) => {
        console.error(
          `[shutdown] capture stop failed: ${error.message}`
        );
      }
    )
    .finally(
      () => {
        geoIpCache.persist();

        for (
          const socket
          of wss.clients
        ) {
          try {
            socket.close(
              1001,
              'Agent shutting down'
            );
          } catch {
            socket.terminate();
          }
        }

        wss.close();

        httpsServer.close(
          () => {
            process.exit(0);
          }
        );

        setTimeout(
          () => {
            process.exit(1);
          },
          3000
        ).unref();
      }
    );
}

process.on(
  'SIGINT',
  () => {
    shutdown(
      'SIGINT'
    );
  }
);

process.on(
  'SIGTERM',
  () => {
    shutdown(
      'SIGTERM'
    );
  }
);

process.on(
  'uncaughtException',
  (error) => {
    console.error(
      '[uncaughtException]',
      error
    );

    shutdown(
      'uncaughtException'
    );
  }
);

process.on(
  'unhandledRejection',
  (reason) => {
    console.error(
      '[unhandledRejection]',
      reason
    );
  }
);
