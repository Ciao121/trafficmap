# Traffic Map Monitor

Mappa full-page che osserva passivamente il traffico TCP su una singola porta. Non usa proxy e non legge i log di Nginx, Apache o dell'applicazione.

## Cosa misura

- byte TCP client → server;
- byte TCP server → client;
- pacchetti nelle due direzioni;
- volume recente e totale per IP;
- attività negli ultimi secondi;
- posizione approssimativa tramite GeoIP;
- cache GeoIP in memoria e su file.

La dimensione dei marker dipende dal traffico nella finestra recente. La pulsazione dipende dal traffico negli ultimi secondi. È quindi adatto anche a WebSocket, HTTP keep-alive, HTTP/2 e protocolli TCP persistenti.

> I byte conteggiati sono il payload TCP riportato da `tcpdump`, non l'intera dimensione Ethernet/IP. ACK senza payload valgono zero byte.

## Requisiti

- Linux;
- Node.js 20 o superiore;
- `tcpdump`;
- permessi `CAP_NET_RAW` e `CAP_NET_ADMIN` oppure avvio come root;
- accesso a Internet del browser per Leaflet/OpenStreetMap CDN;
- accesso del server al servizio GeoIP configurato.

## Avvio rapido manuale

```bash
sudo apt update
sudo apt install -y tcpdump
cp config.example.json config.json
npm install
sudo node src/server.js
```

Per la pubblicazione usare Nginx o Apache davanti al servizio locale `127.0.0.1:3100`, come descritto sotto.

Per evitare di eseguire Node come root, usare il servizio systemd incluso oppure assegnare le capability al processo appropriato. Il servizio systemd è la soluzione consigliata.

## Installazione systemd

```bash
npm install
sudo ./install.sh
```

File principali:

```text
/opt/traffic-map-monitor/config.json
/opt/traffic-map-monitor/data/geoip-cache.json
/etc/systemd/system/traffic-map-monitor.service
```

Comandi:

```bash
sudo systemctl status traffic-map-monitor
sudo journalctl -u traffic-map-monitor -f
sudo systemctl restart traffic-map-monitor
```

## Configurazione

Modificare `config.json`.

### Porta e interfaccia

```json
"monitor": {
  "interface": "any",
  "port": 443,
  "protocol": "tcp",
  "tcpdumpPath": "/usr/bin/tcpdump",
  "sudo": false
}
```

`interface: "any"` funziona bene nella maggior parte dei server Linux. Per limitare la cattura usare, ad esempio, `eth0`.

### Posizione del server

È preferibile impostarla manualmente:

```json
"server": {
  "name": "Server Milano",
  "latitude": 45.4642,
  "longitude": 9.1900,
  "publicIp": "",
  "autoLocate": false
}
```

Con `autoLocate: true`, l'agent tenta di ottenere la posizione pubblica una volta all'avvio.

### Finestra temporale

```json
"dashboard": {
  "recentWindowSeconds": 300,
  "pulseWindowSeconds": 10
}
```

- `recentWindowSeconds`: determina la dimensione del marker;
- `pulseWindowSeconds`: determina se il marker pulsa;
- `inactiveAfterSeconds`: rende trasparente un IP inattivo;
- `forgetAfterMinutes`: elimina gli IP vecchi dalla memoria.

### Privacy

```json
"privacy": {
  "maskIp": false,
  "excludePrivateIps": true,
  "excludedIps": []
}
```

Con `maskIp: true`, il browser riceve una versione mascherata dell'indirizzo. L'agent usa comunque l'IP completo soltanto per la geolocalizzazione e la cache locale.

## Pubblicazione web con percorsi relativi

La dashboard usa esclusivamente percorsi relativi per CSS, JavaScript e WebSocket. Lo stesso pacchetto può quindi essere pubblicato:

- nella root di un dominio: `https://monitor.example.com/`;
- in una sottocartella: `https://example.com/traffic-map/`.

Node.js resta accessibile soltanto localmente su `127.0.0.1:3100`. Nginx o Apache espongono l'interfaccia web.

### Nginx nella root di un dominio

```nginx
location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Nginx in una sottocartella

```nginx
location = /traffic-map {
    return 301 /traffic-map/;
}

location /traffic-map/ {
    proxy_pass http://127.0.0.1:3100/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

La barra finale è necessaria nella URL della sottocartella. La regola di redirect la aggiunge automaticamente. `proxy_pass` termina con `/`, quindi Nginx rimuove il prefisso `/traffic-map/` prima di inoltrare la richiesta a Node.js. Anche il WebSocket relativo `./ws` viene inoltrato correttamente.

### Apache nella root di un dominio

Richiede `mod_proxy`, `mod_proxy_http` e `mod_proxy_wstunnel`.

```apache
ProxyPreserveHost On
ProxyPass        /ws  ws://127.0.0.1:3100/ws
ProxyPassReverse /ws  ws://127.0.0.1:3100/ws
ProxyPass        /    http://127.0.0.1:3100/
ProxyPassReverse /    http://127.0.0.1:3100/
```

### Apache in una sottocartella

```apache
RedirectMatch 301 ^/traffic-map$ /traffic-map/
ProxyPreserveHost On
ProxyPass        /traffic-map/ws  ws://127.0.0.1:3100/ws
ProxyPassReverse /traffic-map/ws  ws://127.0.0.1:3100/ws
ProxyPass        /traffic-map/    http://127.0.0.1:3100/
ProxyPassReverse /traffic-map/    http://127.0.0.1:3100/
```

## Limiti tecnici

- non vede URL, metodi HTTP o codici di risposta;
- non decifra HTTPS;
- non conta richieste applicative;
- misura quantità di payload TCP per direzione;
- una VPN, un reverse proxy o un load balancer esterno può far apparire l'IP del proxy invece di quello dell'utente finale;
- GeoIP è approssimativo.

## Verifica della cattura

Prima di avviare l'applicazione:

```bash
sudo tcpdump -i any -n -q -tt "tcp port 443"
```

Dovrebbero apparire righe contenenti `length N` quando passa payload TCP.
