# ServerMap

ServerMap osserva passivamente il traffico TCP di un server e lo rappresenta su una dashboard geografica. Conta payload TCP, pacchetti e attività recente per indirizzo remoto; non è un proxy e non legge i log applicativi.

## Comportamento effettivo

Il processo Node.js avvia un server HTTPS e un endpoint WebSocket sul percorso `/ws`. Le richieste HTTPS ordinarie ricevono `404`: `index.html`, `app.js`, `websocket-url.js` e `styles.css` sono asset statici separati e devono essere pubblicati da un web server statico. Il frontend può essere ospitato nella root o in qualsiasi sottocartella e si collega direttamente alla porta dell'agent: non è necessario un reverse proxy WebSocket né una riscrittura del percorso.

La cattura considera tutte le porte TCP; ogni dashboard seleziona la porta da visualizzare. I byte sono il payload indicato da `tcpdump` (`tcp N`, con fallback `length N`), non la dimensione Ethernet/IP. Gli ACK senza payload sono ignorati. La direzione è determinata confrontando gli endpoint con gli indirizzi locali del server.

## Requisiti

- Linux per la cattura reale;
- Node.js 20 o superiore;
- `tcpdump` e i permessi necessari alla cattura;
- accesso del server al servizio GeoIP configurato;
- accesso del browser ai CDN Leaflet/OpenStreetMap presenti nel frontend.

## Installazione manuale

Nella directory della repository:

```bash
npm install
cp config.example.json config.json
```

Su Windows il file può essere copiato manualmente. `config.json` è locale, è escluso da Git e non viene rigenerato o sovrascritto dagli aggiornamenti.

## Configurazione

Modificare il proprio `config.json`. `monitor.port` deve essere un intero tra 1 e 65535; gli intervalli temporali della dashboard devono essere positivi. La cache GeoIP è risolta rispetto alla root del progetto.

TLS è obbligatorio:

```json
"tls": {
  "certificate": "/path/to/fullchain.pem",
  "privateKey": "/path/to/privkey.pem"
}
```

Entrambi i percorsi devono essere configurati e i file devono esistere. Non esistono percorsi TLS predefiniti legati a una specifica installazione.

La costante `WEBSOCKET_PORT` all'inizio di `app.js` deve coincidere con `dashboard.listenPort` di `config.json` (valore di esempio: `3100`). La porta dell'agent deve essere raggiungibile direttamente dal browser. Se il frontend è aperto tramite HTTPS, il browser usa WSS e l'agent deve presentare su quella porta un certificato TLS valido per l'hostname della pagina; con una pagina HTTP viene usato WS.

Le opzioni privacy possono escludere indirizzi privati/riservati o indirizzi espliciti. Il mascheramento modifica solo l'indirizzo serializzato nello snapshot, non la chiave interna o la richiesta GeoIP.

## Avvio e verifiche

```bash
npm start
```

Test e controlli:

```bash
npm test
npm run verify
npm run test:coverage
```

## Aggiornamento manuale

```bash
git pull
npm install
npm run verify
```

Il file `config.json` resta locale. Se la configurazione di esempio acquisisce nuove opzioni, queste vanno riportate manualmente nella configurazione locale quando necessarie.

## Limiti tecnici

- non vede URL, metodi HTTP, codici di risposta o richieste applicative;
- non decifra HTTPS;
- misura payload TCP, non il traffico complessivo a livello di rete;
- proxy applicativi, VPN o bilanciatori possono nascondere l'indirizzo del client finale;
- la geolocalizzazione IP è approssimativa e dipende dal provider configurato;
- il frontend non è servito direttamente dal processo Node.js;
- la dashboard dipende da risorse frontend esterne e l'agent GeoIP richiede rete in uso reale.
