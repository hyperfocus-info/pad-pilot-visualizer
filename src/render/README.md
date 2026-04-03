# Render

## Purpose

This folder is the aesthetic center of the project. It turns analyzed signals into a visual language built around hero motion, motif-driven identity, expressive transitions, and atmosphere that supports the main subject instead of overwhelming it.

## What Belongs Here

Rendering code here plans visual regimes, chooses composition and scene behavior, manages hero motion and background systems, applies frame effects and transitions, and produces frames through chunked rendering work.

A scene means every visual element currently built from one resolved source image, so scene-scoped state should only change when the resolved source image changes.

Spawn selection now has an explicit contract as well: background, particle, event, and motif-effect concepts should be chosen through one readable selector path, and later safety logic may only trim or mute the chosen concept instead of secretly replacing it.

The renderer is also responsible for telling the truth about what happened. Its diagnostics now distinguish planned density from visible density, separate true fallback composition from missing or partial stats, track why particles disappeared, preserve repeated windows as separate report entries, and expose whether support or background systems actually participated around the hero.

Render windows now carry a temporal identity instead of relying on image index alone. Repeated returns to the same source image should survive worker aggregation and CLI report assembly as distinct windows, with explicit failure reasons when a rendered window can only emit a compact fallback record.

Telemetry now has runtime boundaries. Full telemetry is for debug and probe runs that need before-and-after effect visibility and deep per-window attribution. Summary telemetry keeps chunk health and compact window summaries without the full payload shape, while ordinary render throughput should not depend on reconstructing a giant debug object after every frame.

Visual planning now operates on a hybrid identity model. A song-level family establishes the durable mood and continuity bias, while phrase-level identities choose motif family, transition cluster, composition bias, hero motion bias, and background response bias. The goal is more deterministic variety from the music without turning continuity into randomness.

Those diagnostics are now part of the tested contract, not just debugging garnish. Seeded continuity scenarios are expected to preserve hero-led narrative lineage, readable separation, and particle visibility over longer windows, with pure reducers holding the grading and window-summary logic in a form the test suite can exercise directly.

Low-res frame sampling also stays honest to the hot path now. The renderer uses one fused luminance and dark-count readback path instead of splitting the same low-res buffer across separate JS and WASM passes, and pre-effect sampling is reserved for telemetry modes that actually consume that delta.

Budget rendering is now the only mode allowed to throttle that luminance readback path. Standard renders keep full readback cadence, while budget mode can reuse the last trusted low-res sample between intervals and reports the gating mode, interval, sampled frames, skipped frames, and estimated saved readback time directly in chunk diagnostics.

Multi-hero staging now resolves as explicit actors with deterministic lanes or mirrored anchors instead of defaulting to one centered body plus tiny satellites. Mirrored relationships should read as bilateral or axial placement, and independent relationships should keep distinct travel space without reactive enforcement.

Background systems are intentionally a little richer at rest now, with thinner support marks carrying more brightness so they stay readable instead of disappearing into the field. Their job is still support, but support should remain legible and musically alive.

Support lift now respects both average luminance and the darkest quarter of the frame instead of only reacting to a single mean brightness sample. The intent is to keep the bottom end of the image readable without flattening the whole composition, so background support can brighten more decisively while still preserving hero-first contrast.

That rescue path now also treats malformed focal or anchor geometry as invalid input to skip or normalize, not as a reason to let a native gradient call abort chunk rendering. Continuity should degrade gracefully when rescue geometry is bad.

Every background family now carries both phrase-continuity motion and smaller audio punctuation. The renderer should feel BPM-aware even between larger transitions, with mid-sized reactions following fills, riffs, and minor impacts rather than waiting only for major accents.

Outro planning now reserves at least the final eight bars when bar metadata exists, so the closing regime has enough runway to read as a real release instead of a last-second label swap. Background line systems should also stay beat-locked and subordinate; diagonal slashes can accent motion, but they should not sway on their own timeline or pull focus off the hero.

Outros now normalize toward a stronger closing collapse regardless of which specific particle or effect variant was selected upstream. The goal is to preserve motif identity while guaranteeing that the final bars still read as a decisive release, with enough runway to avoid tiny terminal windows that feel like a cutoff. Diagnostics also surface more of the outro truth now, including whether the terminal burst actually achieved meaningful coverage and hero deformation.

Hero motion and hero-emitted particles are calmer at baseline. They are meant to bloom back toward full force under strong audio pressure, so the resting frame reads cleaner while peaks still recover the prior intensity ceiling.

That calm is no longer one-size-fits-all. Hero travel now resolves through a small set of readable motion tiers: abrupt low-grace jumps, smoother mid-grace travel, and high-grace flourish layered over stable travel. Screen-edge pressure is only allowed to bend stream aim back toward the canvas center; it should not secretly rewrite hero pathing.

Hero energy now resolves more aggressively once the music actually moves. Standard motifs push much denser hero emission, colorful and psychedelic motifs push harder into color travel, and architectural motifs stay comparatively restrained so the frame does not collapse into noise.

Hero warp is now motif-authored instead of globally biased. Each motif chooses which dB bands drive X and Y warp, how far base warp can stretch, and how much extra headroom extreme cases are allowed, so glitch motifs can snap harder while architectural motifs stay more disciplined.

Primary-hero restraint is also stronger below the track-average dB floor. The main anchor slows sharply when the song drops under its average energy, can fully freeze when that low-energy state is still falling, and cuts its own particle output at the same time so quiet passages hold composition instead of nervous drift.

Hero trails now last longer but only when the subject is genuinely moving. That keeps continuity readable during real motion while avoiding idle haze when the hero is nearly still.

Transparent hero shells are now intentionally scarce. Most node windows should render no shell layer at all, and enabled windows should read as deliberate low-band punctuation instead of a permanent badge on every shot.

That scarcity is now enforced as a deterministic scene-window shell stack. Only about thirty percent of node windows are shell-enabled in a render, enabled windows can configure one to three shared shell layers for the whole scene, and those layers trigger only when low-band energy clears an adaptive threshold that watches the last two beats of shell history.

When shells do appear, they should read as under-hero support rather than a sticker on top of the hero. Their hue travel is allowed to widen further in the most psychedelic variants, but the shell stack still exists to reinforce readability and continuity first.

Shell diagnostics are also explicit now. Scene graphs expose whether shelling is enabled for the current scene, how many shell layers were configured, whether the scene resolved to single-color or multi-color shelling, and what the live trigger rates and adaptive thresholds were for the low, low-mid, and low-composite shell lanes. Legacy shell fields remain populated as compatibility shims, but debug output should treat the scene-shell state as the source of truth.

Background systems now lean a little further toward physical coupling with the hero and hero-owned particles, but the support layer is still expected to stay subordinate. The goal is tactile response around the subject, not a busier wall of effects.

Hero-impact moments now push that coupling much harder, but only locally. When a motif or outro explicitly leans on the hero, nearby trail, burst, and residue particles are expected to shear, whip, and shove around the nearest hero strongly enough to read without turning the whole frame into a uniform storm.

Composition now biases harder against dead-center collapse. Off-axis hero placement is the default unless a shot grammar explicitly wants a centered establish or orbital read, and sparse frames are expected to gain hero-adjacent support before they gain more edge decoration.

Fallback composition now has two distinct meanings. `safety-recovery` is the normal light rebalance path for windows that need a little more support or a little less center pressure, while `fallback-composed` is reserved for severe recovery cases where the original composition would likely ship unreadably.

That boundary is tighter now. Moderate edge-dominance, sparse-center, and low-support windows are expected to spend their first recovery step on hero-adjacent support placement and background trimming before they escalate into full fallback composition. Reports should also keep fallback mode and fallback cause separate: mode answers how hard recovery had to intervene, while cause answers what structural problem forced that intervention.

Edge-dominance diagnostics are margin-based now instead of treating any bright edge as a failure. Reports should distinguish a genuinely dominant rim from a merely energetic border, and visible-fallback-risk warnings should only fire when the recovered frame is still plausibly unreadable.

Weak breakdown windows should also stay on the legibility side of the line. Low-confidence or sparse-center recovery windows should prefer stable or scan-like overlays over more aggressive pulse treatments that turn structural thinness into dim fog.

That same legibility rule now applies to recovery windows more generally. If a window is still structurally weak after composition rebalance, the renderer should bias toward `kinetic-scan` or `stable-feedback` and trim decorative edge-heavy effect work before it spends more budget on thin pulse or contour treatments.

Hero child rendering now includes a grounded pulse-ring class: a faint filled circle with a brighter outline that expands under the hero and fades quickly. It exists to reinforce impact and continuity beneath the hero, not to replace the main particle field.

Hero-emitted particles now support a conductor layer. A deterministic subset of hero-owned particles can coordinate nearby hero particles with BPM-locked local motion, but that coordination is intentionally local and subordinate to hero readability rather than a global swarm override.

That conductor layer now includes a nearest-hero revolve vocabulary. Perfect-ring vigilance, pass-through orrery motion, and spiral-braid procession all anchor to the nearest active hero rather than to a seed particle, and their radius, pull, and lifespan modulation scale deterministically with the current dB and hz drive.

Hero circle accents are sparser per scene now, with only a minority of eligible scene nodes allowed to emit those pulse-ring accents and with a softer filled interior so they read as continuity support instead of a default badge on every node.

That restraint is stronger again now. Shell-enabled scenes remain the minority, outer shell layers stay fainter than the inner layer, and the third shell lane should be the rarest and most conditional so shell stacks support continuity without replacing the hero.

Hero motifs now mix sub-emitter and non-sub-emitter spawn loci more often, and individual heroes can react to a broader effective band set even though render coloring still resolves through the existing low/mid/high affinity buckets.

Hero-emitted particle sizing is also slightly more compressed at the extremes. The smallest readable particles are lifted a touch and the largest are shaved back, preserving a broader legibility floor without flattening the whole field into sameness.

Single-hero scenes are allowed to spend more of their budget on local punctuation. Those windows can carry twice as many hero sub-emitter loci and denser node events so solitary heroes do not read as underpowered compared with clustered scenes.

The renderer now also has a distinct frame-post layer between base frame effects and transitions. That pass carries conservative, hero-subordinate treatments like CRT masking, chromatic impact splits, feedback tunnels, lens dirt, tunnel vision, palette inversion, resolution crashes, residue carry, and edge outlining without forcing those looks into outro-only logic.

That post layer now also carries explicit reflective coverage in sparse structural contexts. Intro and sparse-contour combinations are expected to have real mirror and kaleidoscopic post options available instead of falling through to a thin or empty surface.

Transitions still carry a wider structural vocabulary now. The transition system can route through voronoi shatter, mobius tunnel wrap, datamosh drag, resolution snapback, and snare-negative flips when the motif and regime justify it, while hero shells stay intentionally narrower so the stack reads as continuity support instead of a catalog sampler.

The reflection pass extends that vocabulary with bilateral iris folds, mirror-gate inversions, prism-axis lag, quad kaleido choirs, and reflection slit shatters, plus mirrored episode intents like catoptric duets, mirror processions, kaleido coronations, quad vigils, and prism tribunals. Those are meant to create readable mirrored entities, not just more center-stacked symmetry.

That reflective vocabulary is broader again now, especially in quadrant mirrors, zooming kaleidoscopes, prism folds, and mirror corridors. The renderer should reach those families through shared reflective grammars, not through a pile of one-off renderers that are hard to keep performant or legible.

Canvas-edge exits now also read as intentional punctuation. Particles that reach the visible frame boundary should take a short offscreen exit path and resolve through a deterministic generic destruction catalog, with diagnostics proving whether those exits actually happened and whether their distribution stayed varied.

Reflective language is now an intentional selector bias wherever the renderer is choosing from a genuine pool. Mirror, symmetry, and kaleidoscopic structures should recur more often across transitions, effects, and conductors, while forced safety paths still stay in control when continuity needs them.

Temporal restraint also has a tighter boundary now. Cataloged freeze-style outro effects are intentionally rarer, but low-dB hero freeze behavior and other non-outro motion holds still follow their own continuity logic instead of being globally weakened.

Audio-cooled transition windows can now produce stronger visible consequences. If dB or hz cooldown reduction makes a transition eligible earlier than it otherwise would have been, the renderer may deterministically promote a held image into a real swap and may also allow hero mutation instead of preserving the prior hero identity, but only when a newer scheduled image already exists.

That transition pressure is now signed instead of purely additive. Rising dB and hz can still help advance a handoff, but falling energy now lengthens the next transition rather than accidentally acting like more pressure, and outro windows refuse to start new transitions at all once an image is already established.

Audio-driven image promotion is also intentionally narrower now. Cooldown-driven source swaps only happen through a deterministic twenty-to-forty percent gate derived from recent held-stack pressure and node-local trigger history, so the system still reacts musically without turning every accelerated window into a source change.

Transition carry is now an explicit snapshot-first contract instead of an accidental side effect of stale state. The outgoing frame snapshot remains the continuity source that can pre-populate the next scene in a pleasing way, but particle-heavy transition grammars must degrade to snapshot-only carry whenever outgoing particle availability or bridge detail is too thin to support them safely.

That boundary is deliberate: preserve hero-led continuity and readable ghost/smear carry, but never assume an old particle pool is still valid just because a transition wants more texture. Diagnostics should report when carry stayed full versus when the renderer intentionally fell back to snapshot-only carry.

Those systems are now covered by direct deterministic tests instead of only catalog counts. Frame-post selection, conductor reachability, new particle motion families, and catalog-bias breadth all have explicit test coverage so later tuning can move visuals without silently dropping reachability.

Over-representation is still implemented catalog-first. Broader motif/regime/persistent-motif eligibility is the main lever, and `selectionWeight` only nudges tie-breaking after a concept is already broadly eligible.

Event cadence and attraction are both more assertive now. Background brightness has a higher minimum floor, attraction forces pull harder, and event triggering is materially more frequent, but all of that is still expected to support continuity instead of collapsing the frame into constant punctuation.

Diagnostics now report whether multi-hero scenes actually separated on screen, including overlap, lane diversity, readable separation, and likely collapse causes. That report is meant to explain why a mirror or independent scene still read as one merged mass when it fails.

Shot grammar variety now has stronger spatial consequences. Directional grammars are expected to choose directional hero primitives and lane-aware anchors, while orbital grammars can still preserve radial identity when the motif actually calls for it.

Satellite heroes now move with a clearer bias toward fluid continuity unless the seed is already meant to feel glitchy. Clean seeds should orbit with smoother local carry around their stage anchors, while glitch-biased seeds are allowed to keep stepped, jumpier satellite motion.

Hero motif continuity is now enforced on a separate schedule from source motif classification. Source motifs remain structural telemetry and still bias placement, background flavor, and effect selection, but the rendered hero motif is locked to deterministic time buckets: a bounded intro setup, one body change ceiling per 60 seconds, and a bounded outro lock. Variety inside a held slot should come from motif-authored primitive, shell, sub-emitter, transition, and overlay variation instead of frequent core-motif swaps.

Diagnostics now report both source motif and resolved hero motif, plus the scheduled hero motif slot metadata. When those diverge, that is treated as explicit telemetry truth rather than a hidden implementation detail, so cadence review can distinguish classifier noise from a real continuity failure.

## Design Rules

- Favor hero-led spectacle over background clutter.
- Fill the space around the hero with readable support when continuity thins out; avoid dead-center emptiness disguised as restraint.
- Keep transitions expressive but legible.
- Make debugging outputs explain what reduced legibility or motion continuity, not just how long a pass took.
- Preserve continuity across shots so variety feels curated instead of random.
- Use atmosphere and secondary systems to reinforce the motif, not compete with it.
- When variety increases, spend it on motif grammar, transition language, and composition bias before increasing support clutter.

## Related Docs

- [../README.md](../README.md)
- [../media/README.md](../media/README.md)
- [../perf/README.md](../perf/README.md)
- [HERO_VARIANTS.md](HERO_VARIANTS.md)
- [spawn-rules/README.md](spawn-rules/README.md)
- [../../test/README.md](../../test/README.md)
