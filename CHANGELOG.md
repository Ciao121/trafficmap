# Changelog

All notable changes to this project will be documented in this file.

## [1.1.1] - 2026-08-07

### Fixed

- Made each filter removal button update the frontend state and send the complete remaining filter set to the agent.
- Removed deleted filter counters immediately and restored all-traffic mode after removing the final filter.
- Moved compact filter statistics to the bottom-right without covering the map attribution control.

## [1.1.0] - 2026-08-07

### Added

- Continuous UDP capture and deterministic IPv4/IPv6 UDP parsing alongside existing TCP support.
- Per-dashboard port filters for TCP, UDP, or both protocols, with atomic WebSocket updates and agent-side filtering.
- Cumulative inbound and outbound byte counters for each active filter.
- Compact removable filter list with all-traffic mode when no filters are active.

### Changed

- Dashboards now start with all TCP and UDP traffic instead of a single selected TCP port.
- Capture uses one continuous `tcp or udp` expression and does not restart when filters change.
- Retained `monitor.port` and `monitor.protocol` for configuration compatibility although they no longer select initial traffic.

## [1.0.0] - 2026-08-06

### Added

- Documented baseline of the existing passive TCP monitor.
- Initial permanent regression test suite using the Node.js test runner.
- Cross-platform syntax and repository consistency checks.
- CI workflow for Node.js 20 and 22.
- Permanent operating rules for future versions.

### Changed

- Completed the example configuration with mandatory TLS paths.
- Updated documentation to reflect the actual HTTPS/WebSocket agent behavior and separate static assets.
- Excluded the local configuration and local GeoIP cache from Git.
- Corrected WebSocket URL construction: the frontend always uses the page hostname, configured agent port, and absolute `/ws` path regardless of its hosting subdirectory.
- Standardized product branding as TrafficMap across the interface, documentation, package metadata, logs, and tests.

### Removed

- Automatic installation files and systemd configuration.
- Installation-specific TLS and WebSocket fallbacks.
