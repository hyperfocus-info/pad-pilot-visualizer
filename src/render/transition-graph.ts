import { clamp } from "../config";
import type { HeroPathPoint, SceneGraph, TransitionBridgeState, TransitionDeterministicParams, TransitionFamily, TransitionGraph } from "../types";
import { deriveSeed, pickIndex, seedToUnitFloat, stableHash32 } from "./seed-utils";

function tangent(a: HeroPathPoint, b: HeroPathPoint): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

export function transitionGraphKey(fromImagePath: string, toImagePath: string): string {
  return `${fromImagePath}::${toImagePath}`;
}

export function buildTransitionGraph(from: SceneGraph, to: SceneGraph, bridge: TransitionBridgeState, family: TransitionFamily = "carry"): TransitionGraph {
  const count = Math.max(from.heroPath.length, to.heroPath.length, 4);
  const deterministicParams = buildTransitionDeterministicParams(from, to, family);
  const familyGrammar =
    family === "spiral-carry" ? "spiral" :
    family === "orbital-shear" ? "orbital-shear" :
    family === "phase-lattice" ? "phase-lattice" :
    family === "ribbon-fold" ? "ribbon-fold" :
    family === "axis-swap" ? "axis-swap" :
    family === "chorus-drift" ? "chorus-drift" :
    family === "mirror-kaleido" ? "mirror-kaleido" :
    family === "split-mirror" ? "split-mirror" :
    family === "bilateral-iris-fold" ? "split-mirror" :
    family === "mirror-gate-inversion" ? "mirror-kaleido" :
    family === "prism-axis-lag" ? "prism-fold" :
    family === "quad-kaleido-choir" ? "mirror-kaleido" :
    family === "reflection-slit-shatter" ? "shear-kaleido" :
    family === "quadrant-mirror-sweep" ? "split-mirror" :
    family === "micro-quadrant-reflect" ? "split-mirror" :
    family === "centrifugal-hex-mirror" ? "mirror-kaleido" :
    family === "octant-mirror-zoom" ? "shear-kaleido" :
    family === "mirror-grid-dissolve" ? "split-mirror" :
    family === "kaleido-iris-zoom" ? "mirror-kaleido" :
    family === "kaleido-tunnel-zoom" ? "mirror-tunnel" :
    family === "snowflake-kaleido-bloom" ? "mirror-kaleido" :
    family === "infinite-reflection-zoom" ? "mirror-tunnel" :
    family === "facet-zoom-reveal" ? "shear-kaleido" :
    family === "tri-prism-fold" ? "prism-fold" :
    family === "hex-prism-cascade" ? "prism-fold" :
    family === "refractive-prism-spin" ? "prism-fold" :
    family === "prismatic-radial-wipe" ? "prism-fold" :
    family === "refractive-shard-tumble" ? "prism-fold" :
    family === "mirror-interlock-weave" ? "split-mirror" :
    family === "corridor-reflection-transit" ? "split-mirror" :
    family === "bilateral-flip-drift" ? "split-mirror" :
    family === "synchronized-mirror-slice" ? "split-mirror" :
    family === "glass-shatter-reflect" ? "split-mirror" :
    family === "diamond-concentric-fold" ? "split-mirror" :
    family === "vortex-mirror-spiral" ? "mirror-kaleido" :
    family === "geometric-fractal-flip" ? "mirror-kaleido" :
    family === "symmetry-spin-reveal" ? "mirror-kaleido" :
    family === "crystal-facet-reveal" ? "prism-fold" :
    family === "prism-fold" ? "prism-fold" :
    family === "shear-kaleido" ? "shear-kaleido" :
    family === "halo-drift" ? "halo-drift" :
    family === "veil-shift" ? "veil-shift" :
    family === "echo-fold" ? "echo-fold" :
    family === "lattice-breath" ? "lattice-breath" :
    family === "phase-ghost" ? "phase-ghost" :
    family === "dolly-in" || family === "dolly-out" || family === "crash-zoom" || family === "snap-zoom-out" || family === "resolution-crash-snapback" ? "camera-axial-push" :
    family === "whip-pan-x" || family === "whip-pan-y" ? "camera-whip" :
    family === "handheld-lurch" || family === "tilt-reframe" ? "camera-handheld" :
    family === "roll-sway" ? "camera-roll" :
    family === "parallax-slide" ? "camera-parallax" :
    family === "fractal-tunnel" || family === "mandala-pulse" || family === "mobius-wrap-tunnel" ? "psychedelic-tunnel" :
    family === "solarize-drift" || family === "chroma-smear" || family === "snare-negative-flip" ? "psychedelic-solarize" :
    family === "acid-fold" || family === "ink-melt" || family === "liquid-lens" ? "psychedelic-melt" :
    family === "strobe-bloom" ? "psychedelic-strobe" :
    family === "afterimage-wheel" || family === "trip-kaleido" ? "psychedelic-kaleido" :
    family === "fractal-mirror-shatter" || family === "kon-reality-shatter-match-cut" || family === "voronoi-drop-shatter" ? "fracture-mirror" :
    family === "chromatic-mandala-spin" || family === "color-shift-kaleidoscope-burst" || family === "floyd-dark-side-prism-dispersal" ? "chromatic-mandala" :
    family === "neon-radial-implosion" || family === "supernova-glare-reveal" || family === "deep-space-flare-transition" ? "radial-implosion" :
    family === "prismatic-vortex-swirl" || family === "acid-wash-tunnel" || family === "quantum-realm-warp" || family === "kubrick-slit-scan-star-gate" ? "vortex-tunnel" :
    family === "hallucinogenic-hex-grid" || family === "moore-nine-panel-particle-grid" ? "grid-panel" :
    family === "trippy-symmetry-ripple" || family === "psychedelic-pinwheel-dissolve" || family === "wire-solid-phase-cut" ? "symmetry-ripple" :
    family === "cosmic-dust-dispersion" || family === "nebula-cloud-crossfade" || family === "ethereal-particle-drift" || family === "galactic-smoke-sweep" || family === "interstellar-light-bleed" ? "cosmic-dispersion" :
    family === "wright-whip-pan-particle-smear" || family === "barlog-continuous-camera-particle-sweep" ? "camera-particle-sweep" :
    family === "kojima-tactical-glitch-noise" || family === "datamosh-vector-drag" ? "glitch-noise" :
    family === "gilligan-time-lapse-particle-sand" ? "particle-sand" :
    family === "joyce-fluid-text-morph" || family === "danielewski-house-typographic-distortion" ? "glyph-distortion" :
    family;
  const heroBridge: HeroPathPoint[] = Array.from({ length: count }, (_, index) => {
    const fromPoint = from.heroPath[index % from.heroPath.length] ?? from.heroPath[0]!;
    const toPoint = to.heroPath[index % to.heroPath.length] ?? to.heroPath[0]!;
    const t = 0.5;
    const phase = index / Math.max(1, count - 1);
    const spiralOffset = (family === "spiral-carry" || family === "fractal-tunnel" || family === "mandala-pulse" || family === "quad-kaleido-choir") ? Math.sin(phase * Math.PI * 2) * Math.min(bridge.heroFrom.radius, bridge.heroTo.radius) * 0.18 : 0;
    const ribbonOffset = (family === "ribbon-fold" || family === "acid-fold" || family === "ink-melt" || family === "bilateral-iris-fold") ? Math.sin(phase * Math.PI) * bridge.heroFrom.radius * 0.12 : 0;
    const axisOffsetX = family === "axis-swap" || family === "prism-axis-lag" ? (bridge.heroTo.y - bridge.heroFrom.y) * 0.08 : 0;
    const axisOffsetY = family === "axis-swap" || family === "prism-axis-lag" ? (bridge.heroFrom.x - bridge.heroTo.x) * 0.08 : 0;
    const cameraOffsetX =
      family === "whip-pan-x" || family === "parallax-slide"
        ? dirX(fromPoint, toPoint) * bridge.heroFrom.radius * 0.1
        : 0;
    const cameraOffsetY =
      family === "whip-pan-y" || family === "tilt-reframe"
        ? dirY(fromPoint, toPoint) * bridge.heroFrom.radius * 0.1
        : 0;
    const midX = fromPoint.x + (toPoint.x - fromPoint.x) * t + dirX(fromPoint, toPoint) * ribbonOffset + axisOffsetX + cameraOffsetX;
    const midY = fromPoint.y + (toPoint.y - fromPoint.y) * t + dirY(fromPoint, toPoint) * spiralOffset + axisOffsetY + cameraOffsetY;
    const nextX = fromPoint.x + (toPoint.x - fromPoint.x) * 0.65;
    const nextY = fromPoint.y + (toPoint.y - fromPoint.y) * 0.65;
    const dir = tangent({ ...fromPoint, x: midX, y: midY }, { ...toPoint, x: nextX, y: nextY });
    return {
      x: midX,
      y: midY,
      tangentX: dir.x,
      tangentY: dir.y,
      radius: fromPoint.radius + (toPoint.radius - fromPoint.radius) * 0.5,
    };
  });
  const pairCount = Math.max(bridge.supportFrom.length, bridge.supportTo.length);
  const supportPairs = Array.from({ length: pairCount }, (_, index) => ({
    from: bridge.supportFrom[index % Math.max(1, bridge.supportFrom.length)] ?? bridge.supportTo[index % Math.max(1, bridge.supportTo.length)]!,
    to: bridge.supportTo[index % Math.max(1, bridge.supportTo.length)] ?? bridge.supportFrom[index % Math.max(1, bridge.supportFrom.length)]!,
  }));
  const heroDistance = Math.hypot(bridge.heroTo.x - bridge.heroFrom.x, bridge.heroTo.y - bridge.heroFrom.y);
  const normalizedDistance = heroDistance / Math.max(1, Math.max(bridge.heroFrom.radius, bridge.heroTo.radius) * 6);
  const carryAttenuation = clamp(
      (family === "chorus-drift" || family === "halo-drift" || family === "echo-fold" || family === "bilateral-iris-fold" || family === "mirror-gate-inversion" ? 0.92 : family === "phase-lattice" || family === "lattice-breath" || family === "prism-axis-lag" ? 0.82 : family === "dolly-in" || family === "dolly-out" || family === "parallax-slide" ? 0.86 : 1) * (1 - normalizedDistance * 0.45),
    0.32,
    0.92,
  );
  return {
    key: transitionGraphKey(from.imagePath, to.imagePath),
    fromImagePath: from.imagePath,
    toImagePath: to.imagePath,
    heroBridge,
    supportPairs,
    glyphBlend: {
      from: from.heroGlyphs,
      to: to.heroGlyphs,
    },
    carryAttenuation,
    morphBias: clamp(
      (bridge.carryStrength * (family === "orbital-shear" ? 0.62 : family === "phase-lattice" || family === "lattice-breath" || family === "prism-axis-lag" ? 0.84 : family === "phase-ghost" ? 0.8 : family === "parallax-slide" || family === "dolly-in" || family === "dolly-out" ? 0.78 : 0.7)) +
      (1 - normalizedDistance) * (family === "ribbon-fold" || family === "echo-fold" || family === "liquid-lens" || family === "bilateral-iris-fold" || family === "reflection-slit-shatter" ? 0.4 : 0.3),
      0.28,
      0.94,
    ),
    motionGrammar: familyGrammar,
    accentCarry: from.episodeSeed.accentModes[0] ?? to.episodeSeed.accentModes[0],
    deterministicParams,
  };
}

function buildTransitionDeterministicParams(from: SceneGraph, to: SceneGraph, family: TransitionFamily): TransitionDeterministicParams {
  const variant = stableHash32(`${from.imagePath}|${to.imagePath}|${family}|${to.heroMotifProfile.key}|${to.episodeSeed.episodeIntent}`);
  const bias = to.heroMotifProfile.transitionBias;
  const sliceSeed = deriveSeed(variant, "slice-count");
  const thicknessSeed = deriveSeed(variant, "slice-thickness");
  const mirrorSeed = deriveSeed(variant, "mirror-count");
  const warpSeed = deriveSeed(variant, "warp-amplitude");
  const rotationSeed = deriveSeed(variant, "rotation-amount");
  const radialSeed = deriveSeed(variant, "radial-slices");
  const noiseSeed = deriveSeed(variant, "noise-band");
  const panelColsSeed = deriveSeed(variant, "panel-grid-cols");
  const panelRowsSeed = deriveSeed(variant, "panel-grid-rows");
  return {
    variant,
    sliceCount: Math.max(3, 4 + pickIndex(sliceSeed, 6) + Math.round(bias.symmetry * 4)),
    sliceThickness: 18 + pickIndex(thicknessSeed, 24) + Math.round((1 - bias.widthBias) * 14),
    mirrorCount: Math.max(2, 2 + pickIndex(mirrorSeed, 3) + Math.round(bias.symmetry * 2)),
    warpAmplitude: 10 + Math.round(bias.warpiness * 42) + pickIndex(warpSeed, 9),
    rotationAmount: 0.04 + bias.warpiness * 0.18 + seedToUnitFloat(rotationSeed) * 0.04,
    travelPx: 36 + Math.round(bias.disruption * 90) + Math.round((1 - bias.widthBias) * 24),
    flashAlphaScale: clamp(
      family === "halo-drift" || family === "veil-shift" || family === "echo-fold" || family === "lattice-breath" || family === "phase-ghost" || family === "liquid-lens" || family === "parallax-slide"
        ? 0.42 + bias.potencyBias * 0.06
        : 0.8 + bias.potencyBias * 0.04,
      family === "halo-drift" || family === "veil-shift" || family === "echo-fold" || family === "lattice-breath" || family === "phase-ghost" || family === "liquid-lens" || family === "parallax-slide" ? 0.42 : 0.8,
      family === "halo-drift" || family === "veil-shift" || family === "echo-fold" || family === "lattice-breath" || family === "phase-ghost" || family === "liquid-lens" || family === "parallax-slide" ? 0.56 : 0.84,
    ),
    radialSliceCount: 6 + pickIndex(radialSeed, 10),
    noiseBand: 0.08 + seedToUnitFloat(noiseSeed) * 0.105,
    dispersionBias: clamp(0.3 + bias.disruption * 0.5, 0.3, 0.92),
    tunnelDepth: 0.8 + bias.warpiness * 1.6,
    panelGridCols: Math.max(2, 2 + pickIndex(panelColsSeed, 4)),
    panelGridRows: Math.max(2, 2 + pickIndex(panelRowsSeed, 4)),
  };
}

function dirX(a: HeroPathPoint, b: HeroPathPoint): number {
  const t = tangent(a, b);
  return t.x;
}

function dirY(a: HeroPathPoint, b: HeroPathPoint): number {
  const t = tangent(a, b);
  return t.y;
}
