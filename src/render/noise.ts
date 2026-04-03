function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

export function hashUint(seed: number): number {
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

export function hashFloat(seed: number): number {
  return hashUint(seed) / 0xffffffff;
}

function hashGrid(x: number, y: number, seed: number): number {
  const xi = x | 0;
  const yi = y | 0;
  return hashFloat(Math.imul(xi, 374761393) ^ Math.imul(yi, 668265263) ^ hashUint(seed * 2654435761));
}

export function sampleNoise2D(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);

  const n00 = hashGrid(x0, y0, seed);
  const n10 = hashGrid(x1, y0, seed);
  const n01 = hashGrid(x0, y1, seed);
  const n11 = hashGrid(x1, y1, seed);

  const nx0 = mix(n00, n10, tx);
  const nx1 = mix(n01, n11, tx);
  return mix(nx0, nx1, ty) * 2 - 1;
}

export function fractalNoise2D(
  x: number,
  y: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
  seed = 0,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let weight = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    sum += sampleNoise2D(x * frequency, y * frequency, seed + octave * 131) * amplitude;
    weight += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }

  return weight > 0 ? sum / weight : 0;
}

export function sampleBodyNoise2D(x: number, y: number, seed = 0): number {
  return fractalNoise2D(x, y, 2, 2, 0.55, seed);
}
