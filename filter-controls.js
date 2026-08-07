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
