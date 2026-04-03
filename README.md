# AI Video

## Purpose

`ai-video` is a performance-first Bun CLI for turning music plus themed source imagery into stylized music videos. The project treats source images as structural input rather than literal final output, then builds a new visual surface around audio-reactive motifs, a hero-led frame language, and supporting atmosphere.

## What Belongs Here

This root doc explains the product, the runtime shape, and the repository map. It is the place for durable framing, not for option catalogs or implementation inventories.

At a high level, the system moves through source intake, media analysis, visual planning, frame rendering, output assembly, and targeted diagnostics. The codebase is organized so those stages remain legible as separate concerns.

Repo-local AI skills can live under `.agents/skills/` when a repeatable review or workflow should travel with the project. `analyze-output` is the default post-run review skill for inspecting the newest debug reports, spotting obvious bugs and outliers, and deciding what telemetry the next pass still needs. `inspect-video` is the escalation skill for troubleshooting the shipped MP4 by comparing source images, debug stills, and extracted final-video frames. Source and debug artifacts are the default review path; MP4 extraction is reserved for debugging, troubleshooting, or explicit final-video verification, but `analyze-output` may invoke `inspect-video` autonomously when a specific visual or audio issue needs deeper final-output evidence. Prefer Bun/TypeScript for repo-local skill scripts so they can reuse repo helpers and stay on the same runtime as the CLI.

Repo workflow prefers local search first. Use `rg --files` for discovery, `rg` for exact or broad content lookup, and direct reads once the target file is known so review and debugging stay fast on this workspace.

Current diagnostics are intended to explain composition and continuity failures in human terms, not just timings. The debug report now distinguishes actual fallback composition from missing stats, separates fallback mode from fallback cause, tracks whether particle energy was requested, rendered, culled, and actually readable on screen, and treats repeated windows as distinct diagnostic events instead of collapsing them into one image-level summary.

Hero shells now resolve as deterministic scene-window stacks instead of a single budgeted circle badge. Only about thirty percent of node windows are allowed to render hero shells at all, enabled windows share one shell stack across all heroes in the scene, and that stack is low-band driven with up to three layers whose thresholds adapt over a two-beat capture window. Diagnostics record both the legacy compatibility shell fields and the explicit scene-shell state so shell behavior stays auditable.

Hero travel is now intentionally tiered instead of trying to split the difference all the time. Low-grace heroes should feel discontinuous and edge-hungry, mid-grace heroes should travel like they mean it, and high-grace heroes should earn rhythmic flourish rather than reading as random jitter. The important boundary is that screen-edge pressure bends what a hero emits toward the canvas center without rewriting the hero's own path.

Audio direction now leans on relative multi-band momentum instead of rewarding raw loudness. The system reads whether bands are rising against the immediately previous frame and against a short rolling baseline, then uses those relationships to drive pacing, continuity, and motif changes. That motion is now signed in the transition layer as well: falling dB or hz should lengthen handoffs instead of accidentally acting like more transition pressure, outro sections should stop starting new transitions once a source is established, and audio-cooled source swaps should stay selective rather than turning every accelerated window into a new image. BPM choice is also trust-aware now: weak metadata can be overridden when beat-origin confidence is poor or a fallback-zero anchor would make the grid musically unreliable.

Song identity and phrase identity are now separate on purpose. A track gets a durable song-level visual family, while each phrase can rotate motif families, transition clusters, and composition biases inside that family. That keeps continuity intact even when the same source images recur.

Reflection vocabulary is also broader now. Mirrored duets, processional trios, quad vigils, prism tribunals, kaleidoscopic transitions, reflective events, and conductor-led symmetric particle behaviors are all part of the intended language, but they still answer to the same rule: legibility and continuity win over adding more spectacle.

That reflective language is now intentionally overrepresented when the renderer is choosing among comparable options. Symmetry, mirror logic, and kaleidoscopic structure are meant to recur as a durable bias rather than as rare accents, while cataloged freeze-style closing effects are intentionally rarer so low-energy restraint still reads as authored instead of repetitive.

Particle exits also have a more authored vocabulary now. Reaching the canvas boundary is treated as a destruction event with a deterministic catalog choice and a short offscreen exit path, not just a quiet fade or an arbitrary lifetime haircut. The catalog is generic on purpose: motifs should route toward families of exits, while diagnostics should prove whether those exits actually distributed with variety.

Hero-impact moments are also materially stronger now. When a motif or outro chooses to push directly on the hero, the subject deformation and local particle field are expected to hit harder, with violent but still localized turbulence around the hero instead of a frame-wide wash that would weaken composition.

Hero particle sizing and satellite motion are also tuned toward readability now. Extreme particle sizes are compressed slightly so the floor stays legible, and multi-hero satellites should move more fluidly unless the current scene identity is explicitly glitch-biased.

## Jargon

Vocabulary below is project-specific and every term should stay simple enough to explain in one sentence.

- `Scene`: A scene is every visual element currently rendered on one canvas from one resolved source image, and a new resolved source image means a new scene.
- `Scene graph`: The scene graph is the blueprint for that scene, including hero structure, attractors, continuity seeds, and the scene-scoped visual systems the renderer agrees on.
- `Hero`: The hero is the primary readable subject that owns the frame's main shape, path, and local particle identity.
- `Active subject`: The active subject is the runtime state that says where the hero is and how it is moving right now.
- `Source motif`: The source motif is the structural motif classified from the source image and used as visual scaffolding telemetry.
- `Resolved hero motif`: The resolved hero motif is the motif the renderer actually uses for hero identity after scheduling and continuity rules are applied.
- `Fractal motif`: A fractal motif is a named visual grammar such as orbital, ribbon, lattice, or bloom that shapes how the scene should move and feel.
- `Phrase motif family`: A phrase motif family is the phrase-level motif bias that keeps local variety inside a larger song-level identity.
- `Persistent motif`: A persistent motif is a continuity bias that keeps a specific transition and overlay grammar alive across multiple scene windows.
- `Song visual family`: A song visual family is the track-level visual mood that phrase-level choices rotate inside.
- `Motif effect`: A motif effect is a scene-level surface treatment tied to the current motif that reacts to audio without replacing the scene's core identity.
- `Background concept`: A background concept is an explicit support-layer system that explains how the scene's background should move, react, and stay subordinate to the hero.
- `Particle concept`: A particle concept is an explicit particle behavior family that can be described in one sentence instead of being inferred from hidden branches.
- `Event concept`: An event concept is a high-impact punctuation beat that briefly pushes the scene into a named phenomenon without becoming the baseline look.
- `Outro effect`: An outro effect is the closing visual cadence that gives the final bars a deliberate release.
- `Edge map`: An edge map is the precomputed structural field over a source image that gives the renderer edges, contours, density, tone, and focal geometry to build from.
- `Source attractor profile`: A source attractor profile is the summary of where the source image pulls layout, motion, and coupling decisions.
- `Support / background`: Support and background are the subordinate layers that keep the frame alive under the hero without stealing focus.
- `Placement layer`: A placement layer is the explicit occupancy tier of `hero`, `support`, or `background`.
- `Composition plan`: A composition plan is the per-image layout contract that decides where the hero and supporting elements are allowed to live.
- `Shot grammar`: A shot grammar is the named layout and cinematography recipe that tells the scene how to stage itself.
- `Visual phrase plan`: A visual phrase plan is the timeline slice that gives the renderer regime, motif bias, transition appetite, and scene-hold behavior for one phrase.
- `Visual regime`: A visual regime is the section label such as intro, groove, build, drop, breakdown, or outro that describes the phrase's role in the song.
- `Overlay mode`: An overlay mode is the phrase-level feel that fine-tunes intensity inside a broader regime.
- `Transition family`: A transition family is the named handoff language that explains how one scene yields to the next.
- `Nebula`: The nebula is the deep atmosphere pass that adds large-scale color, glow, and structural haze behind the hero.
- `Music grid`: The music grid is the BPM-locked timing model that gives frames beat, bar, and phrase alignment.
- `Audio frame feature`: An audio frame feature is the per-frame bundle of energy, band motion, phase, and pulse signals the renderer reacts to.
- `Node intent seed`: A node intent seed is the deterministic per-image personality that biases how the scene wants its layers to behave.
- `Episode seed`: An episode seed is the longer continuity bias that ties multiple scenes into one authored run.
- `Hero glyph`: A hero glyph is the ornamental shape language that reinforces the hero without replacing the hero's core primitive.
- `Hero physics`: Hero physics is the particle and motion envelope that makes the hero feel materially continuous instead of graphically disconnected.
- `Theme`: A theme is the per-segment palette and motion bias built from audio and image style.
- `Diagnostic / probe`: A diagnostic or probe is the human-facing report layer that explains why a scene did or did not stay readable, continuous, and musically causal.

**Cross-cutting themes:** source images as **scaffolding**; **hero-first** layout; **continuity** across phrases and transitions; **musical causality** from band _relationships_; **phrase vs song** identity; atmosphere and effects **support the motif** instead of replacing it.

## Design Rules

- Preserve the rule that photos are scaffolding, not the finished look.
- Favor hero-first motion and motif-driven continuity over effect spam.
- Keep hero shells selective and intentional; most scenes should render no shell layer at all, and enabled scenes should earn their stack through low-band motion instead of carrying a permanent badge.
- Prefer off-axis hero staging with support that reinforces the hero over centered voids and edge-only ornament.
- Keep documentation focused on intent, boundaries, and aesthetic goals.
- Prefer diagnostics that explain legibility, continuity, and hero isolation over raw effect inventories.
- Keep README behavioral contracts backed by direct regression tests so implementation drift is visible immediately.
- Update the nearest README when implementation changes meaningfully alter workflow, purpose, or visual direction.
- Use local `rg` search and direct reads instead of MCP search layers for repo discovery and lookup.
- Leave searchable specifics in code, tests, and types instead of repeating them here.

## Related Docs

- [AGENTS.md](AGENTS.md)
- [scripts/README.md](scripts/README.md)
- [src/README.md](src/README.md)
- [test/README.md](test/README.md)
