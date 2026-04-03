# Scripts

## Purpose

This folder holds maintenance utilities and fixture-preparation helpers that support the repository but are not part of the application runtime.

## What Belongs Here

Scripts in this folder should regenerate deterministic fixtures, prepare support assets, or handle repository upkeep that would be awkward to do by hand. They should stay small, explicit, and tied to a clear maintenance need.

`fiesta.ts` is the batch render helper for local experimentation. It samples audio exports from the standard FL Studio projects folder, collapses versioned siblings so only the highest trailing `_N` variant for a track family is eligible, assigns a vivid nature-biased image theme plus a few high-level render toggles, and drives the main CLI repeatedly while naming each render after the chosen source track and still letting the CLI place it in `video/`.

## Design Rules

- Prefer deterministic outputs so tests and docs stay stable.
- Keep script logic in support of the repo, not as a shadow copy of runtime behavior.
- Keep batch helpers explicit about where they source local media and what creative knobs they randomize.
- When a script changes tracked fixtures or support assets, update the README nearest to those assets in the same task.

## Related Docs

- [../README.md](../README.md)
- [../test/README.md](../test/README.md)
- [../test/fixtures/README.md](../test/fixtures/README.md)
