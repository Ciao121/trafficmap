import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ClientPopupSession,
  POPUP_SESSION_STATE,
  clientIdentity,
  transitionPopupToDetail
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
  assert.equal(session.mode, POPUP_SESSION_STATE.DETAIL);
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
  session.close();
  session.open([first, second]);
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
    /render:\s*renderClientPopup/
  );
  assert.equal(
    (source.match(/function renderClientPopup/g) || []).length,
    1
  );
});

test('selection replaces content on the existing marker popup', () => {
  const source = fs.readFileSync(
    new URL('../client-popup-session.js', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /const popup = marker\.getPopup\(\)/
  );
  assert.match(
    source,
    /popup\.setContent\(render\(client\)\)/
  );
});

test('single-IP popup behavior remains non-selectable', () => {
  const session = new ClientPopupSession();
  const onlyClient = client('1.1.1.1');
  const snapshot = session.open([onlyClient]);

  assert.equal(snapshot.length, 1);
  assert.equal(session.mode, POPUP_SESSION_STATE.DETAIL);
  assert.deepEqual(
    session.selectedClient,
    onlyClient
  );
});

class FakePopup {
  constructor() {
    this.content = 'group';
    this.contentUpdates = 0;
  }

  setContent(content) {
    this.content = content;
    this.contentUpdates += 1;
  }
}

class FakeMarker {
  constructor() {
    this.popup = new FakePopup();
    this.open = true;
    this.closeEvents = 0;
    this.iconUpdates = 0;
  }

  getPopup() {
    return this.popup;
  }

  isPopupOpen() {
    return this.open;
  }

  closePopup() {
    this.open = false;
    this.closeEvents += 1;
  }

  setIcon() {
    this.iconUpdates += 1;
  }
}

function clickEvent() {
  return {
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    }
  };
}

function openGroupLifecycle() {
  const clients = [client('1.1.1.1'), client('8.8.8.8')];
  const session = new ClientPopupSession();
  const marker = new FakeMarker();
  session.openGroup(clients);
  return { clients, session, marker };
}

test('group click transitions to detail without closing the existing popup', () => {
  const { clients, session, marker } = openGroupLifecycle();
  const event = clickEvent();
  let detached = 0;

  const selected = transitionPopupToDetail({
    event,
    identity: clientIdentity(clients[1]),
    session,
    marker,
    render: ({ ip }) => `detail:${ip}`,
    detachGroupListener: () => {
      detached += 1;
    }
  });

  assert.equal(selected.ip, '8.8.8.8');
  assert.equal(session.mode, POPUP_SESSION_STATE.DETAIL);
  assert.equal(marker.popup.content, 'detail:8.8.8.8');
  assert.equal(marker.isPopupOpen(), true);
  assert.equal(marker.closeEvents, 0);
  assert.equal(detached, 1);
});

test('group click propagation cannot trigger Leaflet map popup cleanup', () => {
  const { clients, session, marker } = openGroupLifecycle();
  const event = clickEvent();

  transitionPopupToDetail({
    event,
    identity: clientIdentity(clients[0]),
    session,
    marker,
    render: ({ ip }) => ip,
    detachGroupListener: () => {}
  });

  if (!event.propagationStopped) {
    marker.closePopup();
    session.close();
  }

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.equal(marker.closeEvents, 0);
  assert.equal(session.mode, POPUP_SESSION_STATE.DETAIL);
});

test('realtime snapshots and marker updates preserve detail lifecycle', () => {
  const { clients, session, marker } = openGroupLifecycle();
  transitionPopupToDetail({
    event: clickEvent(),
    identity: clientIdentity(clients[0]),
    session,
    marker,
    render: ({ ip }) => ip,
    detachGroupListener: () => {}
  });
  const content = marker.popup.content;

  for (let update = 0; update < 20; update += 1) {
    marker.setIcon();
    if (!session.isOpen()) {
      marker.popup.setContent('group refresh');
    }
  }

  assert.equal(marker.iconUpdates, 20);
  assert.equal(marker.popup.contentUpdates, 1);
  assert.equal(marker.popup.content, content);
  assert.equal(marker.isPopupOpen(), true);
  assert.equal(session.mode, POPUP_SESSION_STATE.DETAIL);
});

test('explicit close cleans detail and a later group popup can reopen', () => {
  const { clients, session, marker } = openGroupLifecycle();
  transitionPopupToDetail({
    event: clickEvent(),
    identity: clientIdentity(clients[0]),
    session,
    marker,
    render: ({ ip }) => ip,
    detachGroupListener: () => {}
  });

  marker.closePopup();
  session.close();
  assert.equal(marker.closeEvents, 1);
  assert.equal(session.mode, POPUP_SESSION_STATE.CLOSED);
  assert.equal(session.clients, null);

  marker.open = true;
  const reopened = session.openGroup([
    ...clients,
    client('9.9.9.9')
  ]);
  assert.equal(session.mode, POPUP_SESSION_STATE.GROUP);
  assert.equal(reopened.length, 3);
});
