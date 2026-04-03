import { clamp } from "../config";
import type {
  AudioFrameFeature,
  AudioSegmentFeature,
  DominantBand,
  HslaColor,
  ImageStyleProfile,
  NebulaPalette,
  RenderTheme,
} from "../types";

export function sanitizeEffectMode(effectMode: number): number {
  const normalized = ((effectMode % 16) + 16) % 16;
  switch (normalized) {
    case 15:
      return 14;
    default:
      return normalized;
  }
}

export function sanitizeTransitionMode(transitionMode: number): number {
  return ((transitionMode % 16) + 16) % 16;
}

function hsla(hue: number, saturation: number, lightness: number, alpha: number): string {
  return `hsla(${((hue % 360) + 360) % 360}, ${clamp(saturation, 0, 100).toFixed(1)}%, ${clamp(lightness, 0, 100).toFixed(1)}%, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function parseHsla(color: string): HslaColor | null {
  const match = color.match(/hsla?\(([-\d.]+),\s*([-\d.]+)%?,\s*([-\d.]+)%?,\s*([-\d.]+)\)/i);
  if (!match) {
    return null;
  }
  return {
    hue: Number(match[1]),
    saturation: Number(match[2]),
    lightness: Number(match[3]),
    alpha: Number(match[4]),
  };
}

function bandBias(band: DominantBand): number {
  switch (band) {
    case "low":
      return -18;
    case "lowMid":
      return -6;
    case "mid":
      return 8;
    case "high":
      return 18;
  }
}

export function colorfulnessMultiplier(
  _theme: RenderTheme,
  options?: {
    saturationScale?: number;
    extreme?: boolean;
  },
): number {
  const baseline = 1.1;
  const saturationScale = options?.saturationScale ?? 1;
  const extremeMultiplier = options?.extreme ? 2 : 1;
  return baseline * saturationScale * extremeMultiplier;
}

function colorFromPalette(profile: ImageStyleProfile, index: number, fallbackHue: number, alpha: number): string {
  const parsed = parseHsla(profile.palette[index % profile.palette.length] ?? "");
  if (!parsed) {
    return hsla(fallbackHue, 70, 50, alpha);
  }
  return hsla(parsed.hue, parsed.saturation, parsed.lightness, alpha);
}

export function createFallbackStyleProfile(imagePath = "fallback"): ImageStyleProfile {
  return {
    imagePath,
    firstPixelR: 32,
    firstPixelG: 64,
    firstPixelB: 96,
    averageR: 64,
    averageG: 96,
    averageB: 128,
    medianR: 66,
    medianG: 96,
    medianB: 126,
    modeR: 64,
    modeG: 96,
    modeB: 128,
    rangeR: 48,
    rangeG: 56,
    rangeB: 72,
    averageHue: 210,
    effectSeed: 32,
    effectBucket: 8,
    effectCycle: 0,
    effectMode: 0,
    transitionMode: 4,
    dominantHue: 210,
    hueVariance: 24,
    saturationMean: 0.45,
    lightnessMean: 0.38,
    warmCoolBias: -0.25,
    contrast: 0.18,
    edgeDensity: 0.34,
    symmetry: 0.4,
    clusterCount: 3,
    palette: [
      hsla(222, 54, 12, 0.9),
      hsla(250, 48, 24, 0.86),
      hsla(192, 74, 46, 0.84),
      hsla(176, 92, 76, 0.9),
      hsla(24, 96, 68, 0.92),
    ],
    shapeBias: "filament",
    particleBias: "mixed",
  };
}

function createNebulaPalette(segment: AudioSegmentFeature, styleProfile: ImageStyleProfile): NebulaPalette {
  const monochromeCool = styleProfile.hueVariance < 22 && styleProfile.warmCoolBias < -0.2;
  const voidColor = hsla(228 + styleProfile.warmCoolBias * -12, 36, 3 + styleProfile.contrast * 8, 1);
  const coreCyan = monochromeCool
    ? hsla(184, 88, 74 + segment.paletteWeights.mid * 8, 0.95)
    : colorFromPalette(styleProfile, 3, 182, 0.95);
  const tealGlow = colorFromPalette(styleProfile, 2, 194, 0.8);
  const purpleBody = monochromeCool
    ? hsla(244, 42, 18 + segment.paletteWeights.low * 8, 0.8)
    : colorFromPalette(styleProfile, 1, 266, 0.8);
  const magentaBody = monochromeCool
    ? hsla(304, 72, 46 + segment.paletteWeights.mid * 8, 0.82)
    : colorFromPalette(styleProfile, 0, 312, 0.82);
  const orangeEdge = hsla(20 + segment.paletteWeights.high * 10, 96, 66 + segment.paletteWeights.high * 8, 0.94);

  return {
    voidColor,
    coreCyan,
    tealGlow,
    purpleBody,
    magentaBody,
    orangeEdge,
    sparkWhite: "rgba(244, 249, 255, 0.96)",
    sparkYellow: hsla(42, 100, 70, 0.95),
  };
}

export function createRenderTheme(segment: AudioSegmentFeature, styleProfile?: ImageStyleProfile): RenderTheme {
  const profile = styleProfile ?? createFallbackStyleProfile();
  const rawEffectMode = profile.effectMode % 16;
  const effectiveEffectMode = sanitizeEffectMode(rawEffectMode);
  const nebula = createNebulaPalette(segment, profile);
  const monochrome = profile.hueVariance < 20;
  const modeHue = ((profile.modeR + profile.modeG + profile.modeB) / 3 / 255) * 360;
  const rangeMean = (profile.rangeR + profile.rangeG + profile.rangeB) / 3;
  const basePalette = profile.palette.length ? profile.palette.slice(0, 6) : [nebula.purpleBody, nebula.tealGlow, nebula.coreCyan];
  const basePaletteHsl = basePalette.map((color, index) => parseHsla(color) ?? { hue: 220 + index * 20, saturation: 60, lightness: 30, alpha: 0.8 });
  const dominantHueNormalized = clamp((segment.dominantHz - 20) / (8000 - 20), 0, 1);
  const lowBandColor = hsla(238 + profile.warmCoolBias * -18 + modeHue * 0.06, 46 + rangeMean * 0.04, 16 + segment.paletteWeights.low * 10, 0.88);
  const lowMidBandColor = monochrome
    ? hsla(196 + profile.medianG * 0.08, 70, 46 + segment.paletteWeights.lowMid * 10, 0.84)
    : colorFromPalette(profile, 1, 198, 0.84);
  const midBandColor = monochrome
    ? hsla(180 + profile.medianB * 0.07, 92, 72 + segment.paletteWeights.mid * 6, 0.9)
    : colorFromPalette(profile, 2, 176, 0.9);
  const highBandColor = hsla(340 - dominantHueNormalized * 16 + profile.rangeR * 0.08, 94, 68 + segment.paletteWeights.high * 8, 0.92);

  return {
    dominantHz: segment.dominantHz,
    dominantBand: segment.dominantBand,
    rainbowHueOffset: segment.rainbowHueOffset,
    paletteStops: [nebula.purpleBody, nebula.magentaBody, nebula.tealGlow, nebula.coreCyan, nebula.orangeEdge],
    hueStops: basePalette.map((color, index) => parseHsla(color)?.hue ?? (220 + index * 20)),
    motionScale: segment.motionScale,
    densityScale: segment.densityScale,
    nebula,
    vortexBias: clamp(0.68 + segment.motionScale * 0.26 + profile.edgeDensity * 0.24, 0.68, 1.45),
    lightningHueOffset: 334 - segment.paletteWeights.high * 8,
    shadowTint: hsla(236 + profile.warmCoolBias * -10, 34, 7 + profile.contrast * 10, 0.34),
    lowBandColor,
    lowMidBandColor,
    midBandColor,
    highBandColor,
    styleProfile: profile,
    styleMode: profile.shapeBias,
    particleMode: profile.particleBias,
    basePalette,
    basePaletteHsl,
    imageWarmCoolBias: profile.warmCoolBias,
    imageContrast: profile.contrast,
    rawEffectMode,
    effectiveEffectMode,
    transitionMode: sanitizeTransitionMode(profile.transitionMode),
  };
}

export function paletteColor(
  theme: RenderTheme,
  position: number,
  alpha: number,
  lightnessBoost = 0,
  saturationScale = 1,
): string {
  const wrapped = ((position % 1) + 1) % 1;
  const scaled = wrapped * Math.max(1, theme.basePalette.length - 1);
  const index = Math.floor(scaled);
  const blend = scaled - index;
  const current = theme.basePaletteHsl[index] ?? { hue: 240, saturation: 60, lightness: 30, alpha: 0.8 };
  const next = theme.basePaletteHsl[Math.min(theme.basePaletteHsl.length - 1, index + 1)] ?? { hue: 180, saturation: 70, lightness: 70, alpha: 0.8 };
  const hue = current.hue + (next.hue - current.hue) * blend + theme.imageWarmCoolBias * 8 + theme.rainbowHueOffset * 0.12;
  const saturation =
    (current.saturation + (next.saturation - current.saturation) * blend + theme.motionScale * 6 + theme.densityScale * 3) *
    colorfulnessMultiplier(theme, { saturationScale });
  const lightness = current.lightness + (next.lightness - current.lightness) * blend + lightnessBoost + theme.imageContrast * 10;
  return hsla(hue, saturation, lightness, alpha);
}

export function plasmaBodyColor(theme: RenderTheme, alpha: number, warmth = 0, saturationScale = 1): string {
  const hue = (theme.basePaletteHsl[0]?.hue ?? 284) + warmth * 12 + theme.imageWarmCoolBias * 10;
  const lightness = 24 + theme.motionScale * 4 + theme.imageContrast * 20 + warmth * 5;
  return hsla(hue, (64 + theme.styleProfile.saturationMean * 22) * colorfulnessMultiplier(theme, { saturationScale }), lightness, alpha);
}

export function plasmaCoreColor(theme: RenderTheme, alpha: number, shift = 0, saturationScale = 1): string {
  const hue = (theme.basePaletteHsl[Math.min(2, theme.basePaletteHsl.length - 1)]?.hue ?? 176) + shift * 10;
  const lightness = 68 + theme.densityScale * 6 + shift * 4;
  return hsla(hue, (88 + theme.styleProfile.saturationMean * 8) * colorfulnessMultiplier(theme, { saturationScale }), lightness, alpha);
}

export function lightningColor(theme: RenderTheme, alpha: number, hot = 0, saturationScale = 1): string {
  const hue = 334 - hot * 18 + theme.imageWarmCoolBias * -8;
  return hsla(hue, 94 * colorfulnessMultiplier(theme, { saturationScale }), 66 + hot * 10, alpha);
}

export function dustColor(theme: RenderTheme, alpha: number, energy = 0, saturationScale = 1): string {
  const hue = energy < 0.5 ? (theme.basePaletteHsl[1]?.hue ?? 194) : (theme.basePaletteHsl[0]?.hue ?? 304);
  return hsla(hue, 62 * colorfulnessMultiplier(theme, { saturationScale }), energy < 0.5 ? 58 : 50, alpha);
}

export function sparkColor(theme: RenderTheme, alpha: number, warm = false): string {
  return warm
    ? theme.nebula.sparkYellow.replace(/0\.\d+\)$/, `${clamp(alpha, 0, 1).toFixed(3)})`)
    : theme.nebula.sparkWhite.replace(/0\.\d+\)$/, `${clamp(alpha, 0, 1).toFixed(3)})`);
}

export function backgroundGradient(frame: AudioFrameFeature, theme: RenderTheme): [string, string] {
  const coolShift = theme.imageWarmCoolBias < 0 ? 1 : 0;
  return [
    hsla(
      228 + coolShift * 10 + frame.normalizedHigh * 42 - frame.normalizedLow * 18 + theme.rainbowHueOffset * 0.08,
      40 + frame.normalizedHigh * 18,
      6 + frame.normalizedLow * 2.8 + frame.peakStrength * 1.2 + theme.imageContrast * 3,
      1,
    ),
    hsla(
      246 + theme.imageWarmCoolBias * -8 - frame.normalizedLow * 24 + frame.normalizedMid * 20,
      42 + frame.normalizedLowMid * 18,
      2.2 + frame.normalizedHigh * 1.8 + frame.peakStrength * 0.9,
      1,
    ),
  ];
}
