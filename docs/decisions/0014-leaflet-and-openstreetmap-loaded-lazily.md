# ADR-14. Leaflet and OpenStreetMap, loaded lazily

Status: accepted, 19 Oct 2026. Source: PRD 13.5, 4.15, 4.6.

## Context

The owner needs a map for calibration, venue duties and day detail, but a map library is heavy and the staff app must stay small.

## Decision

Use Leaflet with OpenStreetMap tiles from `tile.openstreetmap.org` (with attribution) on owner screens only, loaded on demand. The CSP allows that one image host. The usage is tiny and within the tile usage policy. If tiles are ever blocked, a static SVG distance diagram is the fallback.

## Consequences

- The staff bundle never includes the map (the size budget excludes the lazy chunks).
- A third party sees tile requests from the owner's browser (no personal data in them).
- Map pins are never shown to staff.
