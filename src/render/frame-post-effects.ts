import { clamp } from "../config";
import type {
  ActiveSubjectSnapshot,
  AudioFrameFeature,
  EdgeMap,
  FramePostEffectAudioMode,
  FramePostEffectId,
  FramePostEffectSpec,
  FramePostEffectState,
  PersistentMotifState,
  RenderQualityBudget,
  RenderTheme,
  SceneGraph,
  SelectionTag,
  VisualState,
} from "../types";
import { paletteColor } from "./palette";

const REFLECTIVE_FRAME_POST_EFFECTS = new Set<FramePostEffectId>([
  "mirror-kaleido-lattice",
  "prism-axis-echo",
]);

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function spec(
  id: FramePostEffectId,
  motifs: Array<EdgeMap["fractalMotif"] | "wildcard">,
  preferredRegimes: FramePostEffectSpec["preferredRegimes"],
  preferredOverlayModes: FramePostEffectSpec["preferredOverlayModes"],
  preferredPersistentMotifs: FramePostEffectSpec["preferredPersistentMotifs"],
  audioMode: FramePostEffectAudioMode,
  blendMode: FramePostEffectSpec["blendMode"],
): FramePostEffectSpec {
  const selectionTags: SelectionTag[] = [];
  if (REFLECTIVE_FRAME_POST_EFFECTS.has(id)) {
    selectionTags.push("reflective");
  }
  return {
    id,
    motifs,
    preferredRegimes,
    preferredOverlayModes,
    preferredPersistentMotifs,
    audioMode,
    blendMode,
    selectionWeight: 1.25,
    intensityFloor: 0.08,
    intensityCeiling: 0.9,
    selectionTags,
  };
}

function weightedPick<T extends { id: string }>(
  entries: readonly T[],
  hashSeed: string,
  weightFor: (entry: T) => number,
): T {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const totalWeight = sorted.reduce((sum, entry) => sum + Math.max(0, weightFor(entry)), 0);
  if (totalWeight <= 0) {
    return sorted[stableHash(hashSeed) % Math.max(1, sorted.length)]!;
  }
  let cursor = stableHash(hashSeed) % Math.max(1, Math.ceil(totalWeight * 1000));
  for (const entry of sorted) {
    cursor -= Math.max(1, Math.round(Math.max(0, weightFor(entry)) * 1000));
    if (cursor < 0) {
      return entry;
    }
  }
  return sorted[sorted.length - 1]!;
}

export const FRAME_POST_EFFECT_SPECS: FramePostEffectSpec[] = [
  spec("canvas-smear-residue", ["smoke-ribbon", "film-bloom-shard", "chromatic-xylem", "wildcard"], ["groove", "build", "breakdown"], ["stable-feedback", "pulse-wave"], ["non-linear-stream-consciousness-tracking", "continuous-one-shot-temporal-shifts"], "db-reactive", "screen"),
  spec("pressure-grid-plane", ["harmonic-lattice", "data-cathedral", "vector-incantation", "neon-tube"], ["groove", "build", "drop"], ["kinetic-scan", "stable-feedback"], ["symmetrical-fourth-wall-glitches", "metatextual-surveillance-perspectives"], "db-reactive", "overlay"),
  spec("bass-monolith-extrude", ["data-cathedral", "cathedral-filament", "shattered-arc", "wildcard"], ["build", "drop"], ["climax-burst", "kinetic-scan"], ["architectural-time-lapse-hyperdetail"], "pulse-gated", "screen"),
  spec("mobius-tunnel-wrap", ["glass-orbital", "mandelbloom", "halo-cell", "smoke-ribbon"], ["build", "drop", "outro"], ["stable-feedback", "pulse-wave"], ["cosmic-neon-descent", "rhythm-driven-reality-metamorphosis"], "phrase-gated", "screen"),
  spec("mirror-kaleido-lattice", ["smoke-ribbon", "chromatic-xylem", "cathedral-filament", "glass-orbital", "halo-cell", "mandelbloom"], ["intro", "breakdown", "outro"], ["sparse-contour", "stable-feedback"], ["continuous-one-shot-temporal-shifts", "cosmic-neon-descent"], "phrase-gated", "screen"),
  spec("prism-axis-echo", ["smoke-ribbon", "chromatic-xylem", "cathedral-filament", "glass-orbital", "halo-cell", "mandelbloom", "vector-incantation", "shattered-arc"], ["intro", "breakdown", "outro"], ["sparse-contour", "stable-feedback", "pulse-wave"], ["symmetrical-fourth-wall-glitches", "continuous-one-shot-temporal-shifts"], "db-reactive", "screen"),
  spec("hard-pixel-lock", ["neon-tube", "shattered-arc", "harmonic-lattice", "film-bloom-shard"], ["drop", "build"], ["kinetic-scan", "sparse-contour"], ["audio-synced-whip-pan-hallucinations"], "pulse-gated", "overlay"),
  spec("impact-chromatic-aberration", ["shattered-arc", "film-bloom-shard", "neon-tube", "chromatic-xylem"], ["build", "drop"], ["kinetic-scan", "climax-burst"], ["audio-synced-whip-pan-hallucinations", "comic-panel-nested-realities"], "pulse-gated", "screen"),
  spec("uv-feedback-tunnel", ["smoke-ribbon", "glass-orbital", "mandelbloom", "wildcard"], ["groove", "build", "outro"], ["stable-feedback", "pulse-wave"], ["continuous-one-shot-temporal-shifts", "cosmic-neon-descent"], "db-reactive", "screen"),
  spec("datamosh-vector-drag", ["data-cathedral", "film-bloom-shard", "vector-incantation", "neon-tube"], ["build", "drop"], ["kinetic-scan", "stable-feedback"], ["symmetrical-fourth-wall-glitches", "metatextual-surveillance-perspectives"], "db-reactive", "difference"),
  spec("crt-phosphor-mask", ["neon-tube", "harmonic-lattice", "film-bloom-shard", "data-cathedral"], ["groove", "build", "outro"], ["kinetic-scan", "sparse-contour"], ["metatextual-surveillance-perspectives", "symmetrical-fourth-wall-glitches"], "static", "overlay"),
  spec("godray-bloom-shaft", ["glass-orbital", "halo-cell", "cathedral-filament", "mandelbloom"], ["build", "drop", "outro"], ["climax-burst", "pulse-wave"], ["cosmic-neon-descent", "continuous-one-shot-temporal-shifts"], "db-reactive", "screen"),
  spec("tunnel-vision-pulse", ["shattered-arc", "neon-tube", "mandelbloom", "wildcard"], ["drop", "build"], ["kinetic-scan", "climax-burst"], ["audio-synced-whip-pan-hallucinations"], "pulse-gated", "multiply"),
  spec("sobel-ink-outline", ["vector-incantation", "harmonic-lattice", "data-cathedral", "cathedral-filament"], ["groove", "build", "breakdown"], ["sparse-contour", "stable-feedback"], ["typographic-labyrinth-dreams", "architectural-time-lapse-hyperdetail"], "db-reactive", "overlay"),
  spec("resolution-crash-snapback", ["shattered-arc", "film-bloom-shard", "neon-tube", "wildcard"], ["drop", "build"], ["kinetic-scan", "climax-burst"], ["comic-panel-nested-realities"], "pulse-gated", "overlay"),
  spec("palette-inversion-snare", ["shattered-arc", "mandelbloom", "vector-incantation", "neon-tube"], ["build", "drop"], ["kinetic-scan", "climax-burst"], ["comic-panel-nested-realities", "audio-synced-whip-pan-hallucinations"], "pulse-gated", "difference"),
  spec("lens-dirt-specular", ["glass-orbital", "halo-cell", "smoke-ribbon", "film-bloom-shard"], ["groove", "outro", "breakdown"], ["stable-feedback", "pulse-wave"], ["continuous-one-shot-temporal-shifts"], "static", "screen"),
];

export function selectFramePostEffect(params: {
  edgeMap: EdgeMap;
  visualState: VisualState;
  theme: RenderTheme;
  persistentMotif?: PersistentMotifState;
  previousEffectId?: FramePostEffectId;
}): FramePostEffectSpec {
  const { edgeMap, visualState, theme, persistentMotif, previousEffectId } = params;
  const motifPool = FRAME_POST_EFFECT_SPECS.filter((entry) =>
    entry.motifs.includes(edgeMap.fractalMotif) || entry.motifs.includes("wildcard"),
  );
  const pool = motifPool.filter((entry) =>
    entry.preferredRegimes.includes(visualState.regime) || entry.preferredOverlayModes.includes(visualState.overlayMode),
  );
  const basePool =
    pool.length > 0
      ? pool
      : motifPool.length > 0
        ? motifPool
        : FRAME_POST_EFFECT_SPECS;
  const filtered = previousEffectId && basePool.length > 1 ? basePool.filter((entry) => entry.id !== previousEffectId) : basePool;
  const weightedPool = filtered.length > 0 ? filtered : basePool;
  const hashSeed = `${edgeMap.fractalMotif}|${visualState.regime}|${visualState.overlayMode}|${theme.styleProfile.imagePath}|${persistentMotif?.id ?? "none"}`;
  return weightedPick(weightedPool, hashSeed, (entry) => {
    const overlayBoost = entry.preferredOverlayModes.includes(visualState.overlayMode) ? 1.8 : 1;
    const persistentBoost = persistentMotif && entry.preferredPersistentMotifs.includes(persistentMotif.id) ? 3 : 1;
    const reflectiveBias = entry.selectionTags?.includes("reflective") ? 1.5 : 1;
    return entry.selectionWeight * overlayBoost * persistentBoost * reflectiveBias;
  });
}

export function evaluateFramePostEffectState(params: {
  frame: AudioFrameFeature;
  spec: FramePostEffectSpec;
}): FramePostEffectState {
  const { frame, spec } = params;
  const pulse = frame.beatPulse * 0.36 + (frame.barPulse ?? 0) * 0.24 + (frame.phrasePulse ?? 0) * 0.18;
  const db = frame.dbNormalized * 0.42 + frame.peakStrength * 0.28 + frame.motionEnergy * 0.2;
  const intensity =
    spec.audioMode === "static"
      ? clamp(spec.intensityFloor + pulse * 0.3, spec.intensityFloor, spec.intensityCeiling * 0.6)
      : spec.audioMode === "pulse-gated"
        ? clamp(spec.intensityFloor + pulse * 0.75 + (frame.isBeatAccent ? 0.18 : 0), spec.intensityFloor, spec.intensityCeiling)
        : spec.audioMode === "phrase-gated"
          ? clamp(spec.intensityFloor + (frame.phrasePulse ?? 0) * 0.72 + db * 0.18, spec.intensityFloor, spec.intensityCeiling)
          : clamp(spec.intensityFloor + db * 0.78, spec.intensityFloor, spec.intensityCeiling);
  return {
    id: spec.id,
    intensity,
    phase: ((frame.timeSec * 0.7) % 1 + 1) % 1,
    overlayOpacityEstimate: clamp(intensity * 0.28, 0.04, 0.24),
    effectVisiblePixelRatioEstimate: clamp(intensity * 0.52, 0.08, 0.4),
  };
}

export function renderFramePostEffect(params: {
  ctx: CanvasRenderingContext2D;
  scratchCtx: CanvasRenderingContext2D;
  sourceCanvas: any;
  width: number;
  height: number;
  frame: AudioFrameFeature;
  spec: FramePostEffectSpec;
  state: FramePostEffectState;
  activeSubject?: ActiveSubjectSnapshot;
  sceneGraph: SceneGraph;
  theme: RenderTheme;
  qualityBudget: RenderQualityBudget;
}): FramePostEffectState {
  const { ctx, scratchCtx, sourceCanvas, width, height, frame, spec, state, activeSubject, theme, qualityBudget } = params;
  if (qualityBudget.skipOverlayExtras && state.intensity < 0.2) {
    return state;
  }
  const cx = activeSubject?.x ?? width * 0.5;
  const cy = activeSubject?.y ?? height * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = spec.blendMode;
  switch (spec.id) {
    case "mirror-kaleido-lattice": {
      ctx.globalAlpha = state.intensity * 0.22;
      ctx.strokeStyle = paletteColor(theme, (state.phase + 0.08) % 1, 0.18, 12);
      ctx.lineWidth = 1.2 + state.intensity * 2.4;
      const maxRadius = Math.min(width, height) * (0.18 + state.intensity * 0.2);
      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8 + state.phase * Math.PI * 0.3;
        const innerRadius = maxRadius * (0.18 + (index % 3) * 0.08);
        const outerRadius = maxRadius * (0.62 + (index % 2) * 0.12);
        const x1 = cx + Math.cos(angle) * innerRadius;
        const y1 = cy + Math.sin(angle) * innerRadius;
        const x2 = cx + Math.cos(angle) * outerRadius;
        const y2 = cy + Math.sin(angle) * outerRadius;
        const mx1 = cx - (x1 - cx);
        const my1 = y1;
        const mx2 = cx - (x2 - cx);
        const my2 = y2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.moveTo(mx1, my1);
        ctx.lineTo(mx2, my2);
        ctx.stroke();
        ctx.fillStyle = paletteColor(theme, (state.phase + index * 0.07) % 1, 0.08 + state.intensity * 0.06, 8);
        ctx.fillRect(x2 - 2, y2 - 2, 4, 4);
        ctx.fillRect(mx2 - 2, my2 - 2, 4, 4);
      }
      break;
    }
    case "prism-axis-echo": {
      ctx.globalAlpha = state.intensity * 0.18;
      const bandHeight = Math.max(10, Math.round(height * 0.045));
      for (let index = 0; index < 7; index += 1) {
        const y = ((index + 1) * height) / 8;
        const halfWidth = width * (0.08 + ((index % 3) + 1) * 0.06 + state.intensity * 0.08);
        const drift = Math.sin(state.phase * Math.PI * 2 + index * 0.7) * width * 0.03 * state.intensity;
        ctx.fillStyle = paletteColor(theme, (state.phase + index * 0.05) % 1, 0.08 + state.intensity * 0.08, 10);
        ctx.fillRect(cx + drift, y - bandHeight * 0.5, halfWidth, bandHeight);
        ctx.fillRect(cx - drift - halfWidth, y - bandHeight * 0.5, halfWidth, bandHeight);
        ctx.strokeStyle = paletteColor(theme, (state.phase + 0.2 + index * 0.04) % 1, 0.12, 14);
        ctx.lineWidth = 1 + state.intensity * 1.8;
        ctx.beginPath();
        ctx.moveTo(cx + drift, y);
        ctx.lineTo(cx + drift + halfWidth, y);
        ctx.moveTo(cx - drift, y);
        ctx.lineTo(cx - drift - halfWidth, y);
        ctx.stroke();
      }
      break;
    }
    case "impact-chromatic-aberration":
      ctx.globalAlpha = state.intensity * 0.18;
      ctx.drawImage(sourceCanvas, 6 * state.intensity, 0, width, height);
      ctx.drawImage(sourceCanvas, -4 * state.intensity, 0, width, height);
      break;
    case "uv-feedback-tunnel":
      ctx.globalAlpha = state.intensity * 0.22;
      ctx.translate(cx, cy);
      ctx.scale(1 - state.intensity * 0.06, 1 - state.intensity * 0.06);
      ctx.rotate(state.phase * 0.08);
      ctx.drawImage(sourceCanvas, -cx, -cy, width, height);
      break;
    case "datamosh-vector-drag":
      ctx.globalAlpha = state.intensity * 0.2;
      for (let y = 0; y < height; y += 24) {
        const offset = Math.sin(y * 0.04 + frame.timeSec * 9) * 18 * state.intensity;
        ctx.drawImage(sourceCanvas, 0, y, width, 24, offset, y, width, 24);
      }
      break;
    case "crt-phosphor-mask":
      ctx.globalAlpha = state.intensity * 0.18;
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (let y = 0; y < height; y += 3) {
        ctx.fillRect(0, y, width, 1);
      }
      break;
    case "godray-bloom-shaft": {
      const radius = Math.max(width, height) * (0.18 + state.intensity * 0.2);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, paletteColor(theme, state.phase, state.intensity * 0.26, 18));
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.globalAlpha = state.intensity * 0.32;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "tunnel-vision-pulse": {
      const vignette = ctx.createRadialGradient(cx, cy, Math.min(width, height) * 0.16, cx, cy, Math.max(width, height) * 0.76);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, `rgba(0,0,0,${clamp(state.intensity * 0.46, 0.08, 0.32).toFixed(3)})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case "sobel-ink-outline":
      ctx.globalAlpha = state.intensity * 0.16;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      for (let x = 0; x < width; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + Math.sin(x * 0.02 + frame.timeSec) * 8, height);
        ctx.stroke();
      }
      break;
    case "resolution-crash-snapback": {
      const targetWidth = Math.max(1, Math.round(width / (2 + state.intensity * 6)));
      const targetHeight = Math.max(1, Math.round(height / (2 + state.intensity * 6)));
      scratchCtx.clearRect(0, 0, width, height);
      scratchCtx.imageSmoothingEnabled = false;
      scratchCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = state.intensity * 0.4;
      ctx.drawImage((scratchCtx.canvas as any), 0, 0, targetWidth, targetHeight, 0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      break;
    }
    case "palette-inversion-snare":
      if (frame.isBeatAccent) {
        ctx.globalAlpha = state.intensity * 0.22;
        ctx.fillStyle = "rgba(255,255,255,1)";
        ctx.fillRect(0, 0, width, height);
      }
      break;
    case "lens-dirt-specular":
      ctx.globalAlpha = state.intensity * 0.16;
      ctx.fillStyle = paletteColor(theme, state.phase, 0.12, 10);
      for (let index = 0; index < 18; index += 1) {
        const x = ((index * 73) % width);
        const y = ((index * 41) % height);
        ctx.fillRect(x, y, 2 + (index % 3), 2 + (index % 2));
      }
      break;
    case "pressure-grid-plane":
      ctx.globalAlpha = state.intensity * 0.14;
      ctx.strokeStyle = paletteColor(theme, state.phase, 0.18, 12);
      for (let y = 0; y < height; y += 36) {
        ctx.beginPath();
        ctx.moveTo(0, y + Math.sin(y * 0.02 + frame.timeSec * 4) * 10 * state.intensity);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      break;
    case "hard-pixel-lock":
      ctx.globalAlpha = state.intensity * 0.14;
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      for (let x = 0; x < width; x += 16) {
        for (let y = 0; y < height; y += 16) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
      break;
    case "canvas-smear-residue":
    case "bass-monolith-extrude":
    case "mobius-tunnel-wrap":
    default:
      ctx.globalAlpha = state.intensity * 0.14;
      ctx.drawImage(sourceCanvas, Math.sin(frame.timeSec * 2) * 6, Math.cos(frame.timeSec * 1.5) * 4, width, height);
      break;
  }
  ctx.restore();
  return state;
}
