function createFilterCard(document, port, onRemove) {
  const element = document.createElement('div');
  element.className = 'filter-stats-row';

  const portValue = document.createElement('strong');
  portValue.textContent = String(port);

  const protocol = document.createElement('span');
  const bytesIn = document.createElement('span');
  const bytesOut = document.createElement('span');

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.dataset.removeFilter = String(port);
  removeButton.setAttribute('aria-label', `Remove filter ${port}`);
  removeButton.textContent = '×';
  removeButton.addEventListener('click', () => onRemove(port));

  element.append(
    portValue,
    protocol,
    bytesIn,
    bytesOut,
    removeButton
  );

  return {
    element,
    protocol,
    bytesIn,
    bytesOut,
    removeButton
  };
}

export function reconcileFilterCards({
  container,
  cards,
  filters,
  formatBytes,
  onRemove
}) {
  const activePorts = new Set(
    filters.map((filter) => filter.port)
  );

  for (const [port, card] of cards) {
    if (activePorts.has(port)) continue;
    card.element.remove();
    cards.delete(port);
  }

  filters.forEach((filter, index) => {
    let card = cards.get(filter.port);

    if (!card) {
      card = createFilterCard(
        container.ownerDocument,
        filter.port,
        onRemove
      );
      cards.set(filter.port, card);
    }

    card.protocol.textContent = filter.protocol === 'both'
      ? 'TCP+UDP'
      : filter.protocol.toUpperCase();
    card.bytesIn.textContent = `IN ${formatBytes(filter.bytesIn || 0)}`;
    card.bytesOut.textContent = `OUT ${formatBytes(filter.bytesOut || 0)}`;

    if (container.children[index] !== card.element) {
      container.insertBefore(
        card.element,
        container.children[index] || null
      );
    }
  });

  return cards;
}
