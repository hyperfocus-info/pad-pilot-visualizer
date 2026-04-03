# Diagnostic Fixtures

## Purpose

This folder contains targeted diagnostic state files used for selector-based tuning and review. These fixtures capture representative windows where visual behavior, responsiveness, or continuity need to be preserved or iterated on deliberately.

Diagnostic state fixtures now describe content, selectors, and acceptance intent only. They no longer carry a user-facing run seed because render identity is derived from source content and analysis rather than from a CLI seed knob.

## What Belongs Here

State files here should describe focused tuning scenarios rather than general sample runs. They exist to lock in meaningful edge cases and representative quality thresholds.

## Design Rules

- Preserve fixtures that represent important success or failure cases.
- Keep these files oriented around targeted diagnostics, not full-run replay.
- Avoid repeating self-evident field-level detail in prose when the JSON already communicates it.

## Related Docs

- [../README.md](../README.md)
- [../../README.md](../../README.md)
- [../../../README.md](../../../README.md)
