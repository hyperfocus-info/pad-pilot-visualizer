import { afterAll, describe, expect, test } from "bun:test";
import { createGeneratedSong, createInvalidAudioFile, cleanupGeneratedAudio } from "../../test/helpers/audio-fixtures";
import { probeAudio, resolveFfprobePath } from "./ffmpeg";

// Bucket: behavioral

afterAll(async () => {
  await cleanupGeneratedAudio();
});

describe("ffmpeg integration", () => {
  test("probeAudio reads generated wav metadata", async () => {
    const song = await createGeneratedSong("clean-kick-120");
    const metadata = await probeAudio(resolveFfprobePath(), song.path);

    expect(metadata.durationSec).toBeGreaterThan(7.9);
    expect(metadata.durationSec).toBeLessThan(8.1);
    expect(metadata.sampleRate).toBe(song.sampleRate);
    expect(metadata.channels).toBe(1);
  });

  test("probeAudio rejects invalid non-audio input", async () => {
    const inputPath = `${await createInvalidAudioFile()}.missing`;
    await expect(probeAudio(resolveFfprobePath(), inputPath)).rejects.toThrow();
  });
});
