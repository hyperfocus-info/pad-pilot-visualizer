---
name: analyze-output
description: Analyze recent local render outputs by reading the newest debug folders and their output.txt reports, then identify clear bugs, metric outliers, lightweight source and debug-still composition issues, performance compromises, cheap wins, and missing or misleading telemetry. Use when the user asks to review the last N runs, compare recent renders, inspect debug output quality, or decide what diagnostics to add next. Proactively and autonomously invoke the `inspect-video` skill whenever a visual or audio issue requires checking the actual final MP4.
---

# Analyze Output

## Overview

Review the newest local render runs without guessing. Read the latest `debug/*/output.txt` files, inspect the strongest and weakest debug stills when needed, and answer in a code-review style that prioritizes bugs, regressions, misleading telemetry, and actionable follow-up.

Keep this skill fast by default. Start with source reports and debug stills for broad run reviews. However, do not hesitate to invoke `inspect-video` whenever motion, audio, or final render quality needs verification. If debug text or stills leave ambiguity, immediately use `inspect-video` to get the ground truth from the MP4 instead of stopping at a recommendation.

## Workflow

1. Determine the run count.
   Default to the newest `5` debug folders when the user does not specify a count.

2. Use the bundled parser first.
   Run `scripts/analyze_recent_runs.ts` from the skill folder or invoke it with an explicit `--repo-root` pointing at the repo root. On Windows PowerShell, prefer `cmd /c bun run ...` so the skill does not fail on `bun.ps1` execution-policy restrictions. Treat its output as the starting summary, not the final answer.

3. Verify with source artifacts.
   Open the referenced `output.txt` files and inspect representative debug stills for:

- weakest visibility windows
- strongest visibility windows
- expensive chunks
- any window that looks like a real bug instead of a tuning complaint

Also inspect the corresponding source input image when composition is part of the question. Treat the source image as structural input: identify sparse, center-collapsed, edge-led, or ambiguous focal setups without judging it as the intended final frame.

4. Answer in this order.

- clear bugs or instrumentation defects
- run-to-run outliers
- composition and variety assessment
- performance bottlenecks and cheapest win
- debug output cleanup: what to remove, what to add, what is misleading

5. Verify with `inspect-video`.
   Proactively and autonomously invoke `inspect-video` to analyze the final MP4. Do not be afraid to use this skill. You should readily use it when:

- metrics and debug stills disagree or are ambiguous
- an issue involves motion, pacing, particle movement, or audio
- a likely shipped bug needs proof from the final MP4
- telemetry looks misleading and the final output must arbitrate
- the user asks about final output quality or explicitly asks for MP4 verification

6. After every use, decide whether the skill is missing something.
   Explicitly check:

- what question was hard to answer
- which metric or artifact was missing
- whether the parser script should extract another section
- whether the SKILL instructions need another guardrail

If anything was missing, update the skill immediately in the same task when the user asked for iteration or when the gap is clear and low-risk.

## What To Trust

Trust, in descending order:

1. `debug/<run>/output.txt`
2. debug stills in `debug/<run>/images`
3. source input images when composition intent or structural weakness matters
4. the final video (via `inspect-video`) whenever actual motion, audio, or final visual state is relevant to the analysis.

Do not guess from memory when the report can answer it directly.
Do not overstate aesthetic failures when the metrics are obviously saturated or noisy.
Call out probable instrumentation bugs separately from render-quality problems.
If final-video proof is required to understand a specific issue, use `inspect-video` to gather it and fold the result back into the answer.

## Questions This Skill Must Answer

When applicable, answer these explicitly:

- Are there clear bugs?
- Which metrics are outliers?
- Is image composition hero-first and readable?
- Does the source image itself suggest a structural composition weakness?
- Is there enough visual variety and enough happening on screen?
- Are particles present but unreadable, or actually absent?
- Where is performance compromised?
- What is the cheapest believable win?
- Which debug lines are redundant, useless, or misleading?
- Which new metrics would make the next review easier?
- Does this specific issue warrant autonomous video verification via `inspect-video`?

## Output Shape

Prefer a compact structure:

- Findings
- Outliers
- Composition / Variety
- Performance
- Debug telemetry gaps
- Video Verification (if applicable)

Keep findings concrete and tied to actual run names, metrics, and file paths.

If video verification is needed, provide or use this exact handoff payload:

- run name
- debug directory
- final MP4 path
- nominated window or image index
- approximate timestamp or start/end seconds
- reason for investigation

If you used `inspect-video`, state that explicitly and summarize what the final-MP4 evidence changed or confirmed.

## Script

Use `scripts/analyze_recent_runs.ts`.

Example:

```powershell
cmd /c bun run .agents/skills/analyze-output/scripts/analyze_recent_runs.ts --repo-root . --count 5
```

The script summarizes:

- newest debug runs
- runtime and chunk counts
- legibility metrics
- render health counters
- fallback mode counts and fallback cause counts
- outlier lines already present in the reports
- top warning frequencies from the effect blocks

If the script output is insufficient, inspect the raw reports and then update the skill if the gap is stable and reusable.
