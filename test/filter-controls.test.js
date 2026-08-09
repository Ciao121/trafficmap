import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildSetFiltersMessage,
  filterSelectionSignature,
  matchesSelectedFilters,
  removeFilterByPort,
  shouldApplyServerFilters
} from '../filter-controls.js';
import { FilterPanel } from '../filter-panel.js';
import {
  applyFilterSet,
  countFilteredPacket,
  matchesFilters,
  serializeFilters,
  validateFilters
} from '../src/filters.js';

test('removing a filter updates UI state and excludes it from the next payload', () => {
  const filters = [
    { port: 443, protocol: 'tcp', bytesIn: 10, bytesOut: 20 },
    { port: 53, protocol: 'udp', bytesIn: 30, bytesOut: 40 }
  ];

  const remaining = removeFilterByPort(filters, 443);

  assert.deepEqual(remaining, [filters[1]]);
  assert.deepEqual(buildSetFiltersMessage(remaining), {
    type: 'set_filters',
    filters: [{ port: 53, protocol: 'udp' }]
  });
});

test('the agent stops removed-only traffic and retains the remaining filter', () => {
  const state = { filters: [], filterCounters: new Map() };
  applyFilterSet(state, [
    { port: 443, protocol: 'tcp' },
    { port: 53, protocol: 'udp' }
  ]);
  countFilteredPacket(state, {
    localPort: 443,
    protocol: 'tcp',
    direction: 'in',
    bytes: 10
  });

  const payload = buildSetFiltersMessage(
    removeFilterByPort(serializeFilters(state), 443)
  );
  const result = validateFilters(payload.filters);
  applyFilterSet(state, result.filters);

  assert.equal(matchesFilters(state.filters, {
    localPort: 443,
    protocol: 'tcp'
  }), false);
  assert.equal(matchesFilters(state.filters, {
    localPort: 53,
    protocol: 'udp'
  }), true);
  assert.equal(state.filterCounters.has(443), false);
  assert.deepEqual(serializeFilters(state), [
    { port: 53, protocol: 'udp', bytesIn: 0, bytesOut: 0 }
  ]);
});

test('removing the final filter sends an empty set and restores all traffic', () => {
  const state = { filters: [], filterCounters: new Map() };
  applyFilterSet(state, [{ port: 443, protocol: 'tcp' }]);

  const payload = buildSetFiltersMessage(
    removeFilterByPort(serializeFilters(state), 443)
  );
  const result = validateFilters(payload.filters);
  applyFilterSet(state, result.filters);

  assert.deepEqual(payload, { type: 'set_filters', filters: [] });
  assert.equal(state.filterCounters.size, 0);
  assert.equal(matchesFilters(state.filters, {
    localPort: 22,
    protocol: 'tcp'
  }), true);
  assert.equal(matchesFilters(state.filters, {
    localPort: 53,
    protocol: 'udp'
  }), true);
});

test('filter statistics are anchored above the bottom-right attribution', () => {
  const css = fs.readFileSync(
    new URL('../styles.css', import.meta.url),
    'utf8'
  );
  const rule = css.match(/\.filter-stats-panel\s*\{([^}]+)\}/)?.[1] || '';

  assert.match(rule, /right:\s*14px/);
  assert.match(rule, /bottom:\s*32px/);
  assert.doesNotMatch(rule, /left:/);
});

test('in-flight snapshots cannot restore a pending filter selection', () => {
  const desired = [{ port: 53, protocol: 'udp' }];
  const stale = [
    { port: 443, protocol: 'tcp' },
    { port: 53, protocol: 'udp' }
  ];
  const pending = filterSelectionSignature(desired);

  assert.equal(
    shouldApplyServerFilters(pending, stale, false),
    false
  );
  assert.equal(
    shouldApplyServerFilters(pending, desired, true),
    true
  );
});

test('in-flight packets follow the optimistic remaining filter selection', () => {
  const filters = [
    { port: 53, protocol: 'udp' },
    { port: 8080, protocol: 'both' }
  ];

  assert.equal(matchesSelectedFilters(filters, {
    localPort: 443,
    protocol: 'tcp'
  }), false);
  assert.equal(matchesSelectedFilters(filters, {
    localPort: 53,
    protocol: 'udp'
  }), true);
  assert.equal(matchesSelectedFilters(filters, {
    localPort: 8080,
    protocol: 'tcp'
  }), true);
  assert.equal(matchesSelectedFilters([], {
    localPort: 22,
    protocol: 'tcp'
  }), true);
});

class FakeElement {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.parentElement = null;
    this.textContent = '';
  }

  append(...elements) {
    for (const element of elements) {
      this.insertBefore(element, null);
    }
  }

  insertBefore(element, reference) {
    element.remove();
    const index = reference
      ? this.children.indexOf(reference)
      : this.children.length;
    this.children.splice(index, 0, element);
    element.parentElement = this;
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index !== -1) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    this.listeners.get('click')?.();
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(this, tagName);
  }
}

function findByClass(root, className) {
  const matches = [];
  for (const child of root.children) {
    if (child.className === className) matches.push(child);
    matches.push(...findByClass(child, className));
  }
  return matches;
}

test('one panel owns every row through add, update, remove, and recreate', () => {
  const document = new FakeDocument();
  const host = new FakeElement(document, 'main');
  const panel = new FilterPanel({
    document,
    host,
    formatBytes: (bytes) => `${bytes} B`,
    onRemove: () => {}
  });
  const assertPanelState = (panelCount, rowCount) => {
    const panels = findByClass(host, 'filter-stats-panel');
    const rows = findByClass(host, 'filter-stats-row');
    assert.equal(panels.length, panelCount);
    assert.equal(panels.length <= 1, true);
    assert.equal(rows.length, rowCount);
    assert.equal(
      rows.every((row) => row.parentElement === panels[0]),
      true
    );
    assert.equal(
      rows.some((row) => row.parentElement === host),
      false
    );
  };

  assertPanelState(0, 0);

  panel.render([{ port: 80, protocol: 'tcp' }]);
  const firstPanel = panel.panel;
  assertPanelState(1, 1);

  panel.render([
    { port: 80, protocol: 'tcp' },
    { port: 443, protocol: 'tcp' }
  ]);
  assert.strictEqual(panel.panel, firstPanel);
  assertPanelState(1, 2);

  panel.render([
    { port: 80, protocol: 'tcp' },
    { port: 443, protocol: 'tcp' },
    { port: 3306, protocol: 'tcp' }
  ]);
  assert.strictEqual(panel.ensurePanel(), firstPanel);
  assertPanelState(1, 3);

  panel.updateCounters(80, 1024, 2048);
  panel.updateCounters(443, 4096, 8192);
  assertPanelState(1, 3);

  panel.render([
    { port: 80, protocol: 'tcp' },
    { port: 3306, protocol: 'tcp' }
  ]);
  assertPanelState(1, 2);

  panel.render([{ port: 3306, protocol: 'tcp' }]);
  assertPanelState(1, 1);

  panel.render([]);
  assert.equal(panel.panel, null);
  assertPanelState(0, 0);

  panel.render([{ port: 22, protocol: 'tcp' }]);
  assert.notStrictEqual(panel.panel, firstPanel);
  assertPanelState(1, 1);
});

test('repeated statistics updates preserve every removal button', () => {
  const document = new FakeDocument();
  const host = new FakeElement(document, 'main');
  const removed = [];
  const filters = [
    { port: 443, protocol: 'tcp', bytesIn: 0, bytesOut: 0 },
    { port: 53, protocol: 'udp', bytesIn: 0, bytesOut: 0 },
    { port: 8080, protocol: 'both', bytesIn: 0, bytesOut: 0 }
  ];
  const panel = new FilterPanel({
    document,
    host,
    formatBytes: (bytes) => `${bytes} B`,
    onRemove: (port) => removed.push(port)
  });
  const render = () => panel.render(filters);

  render();
  const originalElements = filters.map(
    (filter) => panel.rows.get(filter.port).element
  );
  const originalButtons = filters.map(
    (filter) => panel.rows.get(filter.port).removeButton
  );

  for (let update = 1; update <= 20; update += 1) {
    filters.forEach((filter) => {
      filter.bytesIn = update;
      filter.bytesOut = update * 2;
    });
    render();
  }

  assert.deepEqual(
    filters.map((filter) => panel.rows.get(filter.port).element),
    originalElements
  );
  assert.deepEqual(
    filters.map((filter) => panel.rows.get(filter.port).removeButton),
    originalButtons
  );
  assert.equal(panel.panel.children.length, 3);
  assert.equal(new Set(
    panel.panel.children.map((row) => row.parentElement)
  ).size, 1);
  assert.equal(
    panel.panel.children.every((row) => row.children.length === 5),
    true
  );
  assert.equal(
    panel.panel.children.every(
      (row) => row.className === 'filter-stats-row'
    ),
    true
  );

  originalButtons.forEach((button) => button.click());
  assert.deepEqual(removed, [443, 53, 8080]);
});

test('removing one persistent row preserves the remaining rows and order', () => {
  const document = new FakeDocument();
  const host = new FakeElement(document, 'main');
  const panel = new FilterPanel({
    document,
    host,
    formatBytes: String,
    onRemove: () => {}
  });

  panel.render([
    { port: 443, protocol: 'tcp' },
    { port: 53, protocol: 'udp' },
    { port: 8080, protocol: 'both' }
  ]);
  const first = panel.rows.get(443).element;
  const last = panel.rows.get(8080).element;

  panel.render([
    { port: 443, protocol: 'tcp' },
    { port: 8080, protocol: 'both' }
  ]);

  assert.equal(panel.rows.has(53), false);
  assert.deepEqual(panel.panel.children, [first, last]);

  panel.render([
    { port: 8080, protocol: 'both' },
    { port: 443, protocol: 'tcp' }
  ]);

  assert.deepEqual(panel.panel.children, [last, first]);
});

test('Leaflet disables the visual zoom control without disabling map zoom', () => {
  const source = fs.readFileSync(
    new URL('../app.js', import.meta.url),
    'utf8'
  );

  assert.match(source, /zoomControl:\s*false/);
  assert.doesNotMatch(source, /L\.control\.zoom\s*\(/);
  assert.doesNotMatch(source, /scrollWheelZoom:\s*false/);
  assert.doesNotMatch(source, /touchZoom:\s*false/);
});

test('filter rows share one panel and fixed grid columns', () => {
  const css = fs.readFileSync(
    new URL('../styles.css', import.meta.url),
    'utf8'
  );
  const panelRule = css.match(
    /\.filter-stats-panel\s*\{([^}]+)\}/
  )?.[1] || '';
  const rowRule = css.match(
    /\.filter-stats-row\s*\{([^}]+)\}/
  )?.[1] || '';

  assert.match(panelRule, /width:\s*420px/);
  assert.match(panelRule, /--filter-stats-columns:/);
  assert.match(panelRule, /background:/);
  assert.match(panelRule, /border:/);
  assert.match(panelRule, /border-radius:/);
  assert.match(
    rowRule,
    /grid-template-columns:\s*var\(--filter-stats-columns\)/
  );
  assert.match(rowRule, /width:\s*100%/);
  assert.match(rowRule, /position:\s*static/);
  assert.match(rowRule, /background:\s*none/);
  assert.match(rowRule, /border:\s*0/);
  assert.match(rowRule, /border-radius:\s*0/);
  assert.doesNotMatch(rowRule, /fit-content/);
  assert.match(css, /\.filter-stats-row \+ \.filter-stats-row\s*\{/);
});

test('markup delegates statistics panel ownership to the controller', () => {
  const markup = fs.readFileSync(
    new URL('../index.html', import.meta.url),
    'utf8'
  );
  const renderer = fs.readFileSync(
    new URL('../filter-panel.js', import.meta.url),
    'utf8'
  );

  assert.equal(
    (markup.match(/class="filter-stats-panel"/g) || []).length,
    0
  );
  assert.match(renderer, /className = 'filter-stats-row'/);
  assert.match(renderer, /className = 'filter-stats-panel'/);
  assert.match(renderer, /ensurePanel\(\)/);
});
