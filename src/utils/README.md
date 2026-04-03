# Utilities

## Purpose

This folder contains operational plumbing that supports the runtime without defining product behavior. Its job is to make runs predictable, observable, and maintainable.

## What Belongs Here

File-system helpers, temp workspace management, process execution wrappers, progress reporting, and debug/status support belong here.

Debug support now includes richer node snapshots. In debug mode each node is expected to carry the source image plus quarter, middle, and three-quarter frame captures so composition drift and continuity failures can be inspected inside the image hold instead of only at its midpoint.

Debug reporting is also expected to stay semantically honest. Zero-valued telemetry should remain visible as zero instead of collapsing into unavailable data, particle availability should be stated explicitly, and fallback summaries should describe why a window degraded rather than silently defaulting every missing field to fallback composition.

## Design Rules

- Keep utilities boring, explicit, and dependable.
- Do not let product logic migrate here just because it is shared.
- Favor predictable behavior over clever abstractions.
- Diagnostics should preserve enough structure to explain repeated windows and merge decisions, not just dump file paths.

## Related Docs

- [../README.md](../README.md)
- [../../README.md](../../README.md)
