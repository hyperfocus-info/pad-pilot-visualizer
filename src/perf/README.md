# Performance

## Purpose

This folder exists to protect throughput in rendering hot paths. It is where low-level acceleration belongs when the goal is to preserve visual behavior while reducing per-frame cost.

## What Belongs Here

Performance-sensitive kernels, focused micro-optimizations, and supporting tests for those accelerated paths belong here. This folder is not the place for speculative complexity or broad architectural ownership.

## Design Rules

- Add code here only for proven hot paths.
- Optimize without changing the renderer's visual contract.
- Keep acceleration narrow and measurable instead of letting this folder become a second rendering layer.

## Related Docs

- [../README.md](../README.md)
- [../render/README.md](../render/README.md)
