import { describe, expect, test } from "bun:test";
import { classifyAnchorTrustState, computeBeatGridState, selectBeatOrigin, selectTrustedBpm, type BeatOriginCandidate } from "./audio-core";

// Bucket: contract/invariant

function candidate(
  timeSec: number,
  peakStrength: number,
  lowBandShare: number,
  postPeakSilenceDrop = 0.8,
  localRegularityScore = 0.8,
): BeatOriginCandidate {
  return {
    timeSec,
    peakStrength,
    lowBandShare,
    postPeakSilenceDrop,
    localRegularityScore,
  };
}

describe("selectBeatOrigin", () => {
  test("picks the earliest near-best groove-aligned candidate", () => {
    const result = selectBeatOrigin({
      bpm: 120,
      durationSec: 8,
      searchStartSec: 0,
      searchEndSec: 4,
      candidates: [
        candidate(0.5, 1, 0.9),
        candidate(1.0, 0.95, 0.9),
        candidate(1.5, 0.9, 0.85),
        candidate(2.0, 0.92, 0.88),
        candidate(2.5, 0.93, 0.87),
        candidate(3.0, 0.9, 0.9),
        candidate(3.5, 0.88, 0.86),
      ],
    });

    expect(result.source).toBe("transient-anchor");
    expect(result.beatOriginSec).toBe(0.5);
    expect(result.supportHitCount).toBeGreaterThanOrEqual(4);
  });

  test("rejects an isolated early hit when a later groove candidate fits the grid", () => {
    const result = selectBeatOrigin({
      bpm: 120,
      durationSec: 8,
      searchStartSec: 0,
      searchEndSec: 4,
      candidates: [
        candidate(0.2, 1.1, 0.15, 0.15, 0.2),
        candidate(1.0, 1, 0.95),
        candidate(1.5, 0.92, 0.88),
        candidate(2.0, 0.94, 0.9),
        candidate(2.5, 0.9, 0.87),
        candidate(3.0, 0.88, 0.85),
      ],
    });

    expect(result.source).toBe("transient-anchor");
    expect(result.beatOriginSec).toBe(1.0);
  });

  test("falls back to zero when no candidate reaches confidence and support thresholds", () => {
    const result = selectBeatOrigin({
      bpm: 120,
      durationSec: 4,
      searchStartSec: 0,
      searchEndSec: 2,
      candidates: [
        candidate(0.35, 0.4, 0.2, 0.1, 0.1),
        candidate(0.9, 0.42, 0.15, 0.12, 0.15),
        candidate(1.6, 0.38, 0.2, 0.1, 0.1),
      ],
    });

    expect(result.source).toBe("fallback-zero");
    expect(result.beatOriginSec).toBe(0);
    expect(result.supportHitCount).toBe(0);
  });

  test("prefers groove-supporting low-band candidates over click-heavy alternatives", () => {
    const result = selectBeatOrigin({
      bpm: 120,
      durationSec: 8,
      searchStartSec: 0,
      searchEndSec: 4,
      candidates: [
        candidate(0.48, 1, 0.05, 0.18, 0.25),
        candidate(1.0, 0.98, 0.95, 0.85, 0.9),
        candidate(1.5, 0.94, 0.9),
        candidate(2.0, 0.91, 0.88),
        candidate(2.5, 0.9, 0.89),
        candidate(3.0, 0.89, 0.86),
      ],
    });

    expect(result.source).toBe("transient-anchor");
    expect(result.beatOriginSec).toBe(1.0);
  });
});

describe("computeBeatGridState", () => {
  test("rebases beat phases to the selected beat origin", () => {
    const state = computeBeatGridState(1.25, 0.5, 1.25);

    expect(state.beatAlignedTimeSec).toBeCloseTo(0, 6);
    expect(state.beatPhase).toBeCloseTo(0, 6);
    expect(state.subBeatPhase).toBeCloseTo(0, 6);
    expect(state.barPhase).toBeCloseTo(0, 6);
    expect(state.isPreAnchor).toBe(false);
  });

  test("flags pre-anchor frames while preserving wrapped phase math", () => {
    const state = computeBeatGridState(0.75, 0.5, 1.0);

    expect(state.beatAlignedTimeSec).toBeCloseTo(-0.25, 6);
    expect(state.beatPhase).toBeCloseTo(0.5, 6);
    expect(state.isPreAnchor).toBe(true);
  });
});

describe("selectTrustedBpm", () => {
  test("keeps metadata when it is close to the estimate", () => {
    const result = selectTrustedBpm({
      metadataBpm: 140,
      metadataSource: "source-metadata",
      estimatedBpm: 144,
      beatOriginSource: "transient-anchor",
      beatOriginConfidence: 0.8,
      defaultBpm: 120,
    });

    expect(result.bpm).toBe(140);
    expect(result.bpmSource).toBe("source-metadata");
    expect(result.bpmTrustState).toBe("trusted-metadata");
  });

  test("rejects metadata when the estimate diverges and anchor trust is weak", () => {
    const result = selectTrustedBpm({
      metadataBpm: 128,
      metadataSource: "source-metadata",
      estimatedBpm: 85,
      beatOriginSource: "fallback-zero",
      beatOriginConfidence: 0.5,
      defaultBpm: 120,
    });

    expect(result.bpm).toBe(85);
    expect(result.bpmSource).toBe("estimated");
    expect(result.bpmTrustState).toBe("metadata-rejected");
  });

  test("keeps metadata when estimate resolves as double-time", () => {
    const result = selectTrustedBpm({
      metadataBpm: 128,
      metadataSource: "source-metadata",
      estimatedBpm: 64,
      beatOriginSource: "transient-anchor",
      beatOriginConfidence: 0.8,
      defaultBpm: 120,
    });

    expect(result.bpm).toBe(128);
    expect(result.bpmTrustState).toBe("trusted-metadata-half-double-resolved");
  });
});

describe("classifyAnchorTrustState", () => {
  test("downgrades low-confidence transient anchors to weak-anchor", () => {
    expect(classifyAnchorTrustState("transient-anchor", 0.65)).toBe("weak-anchor");
  });

  test("keeps fallback-zero explicit", () => {
    expect(classifyAnchorTrustState("fallback-zero", 0.5)).toBe("fallback-zero");
  });
});
