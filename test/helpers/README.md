# Helpers

## Purpose

This folder contains support code for tests, especially deterministic input generation that would be cumbersome to maintain as static fixture files alone.

## What Belongs Here

Helper code here should synthesize controlled inputs, manage temporary test assets, and make complex behavioral scenarios easier to express in tests.

## Design Rules

- Prefer clarity and control over realism.
- Generate inputs that make timing, beat-origin, and response behavior easy to reason about.
- Keep helpers deterministic enough that test failures remain explainable.

## Related Docs

- [../README.md](../README.md)
- [../fixtures/README.md](../fixtures/README.md)
