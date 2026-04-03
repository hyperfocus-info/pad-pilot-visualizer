import os from "node:os";
import sharp from "sharp";
import type { ImageAsset, ImageStyleProfile, ParticleBias, ShapeBias } from "../types";

interface HslPixel {
  hue: number;
  saturation: number;
  lightness: number;
}

function rgbToHsl(r: number, g: number, b: number): HslPixel {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { hue: 0, saturation: 0, lightness };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  switch (max) {
    case rn:
      hue = ((gn - bn) / delta) % 6;
      break;
    case gn:
      hue = (bn - rn) / delta + 2;
      break;
    default:
      hue = (rn - gn) / delta + 4;
      break;
  }

  hue *= 60;
  if (hue < 0) {
    hue += 360;
  }

  return { hue, saturation, lightness };
}

function hslToCss(pixel: HslPixel, alpha = 0.9): string {
  return `hsla(${pixel.hue.toFixed(1)}, ${(pixel.saturation * 100).toFixed(1)}%, ${(pixel.lightness * 100).toFixed(1)}%, ${alpha.toFixed(3)})`;
}

function circularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function circularMean(hues: number[]): number {
  if (hues.length === 0) {
    return 0;
  }
  let x = 0;
  let y = 0;
  for (const hue of hues) {
    const radians = (hue * Math.PI) / 180;
    x += Math.cos(radians);
    y += Math.sin(radians);
  }
  const angle = (Math.atan2(y, x) * 180) / Math.PI;
  return (angle + 360) % 360;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) * 0.5 : sorted[middle]!;
}

function mode(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const buckets = new Map<number, number>();
  for (const value of values) {
    const bucket = Math.round(value / 8) * 8;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

function standardDeviation(values: number[], mean: number): number {
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / Math.max(1, values.length);
  return Math.sqrt(variance);
}

function quantizeHue(hue: number): number {
  return Math.round(hue / 24) * 24;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function chooseHighestScore<T extends string>(scores: Record<T, number>): T {
  return (Object.entries(scores) as Array<[T, number]>).sort((a, b) => b[1] - a[1])[0]![0];
}

export function deriveShapeBias(profile: Omit<ImageStyleProfile, "shapeBias" | "particleBias">): ShapeBias {
  const edge = clamp01(profile.edgeDensity);
  const contrast = clamp01(profile.contrast / 0.42);
  const symmetry = clamp01(profile.symmetry);
  const hueVariance = clamp01(profile.hueVariance / 72);
  const clusterDensity = clamp01((profile.clusterCount - 1) / 7);
  const softScene = clamp01((1 - edge) * 0.55 + (1 - contrast) * 0.45);
  const geometricDiscipline = clamp01(symmetry * 0.7 + (1 - hueVariance) * 0.3);

  const scores: Record<ShapeBias, number> = {
    filament:
      edge * 1.4 +
      contrast * 1.1 +
      (1 - symmetry) * 0.45 +
      clamp01((profile.edgeDensity - 0.46) * 2.6) * 0.8,
    cloud:
      softScene * 1.65 +
      clamp01((0.3 - profile.edgeDensity) * 3.2) * 0.6 +
      clamp01((0.18 - profile.contrast) * 5.5) * 0.5,
    shard:
      edge * 0.95 +
      contrast * 1.3 +
      hueVariance * 1.1 +
      (1 - symmetry) * 0.35,
    ring:
      geometricDiscipline * 1.7 +
      clamp01((profile.symmetry - 0.55) * 2.8) * 0.9 +
      clamp01((0.52 - Math.abs(profile.edgeDensity - 0.42)) * 1.4),
    cellular:
      clusterDensity * 1.25 +
      clamp01(1 - Math.abs(profile.edgeDensity - 0.38) * 2.4) * 0.85 +
      clamp01(1 - Math.abs(profile.contrast - 0.2) * 4.2) * 0.65 +
      hueVariance * 0.2,
  };

  return chooseHighestScore(scores);
}

export function deriveParticleBias(profile: Omit<ImageStyleProfile, "shapeBias" | "particleBias">): ParticleBias {
  const edge = clamp01(profile.edgeDensity);
  const contrast = clamp01(profile.contrast / 0.42);
  const hueVariance = clamp01(profile.hueVariance / 72);
  const clusterDensity = clamp01((profile.clusterCount - 1) / 7);

  const scores: Record<ParticleBias, number> = {
    dust:
      clamp01((0.2 - profile.contrast) * 5.5) * 1.05 +
      clamp01((0.24 - profile.edgeDensity) * 4.2) * 1.1 +
      (1 - hueVariance) * 0.25,
    orbs:
      clamp01((4 - profile.clusterCount) / 3) * 1.25 +
      clamp01((0.38 - profile.edgeDensity) * 3) * 0.7 +
      clamp01((0.26 - profile.contrast) * 3.8) * 0.45,
    streaks:
      edge * 1.35 +
      (1 - hueVariance) * 0.85 +
      clamp01((profile.contrast - 0.16) * 3.8) * 0.55,
    shards:
      contrast * 1.1 +
      edge * 0.95 +
      hueVariance * 0.8 +
      clamp01((profile.contrast - 0.24) * 5.2) * 0.7,
    mixed:
      clusterDensity * 0.75 +
      clamp01(1 - Math.abs(profile.edgeDensity - 0.4) * 2.2) * 0.7 +
      clamp01(1 - Math.abs(profile.contrast - 0.22) * 3.6) * 0.75 +
      hueVariance * 0.3,
  };

  return chooseHighestScore(scores);
}

export function deriveEffectSeed(params: {
  averageR: number;
  averageG: number;
  averageB: number;
  dominantHue: number;
  hueVariance: number;
  edgeDensity: number;
  contrast: number;
}): number {
  return Math.round(
    (
      params.averageR * 0.22 +
      params.averageG * 0.17 +
      params.averageB * 0.13 +
      params.dominantHue * 0.35 +
      params.hueVariance * 0.45 +
      params.edgeDensity * 255 * 0.4 +
      params.contrast * 255 * 0.5
    ) % 256,
  );
}

async function analyzeImageStyle(asset: ImageAsset): Promise<ImageStyleProfile> {
  const { data, info } = await sharp(asset.localPath)
    .resize(64, 36, { fit: "cover", position: "attention" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels: HslPixel[] = [];
  const hues: number[] = [];
  const saturations: number[] = [];
  const lightnesses: number[] = [];
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let warmWeight = 0;
  let coolWeight = 0;
  let edgeHits = 0;
  let symmetryAccum = 0;
  let symmetryCount = 0;
  const firstPixelR = data[0] ?? 0;
  const firstPixelG = data[1] ?? 0;
  const firstPixelB = data[2] ?? 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * info.channels;
      const red = data[index]!;
      const green = data[index + 1]!;
      const blue = data[index + 2]!;
      const pixel = rgbToHsl(red, green, blue);
      pixels.push(pixel);
      sumR += red;
      sumG += green;
      sumB += blue;
      reds.push(red);
      greens.push(green);
      blues.push(blue);
      if (pixel.saturation > 0.06) {
        hues.push(pixel.hue);
      }
      saturations.push(pixel.saturation);
      lightnesses.push(pixel.lightness);

      if (pixel.hue <= 70 || pixel.hue >= 320) {
        warmWeight += pixel.saturation;
      } else if (pixel.hue >= 170 && pixel.hue <= 260) {
        coolWeight += pixel.saturation;
      }

      if (x < info.width - 1 && y < info.height - 1) {
        const right = rgbToHsl(data[index + info.channels]!, data[index + info.channels + 1]!, data[index + info.channels + 2]!);
        const downIndex = index + info.width * info.channels;
        const down = rgbToHsl(data[downIndex]!, data[downIndex + 1]!, data[downIndex + 2]!);
        const gradient =
          Math.abs(pixel.lightness - right.lightness) +
          Math.abs(pixel.lightness - down.lightness) +
          Math.abs(pixel.saturation - right.saturation) * 0.4 +
          Math.abs(pixel.saturation - down.saturation) * 0.4;
        if (gradient > 0.16) {
          edgeHits += 1;
        }
      }

      const mirrorX = info.width - 1 - x;
      if (x < mirrorX) {
        const mirrorIndex = (y * info.width + mirrorX) * info.channels;
        const mirror = rgbToHsl(data[mirrorIndex]!, data[mirrorIndex + 1]!, data[mirrorIndex + 2]!);
        const similarity =
          1 -
          Math.min(
            1,
            Math.abs(pixel.lightness - mirror.lightness) * 1.3 +
              Math.abs(pixel.saturation - mirror.saturation) * 0.8 +
              circularDistance(pixel.hue, mirror.hue) / 360,
          );
        symmetryAccum += similarity;
        symmetryCount += 1;
      }
    }
  }

  const dominantHue = circularMean(hues);
  const hueVariance = average(hues.map((hue) => circularDistance(hue, dominantHue)));
  const saturationMean = average(saturations);
  const lightnessMean = average(lightnesses);
  const averageR = sumR / Math.max(1, pixels.length);
  const averageG = sumG / Math.max(1, pixels.length);
  const averageB = sumB / Math.max(1, pixels.length);
  const medianR = median(reds);
  const medianG = median(greens);
  const medianB = median(blues);
  const modeR = mode(reds);
  const modeG = mode(greens);
  const modeB = mode(blues);
  const rangeR = Math.max(...reds, 0) - Math.min(...reds, 0);
  const rangeG = Math.max(...greens, 0) - Math.min(...greens, 0);
  const rangeB = Math.max(...blues, 0) - Math.min(...blues, 0);
  const averageHue = rgbToHsl(averageR, averageG, averageB).hue;
  const contrast = standardDeviation(lightnesses, lightnessMean);
  const warmCoolBias = (warmWeight - coolWeight) / Math.max(1e-6, warmWeight + coolWeight);
  const edgeDensity = edgeHits / Math.max(1, (info.width - 1) * (info.height - 1));
  const symmetry = symmetryAccum / Math.max(1, symmetryCount);
  const effectSeed = deriveEffectSeed({
    averageR,
    averageG,
    averageB,
    dominantHue,
    hueVariance,
    edgeDensity,
    contrast,
  });
  const effectBucket = Math.floor(effectSeed / 4);
  const effectCycle = Math.floor(effectBucket / 16);
  const effectMode = effectBucket % 16;

  const paletteBuckets = new Map<number, { count: number; pixel: HslPixel }>();
  for (const pixel of pixels) {
    const key = quantizeHue(pixel.hue) + Math.round(pixel.saturation * 10) * 1000 + Math.round(pixel.lightness * 10) * 10000;
    const current = paletteBuckets.get(key);
    if (current) {
      current.count += 1;
      current.pixel = {
        hue: circularMean([current.pixel.hue, pixel.hue]),
        saturation: (current.pixel.saturation + pixel.saturation) * 0.5,
        lightness: (current.pixel.lightness + pixel.lightness) * 0.5,
      };
    } else {
      paletteBuckets.set(key, { count: 1, pixel });
    }
  }

  const palette = [...paletteBuckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((entry) => hslToCss(entry.pixel));

  const clusterCount = [...paletteBuckets.values()].filter((entry) => entry.count > pixels.length * 0.04).length;

  const baseProfile = {
    imagePath: asset.localPath,
    firstPixelR,
    firstPixelG,
    firstPixelB,
    averageR,
    averageG,
    averageB,
    medianR,
    medianG,
    medianB,
    modeR,
    modeG,
    modeB,
    rangeR,
    rangeG,
    rangeB,
    averageHue,
    effectSeed,
    effectBucket,
    effectCycle,
    effectMode,
    transitionMode: (Math.floor(averageHue / 22.5) + Math.round(edgeDensity * 3) + Math.round(symmetry * 2)) % 16,
    dominantHue,
    hueVariance,
    saturationMean,
    lightnessMean,
    warmCoolBias,
    contrast,
    edgeDensity,
    symmetry,
    clusterCount: Math.max(1, clusterCount),
    palette: palette.length ? palette : [hslToCss({ hue: dominantHue, saturation: Math.max(0.25, saturationMean), lightness: lightnessMean })],
  };

  return {
    ...baseProfile,
    shapeBias: deriveShapeBias(baseProfile),
    particleBias: deriveParticleBias(baseProfile),
  };
}

export async function analyzeImageStyles(params: {
  assets: ImageAsset[];
  onProgress?: (current: number, total: number) => void;
}): Promise<ImageStyleProfile[]> {
  const profiles = new Array<ImageStyleProfile>(params.assets.length);
  const concurrency = Math.max(1, Math.min(params.assets.length, Math.max(1, Math.min(os.availableParallelism() - 1, 4))));
  let nextIndex = 0;
  let completed = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= params.assets.length) {
          return;
        }
        profiles[index] = await analyzeImageStyle(params.assets[index]!);
        completed += 1;
        params.onProgress?.(completed, params.assets.length);
      }
    }),
  );
  return profiles;
}
