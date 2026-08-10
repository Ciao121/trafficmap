export function clientIdentity(client) {
  return JSON.stringify([
    String(client?.ip || '')
      .trim()
      .toLowerCase(),
    String(client?.protocol || 'tcp')
      .trim()
      .toLowerCase(),
    Number(client?.localPort) || 0,
    Number(client?.firstSeen) || 0
  ]);
}

export const POPUP_SESSION_STATE = Object.freeze({
  CLOSED: 'closed',
  GROUP: 'group',
  DETAIL: 'detail'
});

function cloneClient(client) {
  return {
    ...client
  };
}

export class ClientPopupSession {
  constructor() {
    this.clients = null;
    this.selectedClient = null;
    this.mode = POPUP_SESSION_STATE.CLOSED;
  }

  openGroup(clients) {
    const snapshot = Array.isArray(clients)
      ? clients.map(cloneClient)
      : [];

    this.clients = snapshot;
    this.selectedClient = null;
    this.mode = POPUP_SESSION_STATE.GROUP;

    return snapshot;
  }

  open(clients) {
    const snapshot = this.openGroup(clients);

    if (snapshot.length <= 1) {
      this.mode = POPUP_SESSION_STATE.DETAIL;
      this.selectedClient = snapshot[0] || null;
    }

    return snapshot;
  }

  close() {
    this.clients = null;
    this.selectedClient = null;
    this.mode = POPUP_SESSION_STATE.CLOSED;
  }

  isOpen() {
    return this.mode !== POPUP_SESSION_STATE.CLOSED;
  }

  openDetail(identity) {
    if (
      this.mode !== POPUP_SESSION_STATE.GROUP ||
      !this.clients
    ) {
      return null;
    }

    const client = this.clients.find(
      (item) => clientIdentity(item) === identity
    );

    if (!client) {
      return null;
    }

    this.selectedClient = cloneClient(client);
    this.mode = POPUP_SESSION_STATE.DETAIL;
    return cloneClient(this.selectedClient);
  }

  select(identity) {
    return this.openDetail(identity);
  }
}

export function transitionPopupToDetail({
  event,
  identity,
  session,
  marker,
  render,
  detachGroupListener
}) {
  event.preventDefault();
  event.stopPropagation();

  const popup = marker.getPopup();

  if (
    !popup ||
    !marker.isPopupOpen()
  ) {
    return null;
  }

  const client = session.openDetail(identity);

  if (!client) {
    return null;
  }

  detachGroupListener();
  popup.setContent(render(client));
  return client;
}
