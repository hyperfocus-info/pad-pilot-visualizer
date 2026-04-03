---
name: inspect-video
description: Inspect final rendered video output for troubleshooting by comparing source images, debug stills, and extracted MP4 frames from a specific run. Use when the user wants final-video verification, when a suspected composition or readability bug needs proof in the shipped MP4, or when debug telemetry and debug stills disagree and final output must arbitrate.
---

# Inspect Video

## Overview

Investigate a specific run by comparing three artifacts:
- the source input image
- the existing debug stills
- extracted frames from the final MP4

Use this skill for troubleshooting, debugging, and verification. It is not the default post-run review skill. For broad recent-run review, use `analyze-output` first. This skill may also be invoked autonomously by `analyze-output` when a specific visual or audio issue needs deeper evidence from the final MP4.

## Workflow

1. Read the target `debug/<run>/output.txt`.
Confirm:
- final MP4 path
- suspicious window indices
- start and end seconds for the windows you need to inspect

2. Nominate only the windows that matter.
Default candidates:
- the user-specified timestamp or image index
- weakest visibility window
- a contradictory telemetry window
- one strong control window when you need a comparison point

3. Inspect source and debug artifacts first.
Look at:
- the source input image for structural composition
- the quarter, middle, and three-quarter debug stills if present

Classify the source structure with short labels such as:
- structurally strong
- structurally sparse
- center-collapsed
- edge-led
- ambiguous focal hierarchy

4. Extract MP4 verification frames only for the nominated windows.
Run `scripts/extract_verification_frames.ts`.

Default extraction policy:
- midpoint only

Escalate to quarter and three-quarter extraction only when:
- the user asks
- the issue looks temporal rather than static
- one frame is not enough to judge continuity, collapse, or recovery

Write extracted files only into `cache/inspect-video/<run-name>/`.

5. Compare source, debug, and final output.
Answer:
- what is visible in the final MP4
- whether the final MP4 is weaker or stronger than the debug still
- whether the source structure already limited the shot
- whether the telemetry described the problem honestly

6. Classify the likely cause.
Use one of:
- `source-limited`
- `renderer-introduced`
- `telemetry-misleading`
- `final-output-clean`

## What To Trust

Trust, in descending order:
1. the extracted MP4 verification frame for what actually shipped
2. `debug/<run>/output.txt` for timing, metrics, and diagnostic intent
3. debug stills for intermediate evidence
4. the source image for structural composition context

Do not infer shipped quality from debug stills alone when you already extracted a final-video frame.
Do not inspect more frames than the troubleshooting question requires.

## Output Shape

Prefer a compact structure:
- Findings
- Source vs Debug
- MP4 Verification
- Likely Cause
- Next Debugging Step

Keep findings concrete and tied to run names, timestamps, window indices, metrics, and file paths.

## Script

Use `scripts/extract_verification_frames.ts`.

Example:

```powershell
bun run .agents/skills/inspect-video/scripts/extract_verification_frames.ts --repo-root . --run-dir "debug/baby bro(4)" --time-sec 63.425 --label window-018-mid
```

The script:
- resolves ffmpeg through the repo helper
- reads the final MP4 path from `output.txt` unless `--video-path` is provided
- extracts PNG frames into `cache/inspect-video/<run-name>/`
