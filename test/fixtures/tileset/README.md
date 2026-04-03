# Tileset Fixture

## Purpose

This fixture preserves a deterministic image source for structural edge tests that need a scene with varied shapes, boundaries, and repeated textures.

## What Belongs Here

This folder holds the one-time source asset used for fixture preparation and the derived tracked image that tests actually consume offline.

## Design Rules

- Keep the derived scene stable so edge-behavior tests stay comparable over time.
- Treat the source asset as preparation material and the derived image as the durable test input.
- Preserve fully offline test behavior even if fixture preparation originally depended on a remote source.

## Related Docs

- [../README.md](../README.md)
- [../../../scripts/README.md](../../../scripts/README.md)
