# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-08-06

### Added

- Baseline documentata del monitor passivo TCP già esistente.
- Suite iniziale permanente di regression test con il test runner di Node.js.
- Controlli multipiattaforma di sintassi e coerenza della repository.
- Workflow CI per Node.js 20 e 22.
- Regole operative permanenti per le versioni future.

### Changed

- Configurazione di esempio completata con i percorsi TLS obbligatori.
- Documentazione aggiornata in base al comportamento effettivo dell'agent HTTPS/WebSocket e degli asset statici separati.
- Configurazione locale e cache GeoIP locale escluse da Git.
- Corretta la costruzione dell'URL WebSocket: il frontend usa sempre l'hostname della pagina, la porta agent configurata e il percorso assoluto `/ws`, indipendentemente dalla sottocartella di pubblicazione.

### Removed

- File di installazione automatica e configurazione systemd.
- Fallback TLS e WebSocket specifici dell'installazione originaria.
