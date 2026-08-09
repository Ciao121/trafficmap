function createFilterRow(document, port, onRemove) {
  const element = document.createElement('div');
  element.className = 'filter-stats-row';
  element.dataset.port = String(port);

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

export class FilterPanel {
  constructor({
    document,
    host,
    formatBytes,
    onRemove
  }) {
    this.document = document;
    this.host = host;
    this.formatBytes = formatBytes;
    this.onRemove = onRemove;
    this.panel = null;
    this.rows = new Map();
  }

  ensurePanel() {
    if (this.panel) return this.panel;

    const panel = this.document.createElement('section');
    panel.id = 'active-filters';
    panel.className = 'filter-stats-panel';
    this.host.append(panel);
    this.panel = panel;
    return panel;
  }

  upsertRow(filter) {
    const panel = this.ensurePanel();
    let row = this.rows.get(filter.port);

    if (!row) {
      row = createFilterRow(
        this.document,
        filter.port,
        this.onRemove
      );
      this.rows.set(filter.port, row);
      panel.append(row.element);
    }

    row.protocol.textContent = filter.protocol === 'both'
      ? 'TCP+UDP'
      : filter.protocol.toUpperCase();
    this.updateCounters(
      filter.port,
      filter.bytesIn,
      filter.bytesOut
    );
    return row;
  }

  updateCounters(port, bytesIn, bytesOut) {
    const row = this.rows.get(Number(port));
    if (!row) return false;
    row.bytesIn.textContent = `IN ${this.formatBytes(bytesIn || 0)}`;
    row.bytesOut.textContent = `OUT ${this.formatBytes(bytesOut || 0)}`;
    return true;
  }

  removeRow(port) {
    const selectedPort = Number(port);
    const row = this.rows.get(selectedPort);
    if (!row) return false;
    row.element.remove();
    this.rows.delete(selectedPort);
    if (this.rows.size === 0) this.clear();
    return true;
  }

  render(filters) {
    if (!filters.length) {
      this.clear();
      return;
    }

    const panel = this.ensurePanel();
    const activePorts = new Set(
      filters.map((filter) => filter.port)
    );

    for (const port of [...this.rows.keys()]) {
      if (!activePorts.has(port)) this.removeRow(port);
    }

    filters.forEach((filter, index) => {
      const row = this.upsertRow(filter);
      if (panel.children[index] !== row.element) {
        panel.insertBefore(
          row.element,
          panel.children[index] || null
        );
      }
    });
  }

  clear() {
    for (const row of this.rows.values()) {
      row.element.remove();
    }
    this.rows.clear();
    this.panel?.remove();
    this.panel = null;
  }
}
