import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { cleanupTemp, pathExists } from "./fs";

const createdPaths: string[] = [];

async function createTempFixture(name: string): Promise<string> {
  const dir = path.join(tmpdir(), `pad-pilot-visualizer-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  createdPaths.push(dir);
  await mkdir(path.join(dir, "nested"), { recursive: true });
  await writeFile(path.join(dir, "nested", "file.txt"), "fixture", "utf8");
  return dir;
}

afterEach(async () => {
  const previous = process.env.DEBUG_KEEP_TEMP;
  delete process.env.DEBUG_KEEP_TEMP;
  for (const target of createdPaths.splice(0)) {
    try {
      if (previous === undefined) {
        delete process.env.DEBUG_KEEP_TEMP;
      } else {
        process.env.DEBUG_KEEP_TEMP = previous;
      }
      await cleanupTemp(target);
    } catch {
      // Best effort only for test teardown.
    }
  }
  if (previous === undefined) {
    delete process.env.DEBUG_KEEP_TEMP;
  } else {
    process.env.DEBUG_KEEP_TEMP = previous;
  }
});

describe("cleanupTemp", () => {
  test("removes a temp workspace and reports success", async () => {
    const tempDir = await createTempFixture("cleanup");
    const result = await cleanupTemp(tempDir);
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.renamed).toBe(false);
    expect(await pathExists(tempDir)).toBe(false);
  });

  test("skips removal when DEBUG_KEEP_TEMP is enabled", async () => {
    const tempDir = await createTempFixture("keep");
    process.env.DEBUG_KEEP_TEMP = "1";
    const result = await cleanupTemp(tempDir);
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.finalPath).toBe(tempDir);
    expect(await pathExists(tempDir)).toBe(true);
  });
});
