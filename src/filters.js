const FILTER_PROTOCOLS = new Set(['tcp', 'udp']);

export function filterKey(port, protocol) {
  return `${Number(port)}:${String(protocol).toLowerCase()}`;
}

export function validateFilters(value) {
  if (!Array.isArray(value)) return { valid: false, error: 'filters must be an array', filters: [] };
  const keys = new Set();
  const filters = [];
  for (const item of value) {
    const port = Number(item?.port);
    const protocol = String(item?.protocol || '').toLowerCase();
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { valid: false, error: 'filter port must be an integer between 1 and 65535', filters: [] };
    if (!FILTER_PROTOCOLS.has(protocol)) return { valid: false, error: 'filter protocol must be tcp or udp', filters: [] };
    const key = filterKey(port, protocol);
    if (keys.has(key)) return { valid: false, error: 'filter port and protocol pairs must be unique', filters: [] };
    keys.add(key);
    filters.push({ port, protocol });
  }
  return { valid: true, error: '', filters };
}

export function matchesFilters(filters, packet) {
  return !filters.length || filters.some((filter) => filter.port === packet.localPort && filter.protocol === packet.protocol);
}

export function applyFilterSet(state, filters) {
  const previous = state.filterCounters || new Map();
  const counters = new Map();
  for (const filter of filters) {
    const key = filterKey(filter.port, filter.protocol);
    const old = previous.get(key);
    counters.set(key, old || { bytesIn: 0, bytesOut: 0 });
  }
  state.filters = filters;
  state.filterCounters = counters;
}

export function countFilteredPacket(state, packet) {
  if (!state.filters.length) return;
  const filter = state.filters.find((item) => item.port === packet.localPort && item.protocol === packet.protocol);
  if (!filter) return;
  const counter = state.filterCounters.get(filterKey(filter.port, filter.protocol));
  if (packet.direction === 'out') counter.bytesOut += packet.bytes;
  else counter.bytesIn += packet.bytes;
}

export function serializeFilters(state) {
  return state.filters.map((filter) => {
    const counter = state.filterCounters.get(filterKey(filter.port, filter.protocol));
    return { ...filter, bytesIn: counter?.bytesIn || 0, bytesOut: counter?.bytesOut || 0 };
  });
}
