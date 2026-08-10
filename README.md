# TrafficMap

TrafficMap passively observes a server's TCP and UDP traffic and displays it on a geographic dashboard. It counts payload bytes, packets, and recent activity per remote address; it is not a proxy and does not read application logs.

## Actual behavior

The Node.js process starts an HTTPS server and a WebSocket endpoint at `/ws`. Ordinary HTTPS requests receive `404`: `index.html`, `app.js`, `websocket-url.js`, and `styles.css` are separate static assets that must be published by a static web server. The frontend can be hosted at the domain root or in any subdirectory and connects directly to the agent port; no WebSocket reverse proxy or path rewriting is required.

Capture continuously covers TCP and UDP on all ports. A dashboard initially displays all traffic and may add filters identified by an exact port and protocol pair. TCP and UDP on the same port can be monitored independently; there is no combined filter option. Filters belong to each WebSocket client and are applied by the agent before packets and snapshots are sent. Bytes represent the payload length reported by `tcpdump`, not the Ethernet/IP size. TCP ACK packets without payload are ignored. Direction is determined by comparing endpoints with the server's local addresses.

Each active port/protocol pair displays independent cumulative inbound and outbound byte counters from the time it was added. Removing and later re-adding a pair resets only its counters. Filters are not persisted across page reloads.

With active filters, dashboard inbound, outbound, and combined totals are calculated from their cumulative counters. Removing a filter removes its history immediately. Without filters, a separate all-traffic session total accumulates TCP and UDP packet events from zero; each transition back to all-traffic mode starts a new session.

## Requirements

- Linux for actual traffic capture;
- Node.js 20 or later;
- `tcpdump` and the permissions required for capture;
- server access to the configured GeoIP service;
- browser access to the Leaflet/OpenStreetMap CDNs used by the frontend.

## Manual installation

In the repository directory:

```bash
npm install
cp config.example.json config.json
```

On Windows, the file can be copied manually. `config.json` is local, excluded from Git, and is not regenerated or overwritten by updates.

## Configuration

Edit the local `config.json`. Dashboard time intervals must be positive. The GeoIP cache path is resolved relative to the project root.

`monitor.port` and `monitor.protocol` are retained for configuration compatibility in version 1.1.0, but no longer determine initial dashboard traffic or the capture expression. They are deprecated candidates for a future breaking release; capture now always uses TCP and UDP on all ports.

TLS is mandatory:

```json
"tls": {
  "certificate": "/path/to/fullchain.pem",
  "privateKey": "/path/to/privkey.pem"
}
```

Both paths must be configured and both files must exist. There are no installation-specific default TLS paths.

The `WEBSOCKET_PORT` constant at the beginning of `app.js` must match `dashboard.listenPort` in `config.json` (example value: `3100`). The agent port must be reachable directly from the browser. If the frontend is opened over HTTPS, the browser uses WSS and the agent must present a valid TLS certificate for the page hostname on that port; an HTTP page uses WS.

Privacy options can exclude private/reserved addresses or explicitly listed addresses. Masking changes only the address serialized in snapshots, not the internal key or GeoIP lookup.

## Running and verification

```bash
npm start
```

Tests and checks:

```bash
npm test
npm run verify
npm run test:coverage
```

## Manual updates

```bash
git pull
npm install
npm run verify
```

The `config.json` file remains local. If the example configuration gains new options, copy them manually to the local configuration when needed.

## Technical limitations

- does not inspect URLs, HTTP methods, response codes, or application requests;
- does not decrypt HTTPS;
- measures transport payload rather than total network traffic;
- application proxies, VPNs, or load balancers may hide the final client address;
- IP geolocation is approximate and depends on the configured provider;
- the frontend is not served directly by the Node.js process;
- the dashboard depends on external frontend resources and the GeoIP agent requires network access during actual use.
