import {
  FRACTAL_MOTIFS,
  classifyHeroMotifIntensity,
  type EdgeMap,
  type FractalMotif,
  type HeroMotifIntensityClass,
  type HeroMotifSchedule,
  type HeroMotifScheduleReason,
  type HeroMotifScheduleSlot,
  type PhraseMotifFamily,
  type VisualPhrasePlan,
} from "../types";

const SLOT_DURATION_SEC = 60;
const INTRO_MAX_SEC = 18;
const OUTRO_MAX_SEC = 18;

const PHRASE_FAMILY_BIAS: Record<PhraseMotifFamily, FractalMotif[]> = {
  "orbit-thread": ["glass-orbital", "halo-cell", "mandelbloom"],
  "shard-lattice": ["harmonic-lattice", "vector-incantation", "shattered-arc"],
  "ribbon-surge": ["smoke-ribbon", "film-bloom-shard", "chromatic-xylem"],
  "cathedral-beam": ["cathedral-filament", "data-cathedral", "harmonic-lattice"],
  "dust-choir": ["smoke-ribbon", "glass-orbital", "film-bloom-shard"],
  "glow-grid": ["harmonic-lattice", "glass-orbital", "neon-tube"],
};

interface BuildHeroMotifScheduleParams {
  edgeMaps: EdgeMap[];
  visualPlan: VisualPhrasePlan[];
  secondsPerImage: number;
  renderDurationSec: number;
}

interface SlotScoreContext {
  edgeMaps: EdgeMap[];
  visualPlan: VisualPhrasePlan[];
  secondsPerImage: number;
  renderDurationSec: number;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function overlapDuration(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function imageSpan(imageIndex: number, secondsPerImage: number, renderDurationSec: number): { startSec: number; endSec: number } {
  const startSec = imageIndex * secondsPerImage;
  const endSec = Math.min(renderDurationSec, startSec + secondsPerImage);
  return { startSec, endSec };
}

function dominantIntensityForRange(startSec: number, endSec: number, context: SlotScoreContext): HeroMotifIntensityClass {
  const scores = new Map<HeroMotifIntensityClass, number>();
  for (let imageIndex = 0; imageIndex < context.edgeMaps.length; imageIndex += 1) {
    const span = imageSpan(imageIndex, context.secondsPerImage, context.renderDurationSec);
    const overlap = overlapDuration(startSec, endSec, span.startSec, span.endSec);
    if (overlap <= 0) {
      continue;
    }
    const intensity = classifyHeroMotifIntensity(context.edgeMaps[imageIndex]!.fractalMotif);
    scores.set(intensity, (scores.get(intensity) ?? 0) + overlap);
  }
  return [...(["restrained", "standard", "colorful-psychedelic"] as const)]
    .sort((left: HeroMotifIntensityClass, right: HeroMotifIntensityClass) => (scores.get(right) ?? 0) - (scores.get(left) ?? 0))[0] ?? "standard";
}

function scoreMotifForRange(
  motif: FractalMotif,
  startSec: number,
  endSec: number,
  context: SlotScoreContext,
  previousMotif?: FractalMotif,
  bodyPrimaryMotif?: FractalMotif,
): number {
  let score = 0;
  for (let imageIndex = 0; imageIndex < context.edgeMaps.length; imageIndex += 1) {
    const edgeMap = context.edgeMaps[imageIndex]!;
    const span = imageSpan(imageIndex, context.secondsPerImage, context.renderDurationSec);
    const overlap = overlapDuration(startSec, endSec, span.startSec, span.endSec);
    if (overlap <= 0) {
      continue;
    }
    if (edgeMap.fractalMotif === motif) {
      score += overlap;
    }
  }
  for (const phrase of context.visualPlan) {
    const overlap = overlapDuration(startSec, endSec, phrase.startSec, phrase.endSec);
    if (overlap <= 0) {
      continue;
    }
    const preferredMotifs = PHRASE_FAMILY_BIAS[phrase.phraseMotifFamily] ?? [];
    if (preferredMotifs.includes(motif)) {
      score += overlap * 0.35;
    }
  }
  const dominantIntensity = dominantIntensityForRange(startSec, endSec, context);
  if (classifyHeroMotifIntensity(motif) === dominantIntensity) {
    score += (endSec - startSec) * 0.08;
  }
  if (previousMotif === motif) {
    score += (endSec - startSec) * 0.22;
  }
  if (bodyPrimaryMotif === motif) {
    score += (endSec - startSec) * 0.12;
  }
  const tieBreak = (stableHash(`${motif}:${Math.round(startSec * 100)}:${Math.round(endSec * 100)}`) % 1000) / 1_000_000;
  return score + tieBreak;
}

function bestMotifForRange(
  startSec: number,
  endSec: number,
  context: SlotScoreContext,
  previousMotif?: FractalMotif,
  bodyPrimaryMotif?: FractalMotif,
): { motif: FractalMotif; score: number } {
  const ranked = [...FRACTAL_MOTIFS]
    .map((motif) => ({
      motif,
      score: scoreMotifForRange(motif, startSec, endSec, context, previousMotif, bodyPrimaryMotif),
    }))
    .sort((left, right) => right.score - left.score || left.motif.localeCompare(right.motif));
  return ranked[0] ?? { motif: "glass-orbital", score: 0 };
}

function pushSlot(slots: HeroMotifScheduleSlot[], startSec: number, endSec: number, motif: FractalMotif, reason: HeroMotifScheduleReason): void {
  if (endSec <= startSec) {
    return;
  }
  slots.push({
    slotIndex: slots.length,
    startSec,
    endSec,
    motif,
    reason,
  });
}

export function buildHeroMotifSchedule(params: BuildHeroMotifScheduleParams): HeroMotifSchedule {
  const renderDurationSec = Math.max(1e-6, params.renderDurationSec);
  const introEndSec = Math.min(INTRO_MAX_SEC, renderDurationSec * 0.1);
  const outroStartSec = Math.max(introEndSec, renderDurationSec - OUTRO_MAX_SEC);
  const context: SlotScoreContext = {
    edgeMaps: params.edgeMaps,
    visualPlan: params.visualPlan,
    secondsPerImage: params.secondsPerImage,
    renderDurationSec,
  };

  if (renderDurationSec <= 36) {
    const overall = bestMotifForRange(0, renderDurationSec, context);
    return {
      introEndSec,
      outroStartSec,
      slots: [{ slotIndex: 0, startSec: 0, endSec: renderDurationSec, motif: overall.motif, reason: "body-hold" }],
    };
  }

  const bodyStartSec = introEndSec;
  const bodyEndSec = outroStartSec;
  const bodyRange = bodyEndSec > bodyStartSec ? bestMotifForRange(bodyStartSec, bodyEndSec, context) : bestMotifForRange(0, renderDurationSec, context);
  const slots: HeroMotifScheduleSlot[] = [];

  const introRange = bestMotifForRange(0, Math.max(introEndSec, Math.min(renderDurationSec, INTRO_MAX_SEC)), context, undefined, bodyRange.motif);
  const bodyReferenceScore = scoreMotifForRange(bodyRange.motif, 0, Math.max(introEndSec, Math.min(renderDurationSec, INTRO_MAX_SEC)), context, undefined, bodyRange.motif);
  const introMotif =
    introRange.motif !== bodyRange.motif && introRange.score >= Math.max(0.01, bodyReferenceScore * 1.1)
      ? introRange.motif
      : bodyRange.motif;
  pushSlot(slots, 0, introEndSec, introMotif, "intro-setup");

  const replacementThreshold = renderDurationSec < 150 ? 1.5 : 1.35;
  let currentMotif = bodyRange.motif;
  for (let slotStartSec = bodyStartSec; slotStartSec < bodyEndSec; slotStartSec += SLOT_DURATION_SEC) {
    const slotEndSec = Math.min(bodyEndSec, slotStartSec + SLOT_DURATION_SEC);
    if (slotStartSec === bodyStartSec) {
      pushSlot(slots, slotStartSec, slotEndSec, currentMotif, "body-hold");
      continue;
    }
    const best = bestMotifForRange(slotStartSec, slotEndSec, context, currentMotif, bodyRange.motif);
    const currentScore = scoreMotifForRange(currentMotif, slotStartSec, slotEndSec, context, currentMotif, bodyRange.motif);
    const shouldPromote =
      best.motif !== currentMotif &&
      best.score >= Math.max(0.01, currentScore * replacementThreshold);
    if (shouldPromote) {
      currentMotif = best.motif;
    }
    pushSlot(slots, slotStartSec, slotEndSec, currentMotif, shouldPromote ? "body-promoted" : "body-hold");
  }

  const outroBest = bestMotifForRange(outroStartSec, renderDurationSec, context, currentMotif, bodyRange.motif);
  const currentOutroScore = scoreMotifForRange(currentMotif, outroStartSec, renderDurationSec, context, currentMotif, bodyRange.motif);
  const outroMotif =
    outroBest.motif !== currentMotif && outroBest.score >= Math.max(0.01, currentOutroScore * 1.15)
      ? outroBest.motif
      : currentMotif;
  pushSlot(slots, outroStartSec, renderDurationSec, outroMotif, "outro-lock");

  return {
    introEndSec,
    outroStartSec,
    slots,
  };
}

export function resolveHeroMotifScheduleSlot(schedule: HeroMotifSchedule, timeSec: number): HeroMotifScheduleSlot {
  const clampedTime = Math.max(0, timeSec);
  return schedule.slots.find((slot) => clampedTime >= slot.startSec && clampedTime < slot.endSec)
    ?? schedule.slots[schedule.slots.length - 1]
    ?? { slotIndex: 0, startSec: 0, endSec: Math.max(1e-6, clampedTime), motif: "glass-orbital", reason: "body-hold" };
}
