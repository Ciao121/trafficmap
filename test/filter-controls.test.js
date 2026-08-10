import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildSetFiltersMessage,
  countAllTrafficPacket,
  createAllTrafficTotal,
  filterKey,
  filterSelectionSignature,
  matchesSelectedFilters,
  removeFilter,
  selectTrafficTotal,
  shouldApplyServerFilters,
  sumFilterTotals,
  transitionAllTrafficTotal
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

  const remaining = removeFilter(filters, 443, 'tcp');

  assert.deepEqual(remaining, [filters[1]]);
  assert.deepEqual(buildSetFiltersMessage(remaining), {
    type: 'set_filters',
    filters: [{ port: 53, protocol: 'udp' }]
  });
});

test('WebSocket payload keeps TCP and UDP pairs on the same port', () => {
  assert.deepEqual(buildSetFiltersMessage([
    { port: 443, protocol: 'tcp', bytesIn: 1, bytesOut: 2 },
    { port: 443, protocol: 'udp', bytesIn: 3, bytesOut: 4 }
  ]), {
    type: 'set_filters',
    filters: [
      { port: 443, protocol: 'tcp' },
      { port: 443, protocol: 'udp' }
    ]
  });
});

test('removing one pair preserves the other protocol on the same port', () => {
  const filters = [
    { port: 443, protocol: 'tcp', bytesIn: 10, bytesOut: 20 },
    { port: 443, protocol: 'udp', bytesIn: 30, bytesOut: 40 }
  ];
  assert.deepEqual(removeFilter(filters, 443, 'tcp'), [filters[1]]);
  assert.deepEqual(removeFilter(filters, 443, 'udp'), [filters[0]]);
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
    removeFilter(serializeFilters(state), 443, 'tcp')
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
  assert.equal(state.filterCounters.has(filterKey(443, 'tcp')), false);
  assert.deepEqual(serializeFilters(state), [
    { port: 53, protocol: 'udp', bytesIn: 0, bytesOut: 0 }
  ]);
});

test('removing the final filter sends an empty set and restores all traffic', () => {
  const state = { filters: [], filterCounters: new Map() };
  applyFilterSet(state, [{ port: 443, protocol: 'tcp' }]);

  const payload = buildSetFiltersMessage(
    removeFilter(serializeFilters(state), 443, 'tcp')
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
    { port: 8080, protocol: 'tcp' }
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

test('one filter total equals its cumulative counters', () => {
  assert.deepEqual(
    sumFilterTotals([
      { port: 443, protocol: 'tcp', bytesIn: 10, bytesOut: 20 }
    ]),
    { bytesIn: 10, bytesOut: 20, bytesTotal: 30 }
  );
});

test('two filter totals are summed exactly', () => {
  assert.deepEqual(
    sumFilterTotals([
      { port: 443, protocol: 'tcp', bytesIn: 10, bytesOut: 20 },
      { port: 80, protocol: 'tcp', bytesIn: 2, bytesOut: 5 }
    ]),
    { bytesIn: 12, bytesOut: 25, bytesTotal: 37 }
  );
});

test('same-port TCP and UDP pairs both contribute to filtered totals', () => {
  assert.deepEqual(sumFilterTotals([
    { port: 443, protocol: 'tcp', bytesIn: 10, bytesOut: 20 },
    { port: 443, protocol: 'udp', bytesIn: 2, bytesOut: 1 }
  ]), {
    bytesIn: 12,
    bytesOut: 21,
    bytesTotal: 33
  });
});

test('TCP and UDP filter pairs contribute once each', () => {
  assert.deepEqual(
    sumFilterTotals([
      { port: 443, protocol: 'tcp', bytesIn: 10, bytesOut: 20 },
      { port: 53, protocol: 'udp', bytesIn: 1, bytesOut: 3 },
      { port: 8080, protocol: 'tcp', bytesIn: 4, bytesOut: 6 }
    ]),
    { bytesIn: 15, bytesOut: 29, bytesTotal: 44 }
  );
});

test('removing a high-traffic filter removes all of its history', () => {
  const filters = [
    { port: 443, protocol: 'tcp', bytesIn: 10, bytesOut: 20 },
    { port: 80, protocol: 'tcp', bytesIn: 9_000_000, bytesOut: 8_000_000 },
    { port: 53, protocol: 'udp', bytesIn: 1, bytesOut: 3 }
  ];
  const remaining = removeFilter(filters, 80, 'tcp');

  assert.deepEqual(
    sumFilterTotals(remaining),
    { bytesIn: 11, bytesOut: 23, bytesTotal: 34 }
  );
});

test('removing all filters resets totals and re-adding starts from zero', () => {
  assert.deepEqual(
    sumFilterTotals([]),
    { bytesIn: 0, bytesOut: 0, bytesTotal: 0 }
  );

  const readded = [
    { port: 443, protocol: 'tcp', bytesIn: 0, bytesOut: 0 }
  ];
  assert.deepEqual(
    sumFilterTotals(readded),
    { bytesIn: 0, bytesOut: 0, bytesTotal: 0 }
  );

  readded[0].bytesIn = 7;
  readded[0].bytesOut = 9;
  assert.deepEqual(
    sumFilterTotals(readded),
    { bytesIn: 7, bytesOut: 9, bytesTotal: 16 }
  );
});

test('realtime totals always follow current state and ignore stale snapshots', () => {
  const current = [
    { port: 53, protocol: 'udp', bytesIn: 0, bytesOut: 0 }
  ];

  for (let update = 1; update <= 20; update += 1) {
    current[0].bytesIn = update;
    current[0].bytesOut = update * 2;
    assert.deepEqual(
      sumFilterTotals(current),
      {
        bytesIn: update,
        bytesOut: update * 2,
        bytesTotal: update * 3
      }
    );
  }

  const pending = filterSelectionSignature(current);
  const stale = [
    { port: 443, protocol: 'tcp', bytesIn: 1000, bytesOut: 2000 },
    ...current
  ];
  assert.equal(
    shouldApplyServerFilters(pending, stale, false),
    false
  );
  assert.deepEqual(
    sumFilterTotals(current),
    { bytesIn: 20, bytesOut: 40, bytesTotal: 60 }
  );
});

test('all-traffic mode opens at zero and counts its first packet', () => {
  const initial = createAllTrafficTotal();
  assert.deepEqual(selectTrafficTotal([], initial), {
    bytesIn: 0,
    bytesOut: 0,
    bytesTotal: 0
  });

  const counted = countAllTrafficPacket(initial, {
    sequence: 1,
    protocol: 'tcp',
    direction: 'in',
    bytes: 12
  });
  assert.deepEqual(selectTrafficTotal([], counted), {
    bytesIn: 12,
    bytesOut: 0,
    bytesTotal: 12
  });
});

test('multiple all-traffic packets accumulate inbound and outbound bytes', () => {
  let total = createAllTrafficTotal();
  total = countAllTrafficPacket(total, {
    sequence: 1,
    direction: 'in',
    bytes: 10
  });
  total = countAllTrafficPacket(total, {
    sequence: 2,
    direction: 'out',
    bytes: 20
  });
  total = countAllTrafficPacket(total, {
    sequence: 3,
    direction: 'in',
    bytes: 5
  });
  assert.deepEqual(selectTrafficTotal([], total), {
    bytesIn: 15,
    bytesOut: 20,
    bytesTotal: 35
  });
});

test('entering filtered mode discards the displayed all-traffic total', () => {
  const allTraffic = countAllTrafficPacket(createAllTrafficTotal(), {
    sequence: 1,
    direction: 'in',
    bytes: 100
  });
  const filters = [
    { port: 443, protocol: 'tcp', bytesIn: 0, bytesOut: 0 }
  ];
  assert.deepEqual(selectTrafficTotal(filters, allTraffic), {
    bytesIn: 0,
    bytesOut: 0,
    bytesTotal: 0
  });
});

test('filtered mode continues to use only active filter counters', () => {
  const allTraffic = {
    bytesIn: 1000,
    bytesOut: 2000,
    bytesTotal: 3000,
    lastSequence: 10
  };
  const filters = [
    { port: 443, protocol: 'tcp', bytesIn: 10, bytesOut: 20 },
    { port: 53, protocol: 'udp', bytesIn: 2, bytesOut: 3 }
  ];
  assert.deepEqual(selectTrafficTotal(filters, allTraffic), {
    bytesIn: 12,
    bytesOut: 23,
    bytesTotal: 35
  });
});

test('removing the last filter starts a zero all-traffic session', () => {
  const previous = [{ port: 443, protocol: 'tcp' }];
  const historical = {
    bytesIn: 100,
    bytesOut: 250,
    bytesTotal: 350,
    lastSequence: 9
  };
  const reset = transitionAllTrafficTotal(previous, [], historical);
  assert.deepEqual(reset, createAllTrafficTotal());
  assert.deepEqual(selectTrafficTotal([], reset), {
    bytesIn: 0,
    bytesOut: 0,
    bytesTotal: 0
  });
});

test('traffic after the final filter removal grows the new session', () => {
  const reset = transitionAllTrafficTotal(
    [{ port: 443, protocol: 'tcp' }],
    [],
    { bytesIn: 100, bytesOut: 200, bytesTotal: 300, lastSequence: 4 }
  );
  const counted = countAllTrafficPacket(reset, {
    sequence: 5,
    direction: 'out',
    bytes: 7
  });
  assert.deepEqual(selectTrafficTotal([], counted), {
    bytesIn: 0,
    bytesOut: 7,
    bytesTotal: 7
  });
});

test('each second all-traffic session starts from zero', () => {
  const filter = [{ port: 80, protocol: 'tcp' }];
  let total = countAllTrafficPacket(createAllTrafficTotal(), {
    sequence: 1,
    direction: 'in',
    bytes: 30
  });
  total = transitionAllTrafficTotal([], filter, total);
  total = transitionAllTrafficTotal(filter, [], total);
  assert.deepEqual(total, createAllTrafficTotal());
});

test('packet sequences are counted once and snapshots never contribute', () => {
  let total = createAllTrafficTotal();
  const packet = { sequence: 7, direction: 'in', bytes: 40 };
  total = countAllTrafficPacket(total, packet);
  const duplicate = countAllTrafficPacket(total, packet);
  const snapshot = {
    totals: { bytesIn: 900, bytesOut: 800 }
  };
  assert.strictEqual(duplicate, total);
  assert.deepEqual(selectTrafficTotal([], duplicate, snapshot), {
    bytesIn: 40,
    bytesOut: 0,
    bytesTotal: 40
  });
});

test('stale snapshots cannot restore a previous all-traffic total', () => {
  const reset = transitionAllTrafficTotal(
    [{ port: 53, protocol: 'udp' }],
    [],
    { bytesIn: 500, bytesOut: 600, bytesTotal: 1100, lastSequence: 20 }
  );
  const staleSnapshot = {
    totals: { bytesIn: 500, bytesOut: 600 }
  };
  assert.deepEqual(selectTrafficTotal([], reset, staleSnapshot), {
    bytesIn: 0,
    bytesOut: 0,
    bytesTotal: 0
  });
});

test('TCP and UDP packets both contribute to all-traffic totals', () => {
  let total = createAllTrafficTotal();
  total = countAllTrafficPacket(total, {
    sequence: 1,
    protocol: 'tcp',
    direction: 'in',
    bytes: 11
  });
  total = countAllTrafficPacket(total, {
    sequence: 2,
    protocol: 'udp',
    direction: 'out',
    bytes: 13
  });
  assert.deepEqual(selectTrafficTotal([], total), {
    bytesIn: 11,
    bytesOut: 13,
    bytesTotal: 24
  });
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

  panel.updateCounters(80, 'tcp', 1024, 2048);
  panel.updateCounters(443, 'tcp', 4096, 8192);
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
    { port: 8080, protocol: 'tcp', bytesIn: 0, bytesOut: 0 }
  ];
  const panel = new FilterPanel({
    document,
    host,
    formatBytes: (bytes) => `${bytes} B`,
    onRemove: (port, protocol) => removed.push(filterKey(port, protocol))
  });
  const render = () => panel.render(filters);

  render();
  const originalElements = filters.map(
    (filter) => panel.rows.get(filterKey(filter.port, filter.protocol)).element
  );
  const originalButtons = filters.map(
    (filter) => panel.rows.get(filterKey(filter.port, filter.protocol)).removeButton
  );

  for (let update = 1; update <= 20; update += 1) {
    filters.forEach((filter) => {
      filter.bytesIn = update;
      filter.bytesOut = update * 2;
    });
    render();
  }

  assert.deepEqual(
    filters.map((filter) => panel.rows.get(filterKey(filter.port, filter.protocol)).element),
    originalElements
  );
  assert.deepEqual(
    filters.map((filter) => panel.rows.get(filterKey(filter.port, filter.protocol)).removeButton),
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
  assert.deepEqual(removed, ['443:tcp', '53:udp', '8080:tcp']);
});

test('same-port protocols own distinct persistent rows and removal controls', () => {
  const document = new FakeDocument();
  const host = new FakeElement(document, 'main');
  const removed = [];
  const panel = new FilterPanel({
    document,
    host,
    formatBytes: (bytes) => `${bytes} B`,
    onRemove: (port, protocol) => removed.push(filterKey(port, protocol))
  });
  const filters = [
    { port: 443, protocol: 'tcp', bytesIn: 10, bytesOut: 20 },
    { port: 443, protocol: 'udp', bytesIn: 30, bytesOut: 40 }
  ];

  panel.render(filters);
  const tcpRow = panel.rows.get('443:tcp');
  const udpRow = panel.rows.get('443:udp');
  assert.notStrictEqual(tcpRow.element, udpRow.element);
  assert.equal(panel.panel.children.length, 2);
  assert.equal(tcpRow.element.dataset.filterKey, '443:tcp');
  assert.equal(udpRow.element.dataset.filterKey, '443:udp');

  panel.updateCounters(443, 'tcp', 50, 60);
  assert.equal(tcpRow.bytesIn.textContent, 'IN 50 B');
  assert.equal(udpRow.bytesIn.textContent, 'IN 30 B');

  tcpRow.removeButton.click();
  udpRow.removeButton.click();
  assert.deepEqual(removed, ['443:tcp', '443:udp']);

  panel.render([filters[1]]);
  assert.equal(panel.rows.has('443:tcp'), false);
  assert.strictEqual(panel.rows.get('443:udp'), udpRow);
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
    { port: 8080, protocol: 'tcp' }
  ]);
  const first = panel.rows.get('443:tcp').element;
  const last = panel.rows.get('8080:tcp').element;

  panel.render([
    { port: 443, protocol: 'tcp' },
    { port: 8080, protocol: 'tcp' }
  ]);

  assert.equal(panel.rows.has(53), false);
  assert.deepEqual(panel.panel.children, [first, last]);

  panel.render([
    { port: 8080, protocol: 'tcp' },
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
  assert.equal((markup.match(/value="tcp"/g) || []).length, 1);
  assert.equal((markup.match(/value="udp"/g) || []).length, 1);
  assert.doesNotMatch(markup, /TCP\s*\+\s*UDP/i);
});
