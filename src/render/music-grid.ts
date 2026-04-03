import type { AudioFrameFeature } from "../types";

export function enrichFrameWithMusicGrid(frame: AudioFrameFeature, bpm: number, beatOriginSec: number): AudioFrameFeature {
  const secondsPerBeat = 60 / Math.max(1, bpm);
  const alignedTimeSec = frame.beatAlignedTimeSec ?? (frame.timeSec - beatOriginSec);
  const beatIndex = Math.floor(alignedTimeSec / secondsPerBeat + 1e-4);
  const barIndex = Math.floor(beatIndex / 4);
  const phrase4Index = Math.floor(beatIndex / 16);
  const localBarPhase = ((alignedTimeSec / (secondsPerBeat * 4)) % 1 + 1) % 1;
  const localPhrasePhase = ((alignedTimeSec / (secondsPerBeat * 16)) % 1 + 1) % 1;
  const barPulse = frame.isPreAnchor ? 0 : Math.pow(Math.max(0, 1 - localBarPhase / 0.18), 2.1);
  const phrasePulse = frame.isPreAnchor ? 0 : Math.pow(Math.max(0, 1 - localPhrasePhase / 0.2), 2.4);

  return {
    ...frame,
    beatIndex,
    barIndex,
    phrase4Index,
    isBeatAccent: !frame.isPreAnchor && (frame.beatPhase < 0.08 || frame.beatPulse > 0.82),
    isBarDownbeat: !frame.isPreAnchor && beatIndex % 4 === 0 && frame.beatPhase < 0.11,
    isFourBarDownbeat: !frame.isPreAnchor && beatIndex % 16 === 0 && frame.beatPhase < 0.11,
    barPulse,
    phrasePulse,
  };
}
