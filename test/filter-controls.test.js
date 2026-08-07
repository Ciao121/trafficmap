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
import { reconcileFilterCards } from '../filter-panel.js';
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
  const rule = css.match(/\.active-filters\s*\{([^}]+)\}/)?.[1] || '';

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

test('repeated statistics updates preserve every removal button', () => {
  const document = new FakeDocument();
  const container = new FakeElement(document, 'section');
  const cards = new Map();
  const removed = [];
  const filters = [
    { port: 443, protocol: 'tcp', bytesIn: 0, bytesOut: 0 },
    { port: 53, protocol: 'udp', bytesIn: 0, bytesOut: 0 },
    { port: 8080, protocol: 'both', bytesIn: 0, bytesOut: 0 }
  ];
  const render = () => reconcileFilterCards({
    container,
    cards,
    filters,
    formatBytes: (bytes) => `${bytes} B`,
    onRemove: (port) => removed.push(port)
  });

  render();
  const originalElements = filters.map(
    (filter) => cards.get(filter.port).element
  );
  const originalButtons = filters.map(
    (filter) => cards.get(filter.port).removeButton
  );

  for (let update = 1; update <= 20; update += 1) {
    filters.forEach((filter) => {
      filter.bytesIn = update;
      filter.bytesOut = update * 2;
    });
    render();
  }

  assert.deepEqual(
    filters.map((filter) => cards.get(filter.port).element),
    originalElements
  );
  assert.deepEqual(
    filters.map((filter) => cards.get(filter.port).removeButton),
    originalButtons
  );

  originalButtons.forEach((button) => button.click());
  assert.deepEqual(removed, [443, 53, 8080]);
});

test('removing one persistent card preserves the remaining cards and order', () => {
  const document = new FakeDocument();
  const container = new FakeElement(document, 'section');
  const cards = new Map();
  const base = {
    container,
    cards,
    formatBytes: String,
    onRemove: () => {}
  };

  reconcileFilterCards({
    ...base,
    filters: [
      { port: 443, protocol: 'tcp' },
      { port: 53, protocol: 'udp' },
      { port: 8080, protocol: 'both' }
    ]
  });
  const first = cards.get(443).element;
  const last = cards.get(8080).element;

  reconcileFilterCards({
    ...base,
    filters: [
      { port: 443, protocol: 'tcp' },
      { port: 8080, protocol: 'both' }
    ]
  });

  assert.equal(cards.has(53), false);
  assert.deepEqual(container.children, [first, last]);
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
