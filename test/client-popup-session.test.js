import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ClientPopupSession,
  clientIdentity
} from '../client-popup-session.js';

const client = (
  ip,
  protocol = 'tcp',
  localPort = 443
) => ({
  ip,
  protocol,
  localPort,
  bytesIn: 1,
  recentBytesIn: 1,
  firstSeen: 100
});

test('opening a multi-IP popup captures an explicit ordered snapshot', () => {
  const source = [client('1.1.1.1'), client('8.8.8.8')];
  const session = new ClientPopupSession();
  const snapshot = session.open(source);

  assert.equal(snapshot.length, 2);
  assert.deepEqual(snapshot.map(({ ip }) => ip), [
    '1.1.1.1',
    '8.8.8.8'
  ]);
  assert.notStrictEqual(snapshot, source);
  assert.notStrictEqual(snapshot[0], source[0]);
});

test('new, removed, and reordered global clients do not change an open snapshot', () => {
  const first = client('1.1.1.1');
  const second = client('8.8.8.8');
  const globalClients = [first, second];
  const session = new ClientPopupSession();
  const snapshot = session.open(globalClients);

  globalClients.push(client('9.9.9.9'));
  globalClients.splice(0, 1);
  globalClients.reverse();

  assert.deepEqual(snapshot.map(({ ip }) => ip), [
    '1.1.1.1',
    '8.8.8.8'
  ]);
});

test('realtime refreshes preserve list nodes and scroll position while open', () => {
  const session = new ClientPopupSession();
  session.open([client('1.1.1.1'), client('8.8.8.8')]);
  const list = {
    children: [{ ip: '1.1.1.1' }, { ip: '8.8.8.8' }],
    scrollTop: 84
  };
  const nodes = [...list.children];
  let replacements = 0;

  for (let refresh = 0; refresh < 20; refresh += 1) {
    if (!session.isOpen()) {
      replacements += 1;
    }
  }

  assert.equal(replacements, 0);
  assert.deepEqual(list.children, nodes);
  assert.equal(list.scrollTop, 84);
});

test('closing clears the snapshot and reopening captures current membership', () => {
  const session = new ClientPopupSession();
  session.open([client('1.1.1.1'), client('8.8.8.8')]);
  session.close();
  assert.equal(session.clients, null);
  assert.equal(session.isOpen(), false);

  const reopened = session.open([
    client('8.8.8.8'),
    client('9.9.9.9')
  ]);
  assert.deepEqual(reopened.map(({ ip }) => ip), [
    '8.8.8.8',
    '9.9.9.9'
  ]);
});

test('selection uses a stable client identity instead of a row index', () => {
  const session = new ClientPopupSession();
  const tcp = client('8.8.8.8', 'tcp', 443);
  const udp = client('8.8.8.8', 'udp', 443);
  session.open([tcp, udp]);

  const selected = session.select(clientIdentity(udp));
  assert.equal(selected.ip, '8.8.8.8');
  assert.equal(selected.protocol, 'udp');
  assert.equal(selected.localPort, 443);
  assert.equal(session.mode, 'client');
  assert.equal(session.select('[1]'), null);
});

test('same displayed IP and transport pair are distinguished by stable client data', () => {
  const session = new ClientPopupSession();
  const first = client('8.8.8.x');
  const second = {
    ...client('8.8.8.x'),
    firstSeen: 200
  };
  session.open([first, second]);

  assert.notEqual(
    clientIdentity(first),
    clientIdentity(second)
  );
  assert.equal(
    session.select(clientIdentity(second)).firstSeen,
    200
  );
});

test('clients at the same coordinates remain individually selectable', () => {
  const session = new ClientPopupSession();
  const first = {
    ...client('1.1.1.1'),
    latitude: 10,
    longitude: 20
  };
  const second = {
    ...client('8.8.8.8'),
    latitude: 10,
    longitude: 20
  };
  session.open([first, second]);

  assert.equal(
    session.select(clientIdentity(first)).ip,
    '1.1.1.1'
  );
  assert.equal(
    session.select(clientIdentity(second)).ip,
    '8.8.8.8'
  );
});

test('single-IP and selected multi-IP details use the same renderer', () => {
  const source = fs.readFileSync(
    new URL('../app.js', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /function renderClientPopup\(client\)[\s\S]*groupPopupHtml/
  );
  assert.match(
    source,
    /setPopupContent\(\s*renderClientPopup\(client\)/
  );
  assert.equal(
    (source.match(/function renderClientPopup/g) || []).length,
    1
  );
});

test('selection replaces content on the existing marker popup', () => {
  const source = fs.readFileSync(
    new URL('../app.js', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /entry\.marker\.setPopupContent\(\s*renderClientPopup\(client\)/
  );
  assert.doesNotMatch(
    source,
    /L\.popup\([\s\S]*renderClientPopup/
  );
});

test('single-IP popup behavior remains non-selectable', () => {
  const session = new ClientPopupSession();
  const onlyClient = client('1.1.1.1');
  const snapshot = session.open([onlyClient]);

  assert.equal(snapshot.length, 1);
  assert.equal(session.mode, 'client');
  assert.deepEqual(
    session.select(clientIdentity(onlyClient)),
    onlyClient
  );
});
