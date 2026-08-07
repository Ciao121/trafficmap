const FILTER_PROTOCOLS = new Set(['tcp', 'udp', 'both']);

export function validateFilters(value) {
  if (!Array.isArray(value)) return { valid: false, error: 'filters must be an array', filters: [] };
  const ports = new Set();
  const filters = [];
  for (const item of value) {
    const port = Number(item?.port);
    const protocol = String(item?.protocol || '').toLowerCase();
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { valid: false, error: 'filter port must be an integer between 1 and 65535', filters: [] };
    if (!FILTER_PROTOCOLS.has(protocol)) return { valid: false, error: 'filter protocol must be tcp, udp, or both', filters: [] };
    if (ports.has(port)) return { valid: false, error: 'filter ports must be unique', filters: [] };
    ports.add(port);
    filters.push({ port, protocol });
  }
  return { valid: true, error: '', filters };
}

export function matchesFilters(filters, packet) {
  return !filters.length || filters.some((filter) => filter.port === packet.localPort && (filter.protocol === 'both' || filter.protocol === packet.protocol));
}

export function applyFilterSet(state, filters) {
  const previous = state.filterCounters || new Map();
  const counters = new Map();
  for (const filter of filters) {
    const old = previous.get(filter.port);
    counters.set(filter.port, old?.protocol === filter.protocol ? old : { protocol: filter.protocol, bytesIn: 0, bytesOut: 0 });
  }
  state.filters = filters;
  state.filterCounters = counters;
}

export function countFilteredPacket(state, packet) {
  if (!state.filters.length) return;
  const filter = state.filters.find((item) => item.port === packet.localPort && (item.protocol === 'both' || item.protocol === packet.protocol));
  if (!filter) return;
  const counter = state.filterCounters.get(filter.port);
  if (packet.direction === 'out') counter.bytesOut += packet.bytes;
  else counter.bytesIn += packet.bytes;
}

export function serializeFilters(state) {
  return state.filters.map((filter) => {
    const counter = state.filterCounters.get(filter.port);
    return { ...filter, bytesIn: counter?.bytesIn || 0, bytesOut: counter?.bytesOut || 0 };
  });
}
