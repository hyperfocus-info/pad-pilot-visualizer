import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadDiagnosticState, parseCliOptionsFromArgv, parseParticleIntensityOption, parseWorkersOption, resolveAvailableOutputPath, resolveDebugDirForOutput, resolveDefaultedOutputPath, roundDurationToFourBarEnd, selectorFromOptions } from "./cli";
import type { CliOptions, DiagnosticStateFile } from "./types";

describe("roundDurationToFourBarEnd", () => {
  test("rounds duration to the nearest 16-beat phrase end with a minimum of one phrase", () => {
    expect(roundDurationToFourBarEnd("00:00:05", 110)).toBe("00:00:09");
  });

  test("keeps exact 4-bar boundaries unchanged", () => {
    expect(roundDurationToFourBarEnd("00:00:08", 120)).toBe("00:00:08");
  });

  test("rounds to the nearest later phrase when that boundary is closer", () => {
    expect(roundDurationToFourBarEnd("00:00:13", 120)).toBe("00:00:16");
  });
});

describe("selectorFromOptions", () => {
  const base: CliOptions = {
    input: "song.mp3",
    output: "out.mp4",
    fps: 30,
    workers: "auto",
    transition: 4,
  };

  test("resolves a node selector", () => {
    expect(selectorFromOptions({ ...base, probe: "node", probeIndex: 3 })).toEqual({
      type: "node",
      imageIndex: 3,
      phraseIndex: 3,
    });
  });

  test("resolves a transition selector", () => {
    expect(selectorFromOptions({ ...base, probe: "transition", probeFrom: 2, probeTo: 5 })).toEqual({
      type: "transition",
      fromImageIndex: 2,
      toImageIndex: 5,
    });
  });
});

describe("parseWorkersOption", () => {
  test("defaults to auto", () => {
    expect(parseWorkersOption(undefined)).toBe("auto");
    expect(parseWorkersOption("auto")).toBe("auto");
  });

  test("parses positive integers", () => {
    expect(parseWorkersOption("1")).toBe(1);
    expect(parseWorkersOption("4")).toBe(4);
  });

  test("rejects invalid worker values", () => {
    expect(() => parseWorkersOption("0")).toThrow("Workers must be 'auto' or a positive integer.");
    expect(() => parseWorkersOption("-2")).toThrow("Workers must be 'auto' or a positive integer.");
    expect(() => parseWorkersOption("many")).toThrow("Workers must be 'auto' or a positive integer.");
  });
});

describe("particle intensity options", () => {
  test("parses positive percentages", () => {
    expect(parseParticleIntensityOption("150")).toBe(150);
  });

  test("rejects invalid intensity values", () => {
    expect(() => parseParticleIntensityOption("0")).toThrow("Particle intensity must be a positive number.");
    expect(() => parseParticleIntensityOption("-5")).toThrow("Particle intensity must be a positive number.");
  });
});

describe("parseCliOptionsFromArgv", () => {
  test("defaults to max behavior and still parses particle intensity", () => {
    const options = parseCliOptionsFromArgv([
      "bun",
      "src/cli.ts",
      "--input",
      "song.mp3",
      "--theme",
      "test",
      "--particleIntensity",
      "150",
    ]);
    expect(options.particleIntensity).toBe(150);
  });

  test("supports the compatibility alias for particle intensity", () => {
    const options = parseCliOptionsFromArgv([
      "bun",
      "src/cli.ts",
      "--input",
      "song.mp3",
      "--theme",
      "test",
      "--partcleIntensity",
      "150",
    ]);
    expect(options.particleIntensity).toBe(150);
  });

  test("parses fast mode", () => {
    const options = parseCliOptionsFromArgv([
      "bun",
      "src/cli.ts",
      "--input",
      "song.mp3",
      "--theme",
      "test",
      "--fast",
    ]);
    expect(options.fast).toBe(true);
  });

  test("does not expose a seed option anymore", () => {
    const options = parseCliOptionsFromArgv([
      "bun",
      "src/cli.ts",
      "--input",
      "song.mp3",
      "--theme",
      "test",
    ]);
    expect("seed" in options).toBe(false);
  });
});

describe("diagnostic state loading", () => {
  test("loads legacy state files that still contain baseSeed", async () => {
    const root = path.join(tmpdir(), `ai-video-cli-state-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const statePath = path.join(root, "legacy-state.json");
    const legacyState = {
      audioPath: "song.mp3",
      imagePaths: ["one.png"],
      baseSeed: 1234,
      selectors: [{ type: "all-nodes" }],
      sweepModes: ["all"],
      renderSettings: { width: 1920, height: 1080, fps: 30 },
      acceptanceProfile: { grade: "B+" },
    } satisfies DiagnosticStateFile & { baseSeed: number };
    try {
      await writeFile(statePath, JSON.stringify(legacyState), "utf8");
      const loaded = await loadDiagnosticState(statePath);
      expect(loaded.audioPath).toBe("song.mp3");
      expect(loaded.selectors).toHaveLength(1);
      expect(loaded.acceptanceProfile.grade).toBe("B+");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("output defaults", () => {
  test("resolves bare output filenames under video", () => {
    expect(resolveDefaultedOutputPath("out.mp4")).toBe(path.resolve("video/out.mp4"));
  });

  test("resolves debug dir under debug by output basename", () => {
    expect(resolveDebugDirForOutput(path.resolve("video/out.mp4"))).toBe(path.resolve("debug/out"));
  });

  test("appends a numbered suffix when the requested output already exists", async () => {
    const root = path.join(tmpdir(), `ai-video-cli-output-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(root, { recursive: true });
    const requested = path.join(root, "render.mp4");
    try {
      await writeFile(requested, "existing", "utf8");
      expect(await resolveAvailableOutputPath(requested)).toBe(path.join(root, "render(1).mp4"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("skips to the next suffix when the matching debug directory already exists", async () => {
    const root = path.join(tmpdir(), `ai-video-cli-debug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const requested = path.join(root, "render.mp4");
    const requestedDebugDir = resolveDebugDirForOutput(requested);
    const firstCollisionDebugDir = resolveDebugDirForOutput(path.join(root, "render(1).mp4"));
    await mkdir(root, { recursive: true });
    await mkdir(requestedDebugDir, { recursive: true });
    await mkdir(firstCollisionDebugDir, { recursive: true });
    try {
      expect(await resolveAvailableOutputPath(requested)).toBe(path.join(root, "render(2).mp4"));
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(requestedDebugDir, { recursive: true, force: true });
      await rm(firstCollisionDebugDir, { recursive: true, force: true });
    }
  });
});
