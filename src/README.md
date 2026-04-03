# Runtime

## Purpose

`src/` is the runtime entry and subsystem boundary layer for the product. It should read like a pipeline rather than a grab bag: orchestration brings inputs in, analysis converts them into signals, rendering turns those signals into motion and image, and support code keeps the run operational.

## What Belongs Here

This folder contains the CLI entrypoint, shared runtime types and configuration, and the major subsystems that handle media understanding, rendering, hot-path acceleration, and operational support.

The current runtime contract separates three kinds of decision-making:

- media analysis produces relative music signals and image structure
- visual planning turns those signals into phrase identity and continuity choices
- rendering executes those choices while preserving hero-first readability

That split matters because the renderer should not have to guess what kind of musical change it is seeing. Phrase-level identity is now explicitly prepared upstream.

The runtime also treats trust as part of the contract now. Audio analysis is responsible for deciding when source BPM metadata is safe to keep, when estimated tempo should win, and when anchor quality is weak enough that the renderer should see that risk explicitly in debug output.

The CLI output contract now prefers preservation over replacement. If the requested render target already exists, startup resolves the next available numbered filename and pairs debug artifacts with that same suffix so prior renders and their diagnostics remain intact.

## Design Rules

- Preserve a pipeline-shaped mental model.
- Keep subsystem boundaries explicit so contributors can tell where analysis ends and rendering begins.
- Prefer placing generic operational helpers in support folders instead of leaking them into product logic.

## Related Docs

- [media/README.md](media/README.md)
- [render/README.md](render/README.md)
- [perf/README.md](perf/README.md)
- [utils/README.md](utils/README.md)
- [../README.md](../README.md)
