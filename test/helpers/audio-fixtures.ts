import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

export type Complexity = "low" | "medium" | "high";
export type BandEmphasis = "low" | "lowMid" | "mid" | "high";
export type SongScenario = "clean-kick-120" | "startup-misdirection-128" | "dense-transients-174" | "ambient-fallback" | "band-sweep";

export interface GeneratedSong {
  name: SongScenario;
  path: string;
  sampleRate: number;
  durationSec: number;
  bpm?: number;
  expectedBeatOriginSec?: number;
  expectedDominantBands?: BandEmphasis[];
}

const SAMPLE_RATE = 44100;
const createdDirs: string[] = [];

function bandFrequency(band: BandEmphasis): number {
  switch (band) {
    case "low":
      return 60;
    case "lowMid":
      return 220;
    case "mid":
      return 880;
    case "high":
      return 3200;
  }
}

function eventAmplitude(complexity: Complexity): number {
  switch (complexity) {
    case "low":
      return 0.75;
    case "medium":
      return 0.58;
    case "high":
      return 0.46;
  }
}

function addToneBurst(
  samples: Float32Array,
  startSec: number,
  durationSec: number,
  band: BandEmphasis,
  amplitude: number,
  decay = 7.5,
): void {
  const frequency = bandFrequency(band);
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const end = Math.min(samples.length, Math.floor((startSec + durationSec) * SAMPLE_RATE));
  for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
    const t = (sampleIndex - start) / SAMPLE_RATE;
    const env = Math.exp(-t * decay);
    const tone = Math.sin(2 * Math.PI * frequency * t);
    const harmonic = band === "low" ? Math.sin(2 * Math.PI * frequency * 2 * t) * 0.35 : Math.sin(2 * Math.PI * frequency * 1.5 * t) * 0.18;
    samples[sampleIndex] += (tone + harmonic) * amplitude * env;
  }
}

function addNoiseBurst(samples: Float32Array, startSec: number, durationSec: number, amplitude: number, highpass = 0.72): void {
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const end = Math.min(samples.length, Math.floor((startSec + durationSec) * SAMPLE_RATE));
  let previous = 0;
  for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
    const t = (sampleIndex - start) / SAMPLE_RATE;
    const env = Math.exp(-t * 10);
    const noise = Math.sin(sampleIndex * 0.73) * 0.5 + Math.sin(sampleIndex * 1.93) * 0.3 + Math.sin(sampleIndex * 3.1) * 0.2;
    const shaped = noise - previous * highpass;
    previous = noise;
    samples[sampleIndex] += shaped * amplitude * env;
  }
}

function addPad(samples: Float32Array, startSec: number, endSec: number, band: BandEmphasis, amplitude: number): void {
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const end = Math.min(samples.length, Math.floor(endSec * SAMPLE_RATE));
  const frequency = bandFrequency(band);
  for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
    const t = sampleIndex / SAMPLE_RATE;
    const local = (sampleIndex - start) / Math.max(1, end - start);
    const slowEnv = 0.5 - 0.5 * Math.cos(local * Math.PI * 2);
    samples[sampleIndex] += Math.sin(2 * Math.PI * frequency * t) * amplitude * (0.35 + slowEnv * 0.65);
  }
}

function applyGainRamp(samples: Float32Array, fromSec: number, toSec: number, fromGain: number, toGain: number): void {
  const start = Math.max(0, Math.floor(fromSec * SAMPLE_RATE));
  const end = Math.min(samples.length, Math.floor(toSec * SAMPLE_RATE));
  for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
    const progress = (sampleIndex - start) / Math.max(1, end - start);
    const gain = fromGain + (toGain - fromGain) * progress;
    samples[sampleIndex] *= gain;
  }
}

function clampSamples(samples: Float32Array): void {
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.max(-0.98, Math.min(0.98, samples[index]!));
  }
}

function writeWavBuffer(samples: Float32Array): Buffer {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]!));
    pcm.writeInt16LE(Math.round(value * 32767), index * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = path.join(tmpdir(), `ai-video-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}

function addGrooveSection(
  samples: Float32Array,
  startSec: number,
  endSec: number,
  bpm: number,
  complexity: Complexity,
  includeStartupClicks = false,
): void {
  const secondsPerBeat = 60 / bpm;
  const amplitude = eventAmplitude(complexity);
  const beatCount = Math.ceil((endSec - startSec) / secondsPerBeat) + 1;
  for (let beat = 0; beat < beatCount; beat += 1) {
    const beatTime = startSec + beat * secondsPerBeat;
    if (beatTime >= endSec) {
      break;
    }
    addToneBurst(samples, beatTime, 0.16, "low", amplitude, 9);

    if (complexity !== "low") {
      const isBackbeat = beat % 4 === 1 || beat % 4 === 3;
      if (isBackbeat) {
        addToneBurst(samples, beatTime, 0.12, "lowMid", amplitude * 0.7, 10.5);
        addNoiseBurst(samples, beatTime, 0.06, amplitude * 0.18);
      }
      addNoiseBurst(samples, beatTime + secondsPerBeat * 0.5, 0.03, amplitude * 0.11);
    }

    if (complexity === "high") {
      addToneBurst(samples, beatTime + secondsPerBeat * 0.25, 0.05, "mid", amplitude * 0.42, 15);
      addNoiseBurst(samples, beatTime + secondsPerBeat * 0.75, 0.025, amplitude * 0.13, 0.84);
    }
  }

  if (includeStartupClicks) {
    addNoiseBurst(samples, startSec - 0.28, 0.018, 0.18);
    addNoiseBurst(samples, startSec - 0.11, 0.018, 0.16);
  }
}

function generateScenarioSamples(name: SongScenario): { samples: Float32Array; durationSec: number; bpm?: number; expectedBeatOriginSec?: number; expectedDominantBands?: BandEmphasis[] } {
  switch (name) {
    case "clean-kick-120": {
      const durationSec = 8;
      const samples = new Float32Array(Math.floor(durationSec * SAMPLE_RATE));
      addGrooveSection(samples, 0.25, 7.0, 120, "low");
      applyGainRamp(samples, 7.0, 8.0, 1, 0.25);
      return { samples, durationSec, bpm: 120, expectedBeatOriginSec: 0.25 };
    }
    case "startup-misdirection-128": {
      const durationSec = 10;
      const samples = new Float32Array(Math.floor(durationSec * SAMPLE_RATE));
      addNoiseBurst(samples, 0.12, 0.02, 0.15);
      addNoiseBurst(samples, 0.36, 0.02, 0.13);
      addGrooveSection(samples, 0.5, 8.5, 128, "medium", true);
      applyGainRamp(samples, 8.5, 10.0, 1, 0.18);
      return { samples, durationSec, bpm: 128, expectedBeatOriginSec: 0.5 };
    }
    case "dense-transients-174": {
      const durationSec = 12;
      const samples = new Float32Array(Math.floor(durationSec * SAMPLE_RATE));
      addNoiseBurst(samples, 0.05, 0.22, 0.08, 0.3);
      addGrooveSection(samples, 0.35, 10.0, 174, "high");
      applyGainRamp(samples, 10.0, 12.0, 1, 0.15);
      return { samples, durationSec, bpm: 174, expectedBeatOriginSec: 0.35 };
    }
    case "ambient-fallback": {
      const durationSec = 8;
      const samples = new Float32Array(Math.floor(durationSec * SAMPLE_RATE));
      return { samples, durationSec };
    }
    case "band-sweep": {
      const durationSec = 8;
      const samples = new Float32Array(Math.floor(durationSec * SAMPLE_RATE));
      const sections: BandEmphasis[] = ["low", "lowMid", "mid", "high"];
      sections.forEach((band, index) => {
        const start = index * 2;
        const end = start + 2;
        addPad(samples, start, end, band, band === "high" ? 0.18 : 0.22);
        for (let beat = start; beat < end; beat += 0.5) {
          addToneBurst(samples, beat, band === "high" ? 0.05 : 0.09, band, 0.25, 8);
        }
      });
      return { samples, durationSec, bpm: 120, expectedDominantBands: sections };
    }
  }
}

export async function createGeneratedSong(name: SongScenario): Promise<GeneratedSong> {
  const dir = await createTempDir(name);
  const { samples, durationSec, bpm, expectedBeatOriginSec, expectedDominantBands } = generateScenarioSamples(name);
  clampSamples(samples);
  const outputPath = path.join(dir, `${name}.wav`);
  await writeFile(outputPath, writeWavBuffer(samples));
  return {
    name,
    path: outputPath,
    sampleRate: SAMPLE_RATE,
    durationSec,
    bpm,
    expectedBeatOriginSec,
    expectedDominantBands,
  };
}

export async function createInvalidAudioFile(name = "invalid-audio"): Promise<string> {
  const dir = await createTempDir(name);
  const outputPath = path.join(dir, `${name}.txt`);
  await writeFile(outputPath, "not audio", "utf8");
  return outputPath;
}

export async function cleanupGeneratedAudio(): Promise<void> {
  await Promise.all(createdDirs.splice(0).map(async (dir) => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Best effort only for test cleanup.
    }
  }));
}
