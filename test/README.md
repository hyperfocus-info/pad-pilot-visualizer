# Tests

## Purpose

This folder validates behavior, determinism, and aesthetic constraints at the system-contract level. The goal is to make a visually complex renderer discussable and reviewable without relying on ad hoc manual inspection for every change.

## What Belongs Here

Tests here cover behavioral logic, invariant checks, integration boundaries with external tooling, synthetic helpers, and tracked fixtures used to hold important scenarios in place.

The suite now also treats seeded continuity as a first-class contract. Long-window scenarios are expected to keep hero identity, staging intent, and particle readability coherent under repeated deterministic runs, while still allowing controlled change when image identity, relationship mode, or phrase energy changes.

## Design Rules

- Prefer tests that explain system behavior and guard regressions in intent.
- Use fixtures and helpers to make timing, selection, and visual safety behavior reproducible.
- Keep tests focused on contracts and outcomes rather than mirroring implementation internals.
- Keep most tests fast and deterministic, then use a small number of seeded render-contract scenarios to lock hero-first continuity over longer windows.
- README behavioral contracts are first-class tests; if docs keep a renderer intent, the suite should fail when implementation drifts from it.
- Enforce repo-wide coverage with `bun run test:coverage:check`; the current floor is intended to stay at or above 85% for both lines and functions.

## Related Docs

- [helpers/README.md](helpers/README.md)
- [fixtures/README.md](fixtures/README.md)
- [../src/README.md](../src/README.md)
- [../src/media/README.md](../src/media/README.md)
- [../src/render/README.md](../src/render/README.md)
