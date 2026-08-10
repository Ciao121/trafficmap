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

function cloneClient(client) {
  return {
    ...client
  };
}

export class ClientPopupSession {
  constructor() {
    this.clients = null;
    this.mode = null;
  }

  open(clients) {
    const snapshot = Array.isArray(clients)
      ? clients.map(cloneClient)
      : [];

    this.clients = snapshot;
    this.mode = snapshot.length > 1
      ? 'group'
      : 'client';

    return snapshot;
  }

  close() {
    this.clients = null;
    this.mode = null;
  }

  isOpen() {
    return this.clients !== null;
  }

  select(identity) {
    if (!this.clients) {
      return null;
    }

    const client = this.clients.find(
      (item) => clientIdentity(item) === identity
    );

    if (!client) {
      return null;
    }

    this.mode = 'client';
    return cloneClient(client);
  }
}
