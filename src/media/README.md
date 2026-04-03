# Media

## Purpose

This layer converts external assets into structured signals the renderer can use. It is where the system learns enough about audio and imagery to make visual decisions without dragging provider details or raw file handling into the rendering layer.

## What Belongs Here

This folder covers audio analysis, image acquisition and caching, image style interpretation, structural edge extraction, and media-tooling adapters that probe, trim, or assemble source material.

Audio analysis now exposes band-relative motion, short rolling baselines, and phrase seeds in addition to absolute dB fields. Raw dB is still preserved for diagnostics, but render-facing scoring is expected to prefer positive multi-band change over simple loudness.

## Design Rules

- Produce renderer-facing abstractions instead of leaking provider or file-format details downstream.
- Favor stable, reproducible analysis because diagnostics and tuning depend on repeatable inputs.
- Treat this layer as perception and preparation, not as a place to invent final-frame aesthetics.
- When adding new audio signals, describe intent in terms of momentum, contrast, or continuity rather than one-off effect toggles.

## Related Docs

- [../README.md](../README.md)
- [../render/README.md](../render/README.md)
- [../../test/README.md](../../test/README.md)
