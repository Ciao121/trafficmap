# Changelog

All notable changes to this project will be documented in this file.

## [1.3.1] - 2026-08-10

### Fixed

- Kept the single-IP detail popup open when selecting a client from a multi-IP popup.
- Isolated group-to-detail click handling from Leaflet map click propagation and preserved explicit popup lifecycle state across real-time marker updates.

## [1.3.0] - 2026-08-10

### Fixed

- Froze multi-IP popup membership, order, DOM nodes, and scroll position until the popup closes.
- Made each multi-IP row open the standard single-IP details in the same Leaflet popup.

## [1.2.0] - 2026-08-10

### Changed

- Identified every filter by its exact port and protocol pair across the interface, WebSocket state, snapshots, and agent counters.
- Allowed independent TCP and UDP filters, rows, counters, and removal controls on the same port.
- Limited filter protocols to TCP or UDP and removed the combined protocol option.

## [1.1.7] - 2026-08-09

### Fixed

- Restored cumulative TCP and UDP totals while the dashboard is in all-traffic mode.
- Kept filtered totals derived exclusively from active filter counters and reset all-traffic totals at each mode transition.
- Counted only incremental packet events in all-traffic sessions, preventing snapshots and duplicate packet sequences from reintroducing traffic.

## [1.1.6] - 2026-08-09

### Fixed

- Calculated dashboard inbound, outbound, and combined totals exclusively from current filter counters.
- Removed deleted filter history from totals immediately and reset totals to zero when no filters remain.
- Prevented global or stale snapshot totals from replacing current monitored-port totals.

## [1.1.5] - 2026-08-09

### Fixed

- Added one application-owned filter statistics panel controller with idempotent panel creation.
- Reused the same panel when adding or updating rows and removed only the selected row.
- Removed the empty panel after the final filter is deleted and recreated exactly one panel when filters return.

## [1.1.4] - 2026-08-09

### Fixed

- Replaced legacy filter card classes with an explicit single statistics panel and persistent row structure.
- Defined one shared five-column layout contract on the parent panel for consistent row width and alignment.
- Explicitly removed row-level card decoration while retaining only internal horizontal separators.

## [1.1.3] - 2026-08-07

### Changed

- Combined active filter statistics into one compact bottom-right panel with one persistent row per port.
- Aligned port, protocol, inbound, outbound, and removal controls on fixed CSS Grid columns.
- Replaced independent card styling with a shared panel background and subtle row separators.

## [1.1.2] - 2026-08-07

### Fixed

- Kept filter cards and removal buttons stable while packet counters and WebSocket snapshots update.
- Prevented in-flight snapshots from restoring a filter while its updated selection awaits agent acknowledgement.
- Removed the visual Leaflet zoom buttons while preserving wheel, touch, and programmatic zoom.

## [1.1.1] - 2026-08-07

### Fixed

- Made each filter removal button update the frontend state and send the complete remaining filter set to the agent.
- Removed deleted filter counters immediately and restored all-traffic mode after removing the final filter.
- Moved compact filter statistics to the bottom-right without covering the map attribution control.

## [1.1.0] - 2026-08-07

### Added

- Continuous UDP capture and deterministic IPv4/IPv6 UDP parsing alongside existing TCP support.
- Per-dashboard TCP and UDP port filters with atomic WebSocket updates and agent-side filtering.
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
