export function removeFilterByPort(filters, port) {
  const selectedPort = Number(port);

  return filters.filter(
    (filter) => filter.port !== selectedPort
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
      (
        filter.protocol === 'both' ||
        filter.protocol === packet.protocol
      )
  );
}
