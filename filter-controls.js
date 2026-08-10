export function filterKey(port, protocol) {
  return `${Number(port)}:${String(protocol).toLowerCase()}`;
}

export function removeFilter(filters, port, protocol) {
  const selectedPort = Number(port);
  const selectedProtocol = String(protocol).toLowerCase();

  return filters.filter(
    (filter) =>
      filter.port !== selectedPort ||
      filter.protocol !== selectedProtocol
  );
}

export function buildSetFiltersMessage(filters) {
  return {
    type: 'set_filters',
    filters: filters.map(({ port, protocol }) => ({ port, protocol }))
  };
}

export function filterSelectionSignature(filters) {
  return JSON.stringify(
    filters.map(({ port, protocol }) => ({ port, protocol }))
  );
}

export function shouldApplyServerFilters(
  pendingSignature,
  filters,
  acknowledgement = false
) {
  if (!pendingSignature) return true;

  return acknowledgement &&
    filterSelectionSignature(filters) === pendingSignature;
}

export function matchesSelectedFilters(filters, packet) {
  return !filters.length || filters.some(
    (filter) =>
      filter.port === Number(packet.localPort) &&
      filter.protocol === packet.protocol
  );
}

export function sumFilterTotals(filters) {
  return filters.reduce(
    (totals, filter) => {
      totals.bytesIn += Math.max(
        0,
        Number(filter.bytesIn) || 0
      );
      totals.bytesOut += Math.max(
        0,
        Number(filter.bytesOut) || 0
      );
      totals.bytesTotal =
        totals.bytesIn + totals.bytesOut;
      return totals;
    },
    {
      bytesIn: 0,
      bytesOut: 0,
      bytesTotal: 0
    }
  );
}

export function createAllTrafficTotal() {
  return {
    bytesIn: 0,
    bytesOut: 0,
    bytesTotal: 0,
    lastSequence: 0
  };
}

export function countAllTrafficPacket(total, packet) {
  const sequence = Number(packet?.sequence) || 0;

  if (sequence > 0 && sequence <= total.lastSequence) {
    return total;
  }

  const bytes = Math.max(0, Number(packet?.bytes) || 0);
  const next = {
    ...total,
    lastSequence: sequence > 0 ? sequence : total.lastSequence
  };

  if (packet?.direction === 'out') next.bytesOut += bytes;
  else next.bytesIn += bytes;
  next.bytesTotal = next.bytesIn + next.bytesOut;
  return next;
}

export function selectTrafficTotal(filters, allTrafficTotal) {
  return filters.length
    ? sumFilterTotals(filters)
    : {
        bytesIn: allTrafficTotal.bytesIn,
        bytesOut: allTrafficTotal.bytesOut,
        bytesTotal: allTrafficTotal.bytesTotal
      };
}

export function transitionAllTrafficTotal(
  previousFilters,
  nextFilters,
  allTrafficTotal
) {
  return previousFilters.length > 0 && nextFilters.length === 0
    ? createAllTrafficTotal()
    : allTrafficTotal;
}
