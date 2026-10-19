# ADR-11. Selfie is optional and there are no biometrics

Status: accepted, 19 Oct 2026. Source: PRD 10.4, 10.6, 13.5.

## Context

A photo at check-in is a deterrent, but face matching would make the data sensitive under the SPDI Rules and add friction for staff with older phones.

## Decision

The selfie is off by default. The owner can turn it on for everyone or for one person. The camera is live only (no gallery), one JPEG of about 480 px, and its SHA-256 is part of the signed payload. There is no face matching and no template. Consent for the selfie is separate from the privacy notice and can be withdrawn; if it is withdrawn while selfies are required, that person's check-ins go to approval until the owner changes the setting.

## Consequences

- Proportionate under DPDP, and less friction.
- The risk score does not punish a missing selfie unless the owner requires one.
- Selfies are kept 30 days, then deleted ([retention runbook](../runbooks/retention-purge.md)).
- Owner views of a selfie are written to the audit log (`access`).
