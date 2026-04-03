export function stableImageSeed(imagePath: string, salt = 0): number {
  let hash = 2166136261 ^ (salt >>> 0);
  for (let index = 0; index < imagePath.length; index += 1) {
    hash ^= imagePath.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

