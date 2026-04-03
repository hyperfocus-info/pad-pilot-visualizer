# Fixtures

## Purpose

This folder holds durable reference inputs used to stabilize behavior across tests and diagnostics. It is the tracked corpus for scenarios that should remain discussable over time.

## What Belongs Here

Fixtures here include targeted diagnostic states and visual reference assets. The point is not just to store files, but to preserve representative situations the team cares about keeping stable.

## Design Rules

- Document why a fixture exists, not just what it is called.
- Keep fixture assets deterministic and offline-friendly where possible.
- When fixture meaning changes, update the nearest README in the same change.

## Related Docs

- [../README.md](../README.md)
- [diagnostic/README.md](diagnostic/README.md)
- [tileset/README.md](tileset/README.md)
