const ALLOWED_ACTIVITY_WINDOWS = new Set([
  5,
  10,
  30,
  60
]);

const DEFAULT_ACTIVITY_WINDOW = 5;
const DEFAULT_MONITORED_PORT = 443;

const ACTIVITY_COOKIE =
  'servermap_activity_window';

const PORT_COOKIE =
  'servermap_monitored_port';

const COOKIE_MAX_AGE =
  365 * 24 * 60 * 60;

const KNOWN_PORTS = new Set([
  21,
  22,
  25,
  53,
  80,
  110,
  143,
  443,
  465,
  587,
  993,
  995,
  3306,
  5432,
  6379
]);

const PACKET_ANIMATION_MIN_MS = 420;
const PACKET_ANIMATION_MAX_MS = 850;
const PACKET_LINE_FADE_MS = 180;

const MAX_CONCURRENT_ANIMATIONS = 100;
const MAX_PACKET_QUEUE_SIZE = 1500;

const MAX_DEFERRED_PACKETS_PER_IP = 50;
const DEFERRED_PACKET_MAX_AGE_MS = 3000;

const GEODESIC_SEGMENTS = 64;

/*
 * Coordinate con cinque decimali:
 * circa un metro di precisione.
 *
 * Gli IP geolocalizzati nello stesso punto
 * vengono quindi raggruppati.
 */
const COORDINATE_GROUP_PRECISION = 5;

const map = L.map(
  'map',
  {
    zoomControl: false,
    worldCopyJump: false,
    inertia: false
  }
).setView(
  [20, 0],
  3
);

L.control.zoom({
  position: 'bottomright'
}).addTo(map);

const ui = {
  connection:
    document.querySelector(
      '#connection'
    ),

  serverName:
    document.querySelector(
      '#server-name'
    ),

  port:
    document.querySelector(
      '#port'
    ),

  monitoredPort:
    document.querySelector(
      '#monitored-port'
    ),

  customPortContainer:
    document.querySelector(
      '#custom-port-container'
    ),

  customPort:
    document.querySelector(
      '#custom-port'
    ),

  activityWindow:
    document.querySelector(
      '#activity-window'
    ),

  activeClients:
    document.querySelector(
      '#active-clients'
    ),

  mappedClients:
    document.querySelector(
      '#mapped-clients'
    ),

  recentIn:
    document.querySelector(
      '#recent-in'
    ),

  recentOut:
    document.querySelector(
      '#recent-out'
    ),

  total:
    document.querySelector(
      '#total'
    ),

  empty:
    document.querySelector(
      '#empty'
    )
};

let tileLayer = null;
let serverMarker = null;
let socket = null;
let reconnectTimer = null;

let currentServerCoordinates = null;

/*
 * I marker sono indicizzati per gruppo
 * di coordinate, non più per IP.
 */
const groupMarkers = new Map();

/*
 * Le coordinate restano memorizzate
 * separatamente per IP, perché gli eventi
 * realtime arrivano con l'IP.
 */
const clientCoordinates = new Map();

const packetQueue = [];
const deferredPackets = new Map();
const activeAnimations = new Set();

let pendingSnapshot = null;
let renderScheduled = false;

function validatePort(value) {
  const port = Number(value);

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    return DEFAULT_MONITORED_PORT;
  }

  return port;
}

function validateActivityWindow(value) {
  const seconds = Number(value);

  return ALLOWED_ACTIVITY_WINDOWS.has(seconds)
    ? seconds
    : DEFAULT_ACTIVITY_WINDOW;
}

function readCookie(name) {
  const prefix =
    `${encodeURIComponent(name)}=`;

  const cookies =
    document.cookie
      .split(';')
      .map(
        (cookie) =>
          cookie.trim()
      );

  for (const cookie of cookies) {
    if (!cookie.startsWith(prefix)) {
      continue;
    }

    try {
      return decodeURIComponent(
        cookie.slice(
          prefix.length
        )
      );
    } catch {
      return '';
    }
  }

  return '';
}

function writeCookie(
  name,
  value
) {
  document.cookie = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE}`,
    'SameSite=Lax',
    'Secure'
  ].join('; ');
}

let activityWindowSeconds =
  validateActivityWindow(
    readCookie(
      ACTIVITY_COOKIE
    )
  );

let monitoredPort =
  validatePort(
    readCookie(
      PORT_COOKIE
    )
  );

function updatePortControls() {
  if (
    KNOWN_PORTS.has(
      monitoredPort
    )
  ) {
    ui.monitoredPort.value =
      String(monitoredPort);

    ui.customPortContainer.hidden =
      true;

    ui.customPort.value = '';

    return;
  }

  ui.monitoredPort.value =
    'custom';

  ui.customPortContainer.hidden =
    false;

  ui.customPort.value =
    String(monitoredPort);
}

ui.activityWindow.value =
  String(
    activityWindowSeconds
  );

updatePortControls();

function normalizeIp(ip) {
  if (!ip) {
    return '';
  }

  let normalized =
    String(ip)
      .trim()
      .toLowerCase();

  if (
    normalized.startsWith(
      '::ffff:'
    )
  ) {
    normalized =
      normalized.slice(7);
  }

  const zoneIndex =
    normalized.indexOf('%');

  if (zoneIndex !== -1) {
    normalized =
      normalized.slice(
        0,
        zoneIndex
      );
  }

  return normalized;
}

function formatBytes(bytes) {
  const value =
    Number(bytes) || 0;

  if (value <= 0) {
    return '0 B';
  }

  const units = [
    'B',
    'KB',
    'MB',
    'GB',
    'TB'
  ];

  const index =
    Math.min(
      Math.floor(
        Math.log(value) /
        Math.log(1024)
      ),
      units.length - 1
    );

  const decimals =
    index === 0
      ? 0
      : 1;

  return `${
    (
      value /
      1024 ** index
    ).toFixed(decimals)
  } ${units[index]}`;
}

function escapeHtml(value) {
  return String(
    value ?? ''
  )
    .replaceAll(
      '&',
      '&amp;'
    )
    .replaceAll(
      '<',
      '&lt;'
    )
    .replaceAll(
      '>',
      '&gt;'
    )
    .replaceAll(
      '"',
      '&quot;'
    )
    .replaceAll(
      "'",
      '&#039;'
    );
}

function getClientRecentBytes(client) {
  return (
    Number(
      client.recentBytesIn ||
      0
    ) +
    Number(
      client.recentBytesOut ||
      0
    )
  );
}

function getClientPulseBytes(client) {
  return (
    Number(
      client.pulseBytesIn ||
      0
    ) +
    Number(
      client.pulseBytesOut ||
      0
    )
  );
}

function percentile(
  values,
  target
) {
  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    return 0;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const position =
    (sorted.length - 1) *
    target;

  const lower =
    Math.floor(position);

  const upper =
    Math.ceil(position);

  if (lower === upper) {
    return sorted[lower];
  }

  const fraction =
    position - lower;

  return (
    sorted[lower] +
    (
      sorted[upper] -
      sorted[lower]
    ) *
    fraction
  );
}

function markerRadius(
  recentBytes,
  referenceBytes
) {
  const bytes =
    Math.max(
      0,
      Number(recentBytes) || 0
    );

  if (bytes <= 0) {
    return 1.5;
  }

  const reference =
    Math.max(
      Number(referenceBytes) || 1,
      1
    );

  const ratio =
    bytes / reference;

  if (ratio <= 0.02) {
    return 1.5;
  }

  if (ratio <= 0.05) {
    return 1.75;
  }

  if (ratio <= 0.1) {
    return 2;
  }

  if (ratio <= 0.25) {
    return 2.25;
  }

  if (ratio <= 0.5) {
    return 2.75;
  }

  if (ratio <= 1) {
    return 3.5;
  }

  return Math.min(
    12,
    3.5 +
    Math.log2(ratio) *
    1.25
  );
}

function packetDotRadius(bytes) {
  const value =
    Math.max(
      Number(bytes) || 1,
      1
    );

  return Math.min(
    5.5,
    2.2 +
    Math.log10(value) *
    0.42
  );
}

function getCoordinateGroupKey(
  latitude,
  longitude
) {
  return [
    Number(latitude).toFixed(
      COORDINATE_GROUP_PRECISION
    ),

    Number(longitude).toFixed(
      COORDINATE_GROUP_PRECISION
    )
  ].join('|');
}

function groupClientsByCoordinates(
  clients
) {
  const groups = new Map();

  for (const client of clients) {
    const latitude =
      Number(client.latitude);

    const longitude =
      Number(client.longitude);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      continue;
    }

    const ip =
      normalizeIp(client.ip);

    if (!ip) {
      continue;
    }

    clientCoordinates.set(
      ip,
      {
        latitude,
        longitude
      }
    );

    const key =
      getCoordinateGroupKey(
        latitude,
        longitude
      );

    let group =
      groups.get(key);

    if (!group) {
      group = {
        key,
        latitude,
        longitude,
        clients: [],
        hasViewer: false,
        active: false,
        bytesIn: 0,
        bytesOut: 0,
        packetsIn: 0,
        packetsOut: 0,
        recentBytesIn: 0,
        recentBytesOut: 0,
        pulseBytesIn: 0,
        pulseBytesOut: 0
      };

      groups.set(
        key,
        group
      );
    }

    group.clients.push(client);

    group.hasViewer =
      group.hasViewer ||
      client.isViewer === true;

    group.active =
      group.active ||
      client.active === true;

    group.bytesIn +=
      Number(
        client.bytesIn || 0
      );

    group.bytesOut +=
      Number(
        client.bytesOut || 0
      );

    group.packetsIn +=
      Number(
        client.packetsIn || 0
      );

    group.packetsOut +=
      Number(
        client.packetsOut || 0
      );

    group.recentBytesIn +=
      Number(
        client.recentBytesIn || 0
      );

    group.recentBytesOut +=
      Number(
        client.recentBytesOut || 0
      );

    group.pulseBytesIn +=
      Number(
        client.pulseBytesIn || 0
      );

    group.pulseBytesOut +=
      Number(
        client.pulseBytesOut || 0
      );
  }

  for (const group of groups.values()) {
    group.clients.sort(
      (first, second) => {
        if (
          first.isViewer &&
          !second.isViewer
        ) {
          return -1;
        }

        if (
          !first.isViewer &&
          second.isViewer
        ) {
          return 1;
        }

        return (
          getClientRecentBytes(second) -
          getClientRecentBytes(first)
        );
      }
    );
  }

  return groups;
}

function clientPopupRow(client) {
  const title =
    client.isViewer
      ? 'You'
      : client.ip;

  return `
    <article class="group-client">
      <div class="group-client-heading">
        <strong class="${
          client.isViewer
            ? 'group-client-viewer'
            : ''
        }">
          ${escapeHtml(title)}
        </strong>

        ${
          client.isViewer
            ? `
              <span class="group-you-badge">
                You
              </span>
            `
            : ''
        }
      </div>

      ${
        client.isViewer
          ? `
            <div class="group-client-ip">
              ${escapeHtml(client.ip)}
            </div>
          `
          : ''
      }

      <div class="group-client-stats">
        <span>
          In:
          <b>
            ${formatBytes(
              client.bytesIn
            )}
          </b>
        </span>

        <span>
          Out:
          <b>
            ${formatBytes(
              client.bytesOut
            )}
          </b>
        </span>

        <span>
          Recenti:
          <b>
            ${formatBytes(
              getClientRecentBytes(
                client
              )
            )}
          </b>
        </span>
      </div>
    </article>
  `;
}

function groupPopupHtml(group) {
  const firstClient =
    group.clients[0] || {};

  const place = [
    firstClient.city,
    firstClient.region,
    firstClient.country
  ]
    .filter(Boolean)
    .join(', ') ||
    'Località non disponibile';

  const count =
    group.clients.length;

  const title =
    count === 1
      ? (
          group.hasViewer
            ? 'You'
            : firstClient.ip
        )
      : `${count} IP`;

  return `
    <div class="popup-title ${
      group.hasViewer
        ? 'popup-title-viewer'
        : ''
    }">
      ${escapeHtml(title)}
    </div>

    <div class="popup-location">
      ${escapeHtml(place)}
    </div>

    <div class="popup-grid group-summary">
      <span>Protocollo</span>
      <b>
        ${escapeHtml(
          String(
            firstClient.protocol ||
            'tcp'
          ).toUpperCase()
        )}
      </b>

      <span>Porta locale</span>
      <b>
        ${escapeHtml(
          firstClient.localPort ||
          monitoredPort
        )}
      </b>

      <span>IP nel punto</span>
      <b>${count}</b>

      <span>Ingresso totale</span>
      <b>
        ${formatBytes(
          group.bytesIn
        )}
      </b>

      <span>Uscita totale</span>
      <b>
        ${formatBytes(
          group.bytesOut
        )}
      </b>

      <span>Traffico recente</span>
      <b>
        ${formatBytes(
          group.recentBytesIn +
          group.recentBytesOut
        )}
      </b>
    </div>

    <div class="group-client-list">
      ${group.clients
        .map(clientPopupRow)
        .join('')}
    </div>
  `;
}

function groupDivIcon({
  classes,
  size,
  count,
  hasViewer
}) {
  const showCount =
    count > 1;

  const label =
    hasViewer
      ? 'You'
      : '';

  return L.divIcon({
    className: '',

    html: `
      <div
        class="${classes}"
        style="
          width:${size}px;
          height:${size}px;
        "
      >
        ${
          showCount
            ? `
              <span class="group-marker-count">
                ${count}
              </span>
            `
            : ''
        }

        ${
          label
            ? `
              <span class="viewer-map-label">
                ${label}
              </span>
            `
            : ''
        }
      </div>
    `,

    iconSize: [
      size,
      size
    ],

    iconAnchor: [
      size / 2,
      size / 2
    ]
  });
}

function serverDivIcon(
  className,
  size
) {
  return L.divIcon({
    className: '',

    html: `
      <div
        class="${className}"
        style="
          width:${size}px;
          height:${size}px;
        "
      ></div>
    `,

    iconSize: [
      size,
      size
    ],

    iconAnchor: [
      size / 2,
      size / 2
    ]
  });
}

function coordinatesChanged(
  marker,
  latitude,
  longitude
) {
  const current =
    marker.getLatLng();

  return (
    Math.abs(
      current.lat -
      latitude
    ) > 0.000001 ||
    Math.abs(
      current.lng -
      longitude
    ) > 0.000001
  );
}

function degreesToRadians(degrees) {
  return (
    degrees *
    Math.PI /
    180
  );
}

function radiansToDegrees(radians) {
  return (
    radians *
    180 /
    Math.PI
  );
}

function clamp(
  value,
  minimum,
  maximum
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function latLngToVector(latLng) {
  const latitude =
    degreesToRadians(
      Number(latLng.lat)
    );

  const longitude =
    degreesToRadians(
      Number(latLng.lng)
    );

  const cosineLatitude =
    Math.cos(latitude);

  return {
    x:
      cosineLatitude *
      Math.cos(longitude),

    y:
      cosineLatitude *
      Math.sin(longitude),

    z:
      Math.sin(latitude)
  };
}

function normalizeVector(vector) {
  const length =
    Math.sqrt(
      vector.x ** 2 +
      vector.y ** 2 +
      vector.z ** 2
    );

  if (
    !Number.isFinite(length) ||
    length <= 0
  ) {
    return {
      x: 1,
      y: 0,
      z: 0
    };
  }

  return {
    x:
      vector.x / length,

    y:
      vector.y / length,

    z:
      vector.z / length
  };
}

function vectorToLatLng(vector) {
  const normalized =
    normalizeVector(vector);

  const latitude =
    Math.atan2(
      normalized.z,
      Math.sqrt(
        normalized.x ** 2 +
        normalized.y ** 2
      )
    );

  const longitude =
    Math.atan2(
      normalized.y,
      normalized.x
    );

  return {
    latitude:
      radiansToDegrees(latitude),

    longitude:
      radiansToDegrees(longitude)
  };
}

function unwrapLongitude(
  longitude,
  previousLongitude
) {
  if (
    previousLongitude === null ||
    previousLongitude === undefined
  ) {
    return longitude;
  }

  let result =
    longitude;

  while (
    result -
    previousLongitude >
    180
  ) {
    result -= 360;
  }

  while (
    result -
    previousLongitude <
    -180
  ) {
    result += 360;
  }

  return result;
}

function interpolateGreatCircle(
  startVector,
  endVector,
  progress
) {
  const dotProduct =
    clamp(
      startVector.x *
        endVector.x +
      startVector.y *
        endVector.y +
      startVector.z *
        endVector.z,
      -1,
      1
    );

  const angle =
    Math.acos(dotProduct);

  const sineAngle =
    Math.sin(angle);

  if (
    Math.abs(sineAngle) <
    0.000001
  ) {
    return normalizeVector({
      x:
        startVector.x +
        (
          endVector.x -
          startVector.x
        ) *
        progress,

      y:
        startVector.y +
        (
          endVector.y -
          startVector.y
        ) *
        progress,

      z:
        startVector.z +
        (
          endVector.z -
          startVector.z
        ) *
        progress
    });
  }

  const startWeight =
    Math.sin(
      (
        1 -
        progress
      ) *
      angle
    ) /
    sineAngle;

  const endWeight =
    Math.sin(
      progress *
      angle
    ) /
    sineAngle;

  return normalizeVector({
    x:
      startVector.x *
      startWeight +
      endVector.x *
      endWeight,

    y:
      startVector.y *
      startWeight +
      endVector.y *
      endWeight,

    z:
      startVector.z *
      startWeight +
      endVector.z *
      endWeight
  });
}

function createGeodesicCurve(
  start,
  end
) {
  const startVector =
    latLngToVector(start);

  const endVector =
    latLngToVector(end);

  const points = [];

  let previousLongitude = null;

  for (
    let index = 0;
    index <= GEODESIC_SEGMENTS;
    index += 1
  ) {
    const progress =
      index /
      GEODESIC_SEGMENTS;

    const vector =
      interpolateGreatCircle(
        startVector,
        endVector,
        progress
      );

    const coordinates =
      vectorToLatLng(vector);

    const longitude =
      unwrapLongitude(
        coordinates.longitude,
        previousLongitude
      );

    previousLongitude =
      longitude;

    points.push(
      L.latLng(
        coordinates.latitude,
        longitude
      )
    );
  }

  return points;
}

function getCurvePosition(
  points,
  progress
) {
  if (
    !Array.isArray(points) ||
    points.length === 0
  ) {
    return null;
  }

  if (progress <= 0) {
    return points[0];
  }

  if (progress >= 1) {
    return points[
      points.length - 1
    ];
  }

  const scaled =
    progress *
    (
      points.length - 1
    );

  const lowerIndex =
    Math.floor(scaled);

  const upperIndex =
    Math.min(
      points.length - 1,
      lowerIndex + 1
    );

  const fraction =
    scaled -
    lowerIndex;

  const lower =
    points[lowerIndex];

  const upper =
    points[upperIndex];

  return L.latLng(
    lower.lat +
    (
      upper.lat -
      lower.lat
    ) *
    fraction,

    lower.lng +
    (
      upper.lng -
      lower.lng
    ) *
    fraction
  );
}

function easeOutCubic(progress) {
  return (
    1 -
    Math.pow(
      1 - progress,
      3
    )
  );
}

function calculateAnimationDuration(
  start,
  end
) {
  const distance =
    map.distance(
      start,
      end
    );

  const normalized =
    Math.min(
      1,
      distance /
      12_000_000
    );

  return Math.round(
    PACKET_ANIMATION_MIN_MS +
    (
      PACKET_ANIMATION_MAX_MS -
      PACKET_ANIMATION_MIN_MS
    ) *
    normalized
  );
}

function removeAnimation(animation) {
  if (
    !animation ||
    animation.removed
  ) {
    return;
  }

  animation.removed = true;

  if (animation.frameId) {
    cancelAnimationFrame(
      animation.frameId
    );
  }

  if (animation.fadeTimer) {
    clearTimeout(
      animation.fadeTimer
    );
  }

  if (
    animation.dot &&
    map.hasLayer(
      animation.dot
    )
  ) {
    map.removeLayer(
      animation.dot
    );
  }

  if (
    animation.line &&
    map.hasLayer(
      animation.line
    )
  ) {
    map.removeLayer(
      animation.line
    );
  }

  activeAnimations.delete(
    animation
  );

  processPacketQueue();
}

function startPacketAnimation(event) {
  if (!currentServerCoordinates) {
    return false;
  }

  const ip =
    normalizeIp(event.ip);

  const coordinates =
    clientCoordinates.get(ip);

  if (!coordinates) {
    return false;
  }

  const clientLatLng =
    L.latLng(
      coordinates.latitude,
      coordinates.longitude
    );

  const serverLatLng =
    L.latLng(
      currentServerCoordinates[0],
      currentServerCoordinates[1]
    );

  const canonicalCurve =
    createGeodesicCurve(
      clientLatLng,
      serverLatLng
    );

  const direction =
    event.direction === 'out'
      ? 'out'
      : 'in';

  const curvePoints =
    direction === 'in'
      ? canonicalCurve
      : [...canonicalCurve].reverse();

  const start =
    curvePoints[0];

  const end =
    curvePoints[
      curvePoints.length - 1
    ];

  const lineColor =
    direction === 'in'
      ? '#45d483'
      : '#ffad4d';

  const line =
    L.polyline(
      curvePoints,
      {
        color:
          event.isViewer
            ? '#58aaff'
            : lineColor,

        weight:
          event.isViewer
            ? 1.7
            : 1.2,

        opacity:
          event.isViewer
            ? 0.62
            : 0.42,

        interactive: false,
        smoothFactor: 1,
        lineCap: 'round',
        lineJoin: 'round'
      }
    ).addTo(map);

  const dot =
    L.circleMarker(
      curvePoints[0],
      {
        radius:
          event.isViewer
            ? Math.max(
                4,
                packetDotRadius(
                  event.bytes
                )
              )
            : packetDotRadius(
                event.bytes
              ),

        color:
          event.isViewer
            ? '#58aaff'
            : lineColor,

        weight:
          event.isViewer
            ? 2
            : 1,

        opacity: 1,

        fillColor:
          event.isViewer
            ? '#58aaff'
            : lineColor,

        fillOpacity: 0.96,
        interactive: false
      }
    ).addTo(map);

  const animation = {
    line,
    dot,
    frameId: null,
    fadeTimer: null,
    removed: false
  };

  activeAnimations.add(
    animation
  );

  const duration =
    calculateAnimationDuration(
      start,
      end
    );

  const startedAt =
    performance.now();

  function frame(timestamp) {
    if (animation.removed) {
      return;
    }

    const rawProgress =
      Math.min(
        1,
        (
          timestamp -
          startedAt
        ) /
        duration
      );

    const progress =
      easeOutCubic(
        rawProgress
      );

    const position =
      getCurvePosition(
        curvePoints,
        progress
      );

    if (position) {
      dot.setLatLng(position);
    }

    if (rawProgress > 0.72) {
      const fadeProgress =
        (
          rawProgress -
          0.72
        ) /
        0.28;

      line.setStyle({
        opacity:
          Math.max(
            0,
            (
              event.isViewer
                ? 0.62
                : 0.42
            ) *
            (
              1 -
              fadeProgress
            )
          )
      });
    }

    if (rawProgress < 1) {
      animation.frameId =
        requestAnimationFrame(
          frame
        );

      return;
    }

    animation.fadeTimer =
      setTimeout(
        () => {
          removeAnimation(
            animation
          );
        },
        PACKET_LINE_FADE_MS
      );
  }

  animation.frameId =
    requestAnimationFrame(
      frame
    );

  return true;
}

function deferPacket(event) {
  const ip =
    normalizeIp(event.ip);

  if (!ip) {
    return;
  }

  const existing =
    deferredPackets.get(ip) ||
    [];

  existing.push({
    ...event,
    deferredAt:
      Date.now()
  });

  while (
    existing.length >
    MAX_DEFERRED_PACKETS_PER_IP
  ) {
    existing.shift();
  }

  deferredPackets.set(
    ip,
    existing
  );
}

function flushDeferredPackets(ip) {
  const normalizedIp =
    normalizeIp(ip);

  const events =
    deferredPackets.get(
      normalizedIp
    );

  if (!events?.length) {
    return;
  }

  deferredPackets.delete(
    normalizedIp
  );

  const now =
    Date.now();

  for (const event of events) {
    if (
      now -
      event.deferredAt >
      DEFERRED_PACKET_MAX_AGE_MS
    ) {
      continue;
    }

    enqueuePacket(event);
  }
}

function enqueuePacket(event) {
  if (
    validatePort(
      event.localPort
    ) !==
    monitoredPort
  ) {
    return;
  }

  const normalizedEvent = {
    type: 'packet',

    sequence:
      Number(
        event.sequence
      ) || 0,

    timestamp:
      Number(
        event.timestamp
      ) ||
      Date.now(),

    ip:
      normalizeIp(
        event.ip
      ),

    direction:
      event.direction === 'out'
        ? 'out'
        : 'in',

    bytes:
      Math.max(
        0,
        Number(
          event.bytes
        ) || 0
      ),

    localPort:
      validatePort(
        event.localPort
      ),

    protocol:
      String(
        event.protocol ||
        'tcp'
      ).toLowerCase(),

    isViewer:
      event.isViewer === true
  };

  if (
    !normalizedEvent.ip ||
    normalizedEvent.bytes <= 0
  ) {
    return;
  }

  if (
    !clientCoordinates.has(
      normalizedEvent.ip
    )
  ) {
    deferPacket(
      normalizedEvent
    );

    return;
  }

  packetQueue.push(
    normalizedEvent
  );

  while (
    packetQueue.length >
    MAX_PACKET_QUEUE_SIZE
  ) {
    packetQueue.shift();
  }

  processPacketQueue();
}

function processPacketQueue() {
  while (
    packetQueue.length > 0 &&
    activeAnimations.size <
      MAX_CONCURRENT_ANIMATIONS
  ) {
    const event =
      packetQueue.shift();

    const started =
      startPacketAnimation(
        event
      );

    if (!started) {
      deferPacket(event);
    }
  }
}

function clearDisplayedTraffic() {
  pendingSnapshot = null;

  packetQueue.length = 0;
  deferredPackets.clear();

  for (
    const animation
    of [...activeAnimations]
  ) {
    removeAnimation(animation);
  }

  for (
    const entry
    of groupMarkers.values()
  ) {
    map.removeLayer(
      entry.marker
    );
  }

  groupMarkers.clear();
  clientCoordinates.clear();

  ui.activeClients.textContent =
    '0';

  ui.mappedClients.textContent =
    '0';

  ui.recentIn.textContent =
    '0 B';

  ui.recentOut.textContent =
    '0 B';

  ui.total.textContent =
    '0 B';

  ui.empty.hidden =
    false;
}

function updateDashboard(snapshot) {
  const totals =
    snapshot.totals || {};

  ui.serverName.textContent =
    snapshot.server?.name ||
    'Server';

  ui.port.textContent =
    String(
      snapshot.config
        ?.monitoredPort ??
      monitoredPort
    );

  ui.activeClients.textContent =
    Number(
      totals.activeClients
    ) || 0;

  ui.mappedClients.textContent =
    Number(
      totals.mappedClients
    ) || 0;

  ui.recentIn.textContent =
    formatBytes(
      totals.recentBytesIn
    );

  ui.recentOut.textContent =
    formatBytes(
      totals.recentBytesOut
    );

  ui.total.textContent =
    formatBytes(
      Number(
        totals.bytesIn || 0
      ) +
      Number(
        totals.bytesOut || 0
      )
    );

  ui.empty.hidden =
    snapshot.clients.length > 0;
}

function updateServerMarker(snapshot) {
  const latitude =
    Number(
      snapshot.server
        ?.latitude
    ) || 0;

  const longitude =
    Number(
      snapshot.server
        ?.longitude
    ) || 0;

  currentServerCoordinates = [
    latitude,
    longitude
  ];

  const popupContent = `
    <b>
      ${escapeHtml(
        snapshot.server?.name ||
        'Server'
      )}
    </b>
    <br>
    ${escapeHtml(
      snapshot.server?.city ||
      ''
    )}
    ${escapeHtml(
      snapshot.server?.country ||
      ''
    )}
  `;

  if (!serverMarker) {
    serverMarker =
      L.marker(
        currentServerCoordinates,
        {
          icon:
            serverDivIcon(
              'server-marker',
              14
            ),

          zIndexOffset: 1000,
          keyboard: false
        }
      )
        .bindPopup(
          popupContent
        )
        .addTo(map);

    map.setView(
      currentServerCoordinates,
      3,
      {
        animate: false
      }
    );

    return;
  }

  if (
    coordinatesChanged(
      serverMarker,
      latitude,
      longitude
    )
  ) {
    serverMarker.setLatLng(
      currentServerCoordinates
    );
  }

  serverMarker.setPopupContent(
    popupContent
  );
}

function updateGroupMarker(
  group,
  referenceBytes
) {
  const count =
    group.clients.length;

  const recentBytes =
    group.recentBytesIn +
    group.recentBytesOut;

  const radius =
    markerRadius(
      recentBytes,
      referenceBytes
    );

  const normalSize =
    Math.max(
      7,
      Math.round(
        radius * 4
      ) / 2
    );

  /*
   * Un gruppo deve contenere il numero
   * in modo leggibile.
   */
  const groupedSize =
    count > 1
      ? Math.min(
          34,
          Math.max(
            20,
            18 +
            String(count).length *
            3
          )
        )
      : normalSize;

  const size =
    group.hasViewer
      ? Math.max(
          15,
          groupedSize
        )
      : groupedSize;

  const pulse =
    (
      group.pulseBytesIn +
      group.pulseBytesOut
    ) > 0;

  const classes = [
    'client-marker',

    count > 1
      ? 'group-marker'
      : '',

    group.hasViewer
      ? 'viewer-marker'
      : '',

    pulse
      ? 'pulse'
      : ''
  ]
    .filter(Boolean)
    .join(' ');

  const visualKey = [
    classes,
    size,
    count,
    group.hasViewer
      ? 'viewer'
      : 'normal'
  ].join('|');

  let entry =
    groupMarkers.get(
      group.key
    );

  const icon =
    groupDivIcon({
      classes,
      size,
      count,
      hasViewer:
        group.hasViewer
    });

  if (!entry) {
    const marker =
      L.marker(
        [
          group.latitude,
          group.longitude
        ],
        {
          icon,
          keyboard: false,
          riseOnHover: true,

          zIndexOffset:
            group.hasViewer
              ? 700
              : (
                  count > 1
                    ? 300
                    : 0
                )
        }
      ).addTo(map);

    marker.bindPopup(
      groupPopupHtml(group),
      {
        maxWidth: 420,
        minWidth: 260
      }
    );

    entry = {
      marker,
      visualKey,
      hasViewer:
        group.hasViewer,
      count
    };

    groupMarkers.set(
      group.key,
      entry
    );

    for (
      const client
      of group.clients
    ) {
      flushDeferredPackets(
        client.ip
      );
    }

    return;
  }

  if (
    coordinatesChanged(
      entry.marker,
      group.latitude,
      group.longitude
    )
  ) {
    entry.marker.setLatLng([
      group.latitude,
      group.longitude
    ]);
  }

  if (
    entry.visualKey !==
    visualKey
  ) {
    entry.marker.setIcon(
      icon
    );

    entry.visualKey =
      visualKey;
  }

  if (
    entry.hasViewer !==
      group.hasViewer ||
    entry.count !== count
  ) {
    entry.marker.setZIndexOffset(
      group.hasViewer
        ? 700
        : (
            count > 1
              ? 300
              : 0
          )
    );

    entry.hasViewer =
      group.hasViewer;

    entry.count =
      count;
  }

  entry.marker.setPopupContent(
    groupPopupHtml(group)
  );

  for (
    const client
    of group.clients
  ) {
    flushDeferredPackets(
      client.ip
    );
  }
}

function applySnapshot(snapshot) {
  const snapshotPort =
    validatePort(
      snapshot.config
        ?.monitoredPort
    );

  if (
    snapshotPort !==
    monitoredPort
  ) {
    return;
  }

  if (!tileLayer) {
    tileLayer =
      L.tileLayer(
        snapshot.config
          .map.tileUrl,
        {
          attribution:
            snapshot.config
              .map
              .tileAttribution,

          maxZoom: 19,
          updateWhenIdle: true,
          keepBuffer: 2
        }
      ).addTo(map);
  }

  updateDashboard(snapshot);
  updateServerMarker(snapshot);

  /*
   * Eliminiamo le coordinate di IP che
   * non appartengono più allo snapshot.
   */
  const currentIps =
    new Set(
      snapshot.clients.map(
        (client) =>
          normalizeIp(client.ip)
      )
    );

  for (
    const ip
    of clientCoordinates.keys()
  ) {
    if (!currentIps.has(ip)) {
      clientCoordinates.delete(ip);
      deferredPackets.delete(ip);
    }
  }

  const groups =
    groupClientsByCoordinates(
      snapshot.clients
    );

  const trafficValues =
    [...groups.values()]
      .map(
        (group) =>
          group.recentBytesIn +
          group.recentBytesOut
      )
      .filter(
        (value) =>
          value > 0
      );

  const referenceBytes =
    percentile(
      trafficValues,
      0.95
    ) || 1;

  const presentGroups =
    new Set();

  for (
    const group
    of groups.values()
  ) {
    presentGroups.add(
      group.key
    );

    updateGroupMarker(
      group,
      referenceBytes
    );
  }

  for (
    const [key, entry]
    of groupMarkers
  ) {
    if (
      presentGroups.has(key)
    ) {
      continue;
    }

    map.removeLayer(
      entry.marker
    );

    groupMarkers.delete(key);
  }

  processPacketQueue();
}

function scheduleSnapshot(snapshot) {
  pendingSnapshot =
    snapshot;

  if (renderScheduled) {
    return;
  }

  renderScheduled = true;

  requestAnimationFrame(
    () => {
      renderScheduled = false;

      const current =
        pendingSnapshot;

      pendingSnapshot = null;

      if (current) {
        applySnapshot(current);
      }
    }
  );
}

function setConnectionState(
  connected
) {
  ui.connection
    .classList
    .toggle(
      'online',
      connected
    );

  ui.connection
    .classList
    .toggle(
      'offline',
      !connected
    );

  const label =
    ui.connection
      .querySelector(
        'span:last-child'
      );

  if (label) {
    label.textContent =
      connected
        ? 'connesso'
        : 'disconnesso';
  }
}

function sendJson(payload) {
  if (
    !socket ||
    socket.readyState !==
      WebSocket.OPEN
  ) {
    return;
  }

  socket.send(
    JSON.stringify(payload)
  );
}

function sendActivityWindow() {
  sendJson({
    type:
      'set_activity_window',

    seconds:
      activityWindowSeconds
  });
}

function sendMonitoredPort() {
  sendJson({
    type:
      'set_monitored_port',

    port:
      monitoredPort,

    protocol:
      'tcp'
  });
}

function applyPortSelection(port) {
  const validated =
    validatePort(port);

  if (
    validated ===
    monitoredPort
  ) {
    updatePortControls();
    return;
  }

  monitoredPort =
    validated;

  writeCookie(
    PORT_COOKIE,
    String(monitoredPort)
  );

  updatePortControls();
  clearDisplayedTraffic();

  ui.port.textContent =
    String(monitoredPort);

  sendMonitoredPort();
}

function handleSocketMessage(rawData) {
  const message =
    JSON.parse(rawData);

  if (
    message?.type ===
    'viewer'
  ) {
    return;
  }

  if (
    message?.type ===
    'activity_window'
  ) {
    activityWindowSeconds =
      validateActivityWindow(
        message.seconds
      );

    ui.activityWindow.value =
      String(
        activityWindowSeconds
      );

    writeCookie(
      ACTIVITY_COOKIE,
      String(
        activityWindowSeconds
      )
    );

    return;
  }

  if (
    message?.type ===
    'monitored_port'
  ) {
    const confirmedPort =
      validatePort(
        message.port
      );

    monitoredPort =
      confirmedPort;

    writeCookie(
      PORT_COOKIE,
      String(confirmedPort)
    );

    updatePortControls();

    ui.port.textContent =
      String(confirmedPort);

    return;
  }

  if (
    message?.type ===
    'packet'
  ) {
    enqueuePacket(message);
    return;
  }

  if (
    !message ||
    !Array.isArray(
      message.clients
    ) ||
    !message.server ||
    !message.config
  ) {
    console.warn(
      'Messaggio WebSocket non riconosciuto:',
      message
    );

    return;
  }

  scheduleSnapshot(message);
}

function connect() {
  if (
    socket &&
    (
      socket.readyState ===
        WebSocket.OPEN ||
      socket.readyState ===
        WebSocket.CONNECTING
    )
  ) {
    return;
  }

  socket =
    new WebSocket(
      'wss://spadacenta.com:3100/ws'
    );

  socket.addEventListener(
    'open',
    () => {
      setConnectionState(true);

      sendActivityWindow();
      sendMonitoredPort();
    }
  );

  socket.addEventListener(
    'message',
    (event) => {
      try {
        handleSocketMessage(
          event.data
        );
      } catch (error) {
        console.error(
          'Messaggio WebSocket non valido:',
          error
        );
      }
    }
  );

  socket.addEventListener(
    'close',
    () => {
      setConnectionState(false);

      socket = null;

      if (reconnectTimer) {
        clearTimeout(
          reconnectTimer
        );
      }

      reconnectTimer =
        setTimeout(
          () => {
            reconnectTimer = null;
            connect();
          },
          2000
        );
    }
  );

  socket.addEventListener(
    'error',
    () => {
      socket.close();
    }
  );
}

ui.activityWindow
  .addEventListener(
    'change',
    () => {
      activityWindowSeconds =
        validateActivityWindow(
          ui.activityWindow.value
        );

      ui.activityWindow.value =
        String(
          activityWindowSeconds
        );

      writeCookie(
        ACTIVITY_COOKIE,
        String(
          activityWindowSeconds
        )
      );

      sendActivityWindow();
    }
  );

ui.monitoredPort
  .addEventListener(
    'change',
    () => {
      if (
        ui.monitoredPort.value ===
        'custom'
      ) {
        ui.customPortContainer.hidden =
          false;

        ui.customPort.focus();

        return;
      }

      ui.customPortContainer.hidden =
        true;

      applyPortSelection(
        ui.monitoredPort.value
      );
    }
  );

function applyCustomPort() {
  const raw =
    Number(
      ui.customPort.value
    );

  if (
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > 65535
  ) {
    ui.customPort
      .setCustomValidity(
        'Inserisci una porta compresa tra 1 e 65535.'
      );

    ui.customPort
      .reportValidity();

    return;
  }

  ui.customPort
    .setCustomValidity('');

  applyPortSelection(raw);
}

ui.customPort
  .addEventListener(
    'change',
    applyCustomPort
  );

ui.customPort
  .addEventListener(
    'keydown',
    (event) => {
      if (
        event.key !==
        'Enter'
      ) {
        return;
      }

      event.preventDefault();

      applyCustomPort();
    }
  );

connect();