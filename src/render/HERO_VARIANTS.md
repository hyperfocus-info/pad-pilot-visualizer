# Hero Variants and Particle/Post-Effect Options

## Purpose

Concise inventory of hero-side variation in the renderer: what can vary, what particle outputs each variant can produce, and which post-processing effect families are available.

## Variant Layers (High-Level)

- Fractal motif variants: `12`
  - `neon-tube`, `smoke-ribbon`, `glass-orbital`, `cathedral-filament`, `halo-cell`, `shattered-arc`, `mandelbloom`, `data-cathedral`, `chromatic-xylem`, `vector-incantation`, `harmonic-lattice`, `film-bloom-shard`
- Hero archetypes: `8`
  - `oracle-mask`, `electric-seraph`, `corridor-witness`, `ritual-engine`, `fractured-rider`, `petal-devourer`, `laughing-mandala`, `void-guitarist`
- Hero emission modes: `6`
  - `breath`, `crown-spray`, `spine-fountain`, `orbit-shed`, `mouth-flare`, `hand-cascade`
- Sub-emitter modes: `5`
  - `petal-shed`, `spark-fork`, `echo-ring`, `mask-fracture`, `dust-afterimage`
- Hero post-shell modes: `9`
  - `soft-halo`, `shock-ring`, `heat-smear`, `petal-shell`, `electric-shell`, `monolith-extrude`, `wire-solid-flip`, `hinge-bloom`, `none`

## What Particles Hero Variants Can Spawn

### 1) Direct Hero Emission (always appended)

| Hero emission mode | Spawn behavior mode | Shape | Primary purpose |
| --- | --- | --- | --- |
| `breath` | `emit-chain` | `ring` | `hero-wake` |
| `crown-spray` | `emit-chain` | `arc` | `hero-wake` |
| `spine-fountain` | `emit-chain` | `ring` | `hero-wake` |
| `orbit-shed` | `emit-chain` | `arc` | `hero-wake` |
| `mouth-flare` | `release-bloom` | `shard` | `burst-remnant` |
| `hand-cascade` | `emit-chain` | `chevron` | `hero-wake` |

### 2) Sub-Emitter Add-ons

- `echo-ring` adds an explicit extra hero behavior:
  - mode: `orbit-hero`
  - shape: `ring`
  - purpose: `ritual-ring`
- `echo-ring` now also tends to unlock `shell-bounce` ring behavior around the hero shell.
- `spark-fork` and `mask-fracture` can now bias into `plexus-link` support paths.
- Other sub-emitter modes (`petal-shed`, `spark-fork`, `mask-fracture`, `dust-afterimage`) do not append a fixed extra behavior in the same direct way, but they still affect sub-emitter variant identity and downstream sub-emitter child patterns.

### 3) Motif/Primitive Sub-Emitter Family Bias (shape-family outcomes)

- `smoke-ribbon`: prefers `teardrop` or `arc-haze`
- `shattered-arc`: prefers `pulse-shard` or `shard`
- `harmonic-lattice` / `data-cathedral`: prefers `hexagon` or `braid-marker`
- `glass-orbital`: prefers `ring` or `glint`
- Fallback by hero primitive family:
  - directional (`diamond`, `kite`) -> `diamond`
  - pointed (`chevron`, `arrow`) -> `chevron`
  - orbital (`ring`, `arc`, `sector`, `moon`) -> `arc`
  - star-like (`star`, `hexagram`, `asterisk`) -> `star`
  - organic (`heart`, `teardrop`, `cloud`) -> `teardrop`
  - polygonal (`hexagon`, `pentagon`, `octagon`) -> `hexagon`
  - default -> `glint`

### 4) Additional Episode-Driven Particle Spawns

- Accent mode `emitters` adds support-layer `emit-chain` + `arc`
- Accent mode `absorbers` adds support-layer `absorb-well` + `ring`
- Accent mode `burst-gate` or `petal-explosion` adds background `release-bloom` + `shard`

### 5) New Over-Represented Particle Families

- Swarm / field motion: `flock-curl`, `flow-advect`, `gravity-orrery`
- Network / latch motion: `plexus-link`, `lightning-latch`
- Hero trail / lifecycle motion: `ribbon-trace`, `lifecycle-morph`, `shell-bounce`
- Depth / residue motion: `voxel-depth`, `paint-residue`
- These are now reachable from motif routing, hero emission routing, and sub-emitter routing instead of living behind a single narrow trigger.

## Archetype Defaults (before episode overrides)

| Archetype | Default emission | Default sub-emitter |
| --- | --- | --- |
| `oracle-mask` | `breath` | `echo-ring` |
| `electric-seraph` | `crown-spray` | `dust-afterimage` |
| `corridor-witness` | `hand-cascade` | `echo-ring` |
| `ritual-engine` | `orbit-shed` | `mask-fracture` |
| `fractured-rider` | `mouth-flare` | `spark-fork` |
| `petal-devourer` | `breath` | `petal-shed` |
| `laughing-mandala` | `orbit-shed` | `dust-afterimage` |
| `void-guitarist` | `spine-fountain` | `dust-afterimage` |

Episode intent can hard-override these defaults (for example `mirror-sermon`, `electric-funeral`, `desert-revelation`, `neon-bardo`).

## Post-Processing Effect Diversity

### Hero-local post shell

- `soft-halo`, `shock-ring`, `heat-smear`, `petal-shell`, `electric-shell`, `monolith-extrude`, `wire-solid-flip`, `hinge-bloom`, `none`
- Selected from hero primitive, motif, and intent.

### General frame-post pass

- Frame post effect IDs: `15`
- Includes `canvas-smear-residue`, `pressure-grid-plane`, `bass-monolith-extrude`, `mobius-tunnel-wrap`, `hard-pixel-lock`, `impact-chromatic-aberration`, `uv-feedback-tunnel`, `datamosh-vector-drag`, `crt-phosphor-mask`, `godray-bloom-shaft`, `tunnel-vision-pulse`, `sobel-ink-outline`, `resolution-crash-snapback`, `palette-inversion-snare`, `lens-dirt-specular`
- This pass runs after base frame effects and before transitions.

### Overlay regimes

- `stable-feedback`, `pulse-wave`, `kinetic-scan`, `climax-burst`, `sparse-contour`

### Transition families

- Total transition families: `77`
- Includes practical cuts/dynamics (`carry`, `compress`, `flash`, `wipe`, `melt-safe`)
- Includes cinematic camera styles (`dolly-in`, `dolly-out`, `whip-pan-x`, `whip-pan-y`, `crash-zoom`, `parallax-slide`)
- Includes new structural/glitch styles (`voronoi-drop-shatter`, `wire-solid-phase-cut`, `mobius-wrap-tunnel`, `datamosh-vector-drag`, `resolution-crash-snapback`, `snare-negative-flip`)
- Includes kaleido/psychedelic/post styles (`trip-kaleido`, `shear-kaleido`, `color-shift-kaleidoscope-burst`, `quantum-realm-warp`, `ethereal-particle-drift`, `barlog-continuous-camera-particle-sweep`, etc.)

### Motif-scoped effects

- Motif effect IDs: `25` (for example `lorentz-drift`, `vortex-shear`, `caustic-lensing`, `brittle-fracture`, `prism-ghosting`)
- Audio coupling modes: `static`, `db5-reactive`, `bpm-db5-reactive`
- Hero coupling modes: `none`, `particles-only`, `rare-warp`

### Outro effects

- Outro effect IDs: `50`
- Categories include: `desaturate`, `fade`, `glitch`, `hero-movement`, `rainbow`, `black-hole`, `analog`, `tv-static`, `camera-flare-pan`, `time-play`
- Audio coupling: `bpm-locked`, `bpm-db-reactive`, `bpm-db-pulse-gated`

## Boundary Notes

- This is a diversity map, not a frame-by-frame guarantee.
- Runtime composition, motif profile, episode intent, and safety gates still decide which options are active in a given shot.
- The expanded systems now have deterministic tests for frame-post selection, conductor reachability, particle motion integration, and catalog-bias breadth.
- Over-representation is still driven by broad eligibility surfaces first; `selectionWeight` is only a mild tie-breaker.
- Several features remain intentionally approximate:
  - fluid behavior uses bounded advection and curl noise, not full simulation
  - datamosh is a deterministic block-drag/feedback aesthetic, not codec corruption
  - voxel depth is pseudo-3D layering, not volumetric rendering
