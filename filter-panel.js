import { filterKey } from './filter-controls.js';

function createFilterRow(document, port, protocol, onRemove) {
  const key = filterKey(port, protocol);
  const element = document.createElement('div');
  element.className = 'filter-stats-row';
  element.dataset.port = String(port);
  element.dataset.protocol = protocol;
  element.dataset.filterKey = key;

  const portValue = document.createElement('strong');
  portValue.textContent = String(port);

  const protocolValue = document.createElement('span');
  const bytesIn = document.createElement('span');
  const bytesOut = document.createElement('span');

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.dataset.removeFilter = key;
  removeButton.setAttribute(
    'aria-label',
    `Remove ${port}/${protocol.toUpperCase()} filter`
  );
  removeButton.textContent = '×';
  removeButton.addEventListener(
    'click',
    () => onRemove(port, protocol)
  );

  element.append(
    portValue,
    protocolValue,
    bytesIn,
    bytesOut,
    removeButton
  );

  return {
    element,
    protocol: protocolValue,
    bytesIn,
    bytesOut,
    removeButton
  };
}

export class FilterPanel {
  constructor({ document, host, formatBytes, onRemove }) {
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
    const key = filterKey(filter.port, filter.protocol);
    let row = this.rows.get(key);

    if (!row) {
      row = createFilterRow(
        this.document,
        filter.port,
        filter.protocol,
        this.onRemove
      );
      this.rows.set(key, row);
      panel.append(row.element);
    }

    row.protocol.textContent = filter.protocol.toUpperCase();
    this.updateCounters(
      filter.port,
      filter.protocol,
      filter.bytesIn,
      filter.bytesOut
    );
    return row;
  }

  updateCounters(port, protocol, bytesIn, bytesOut) {
    const row = this.rows.get(filterKey(port, protocol));
    if (!row) return false;
    row.bytesIn.textContent = `IN ${this.formatBytes(bytesIn || 0)}`;
    row.bytesOut.textContent = `OUT ${this.formatBytes(bytesOut || 0)}`;
    return true;
  }

  removeRow(port, protocol) {
    const key = filterKey(port, protocol);
    const row = this.rows.get(key);
    if (!row) return false;
    row.element.remove();
    this.rows.delete(key);
    if (this.rows.size === 0) this.clear();
    return true;
  }

  render(filters) {
    if (!filters.length) {
      this.clear();
      return;
    }

    const panel = this.ensurePanel();
    const activeKeys = new Set(
      filters.map((filter) => filterKey(filter.port, filter.protocol))
    );

    for (const key of [...this.rows.keys()]) {
      if (!activeKeys.has(key)) {
        const [port, protocol] = key.split(':');
        this.removeRow(port, protocol);
      }
    }

    filters.forEach((filter, index) => {
      const row = this.upsertRow(filter);
      if (panel.children[index] !== row.element) {
        panel.insertBefore(row.element, panel.children[index] || null);
      }
    });
  }

  clear() {
    for (const row of this.rows.values()) row.element.remove();
    this.rows.clear();
    this.panel?.remove();
    this.panel = null;
  }
}
