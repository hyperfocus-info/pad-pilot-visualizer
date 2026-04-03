import { hashUint } from "./noise";

export function stableHash32(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hashUint(hash >>> 0);
}

export function seedToUnitFloat(seed: number): number {
  return hashUint(seed) / 0xffffffff;
}

export function deriveSeed(base: number, label: string | number): number {
  const labelHash = typeof label === "number" ? hashUint(label >>> 0) : stableHash32(String(label));
  return hashUint((base >>> 0) ^ labelHash);
}

export function pickIndex(seed: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return hashUint(seed) % length;
}

export function pickWeightedIndex(seed: number, weights: number[]): number {
  if (weights.length === 0) {
    return 0;
  }
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) {
    return pickIndex(seed, weights.length);
  }
  let cursor = seedToUnitFloat(seed) * total;
  for (let index = 0; index < weights.length; index += 1) {
    cursor -= Math.max(0, weights[index] ?? 0);
    if (cursor <= 0) {
      return index;
    }
  }
  return weights.length - 1;
}
