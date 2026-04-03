import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CleanupTempResult } from "../types";

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function createTempWorkspace(prefix = "pad-pilot-visualizer-"): Promise<{
  tempDir: string;
  audioDir: string;
  imageDir: string;
  videoDir: string;
}> {
  const tempDir = await mkdtemp(path.join(tmpdir(), prefix));
  const audioDir = path.join(tempDir, "audio");
  const imageDir = path.join(tempDir, "images");
  const videoDir = path.join(tempDir, "video");
  await ensureDir(audioDir);
  await ensureDir(imageDir);
  await ensureDir(videoDir);
  return { tempDir, audioDir, imageDir, videoDir };
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isTransientCleanupError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
}

async function tryRemoveRecursive(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
}

async function removeWithRetry(target: string, delaysMs: number[]): Promise<{ ok: boolean; attempts: number; error?: unknown }> {
  let attempts = 0;
  let lastError: unknown;
  for (const delayMs of [0, ...delaysMs]) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    attempts += 1;
    try {
      await tryRemoveRecursive(target);
      return { ok: true, attempts };
    } catch (error) {
      lastError = error;
      if (!isTransientCleanupError(error)) {
        return { ok: false, attempts, error };
      }
    }
  }
  return { ok: false, attempts, error: lastError };
}

async function renameForDeferredCleanup(tempDir: string): Promise<string | undefined> {
  const parent = path.dirname(tempDir);
  const nextPath = path.join(
    parent,
    `pad-pilot-visualizer-cleanup-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await rename(tempDir, nextPath);
  return nextPath;
}

export async function cleanupTemp(tempDir: string): Promise<CleanupTempResult> {
  if (process.env.DEBUG_KEEP_TEMP === "1") {
    return {
      ok: true,
      tempDir,
      finalPath: tempDir,
      attempts: 0,
      renamed: false,
      skipped: true,
    };
  }
  const retryDelays = [80, 160, 320, 500, 750, 1000];
  const firstPass = await removeWithRetry(tempDir, retryDelays);
  if (firstPass.ok) {
    return {
      ok: true,
      tempDir,
      attempts: firstPass.attempts,
      renamed: false,
      skipped: false,
    };
  }

  let renamedPath: string | undefined;
  try {
    renamedPath = await renameForDeferredCleanup(tempDir);
  } catch (error) {
    return {
      ok: false,
      tempDir,
      finalPath: tempDir,
      attempts: firstPass.attempts,
      renamed: false,
      skipped: false,
      errorCode: getErrorCode(error) ?? getErrorCode(firstPass.error),
      errorMessage: error instanceof Error ? error.message : String(error ?? firstPass.error),
    };
  }
  if (!renamedPath) {
    return {
      ok: false,
      tempDir,
      finalPath: tempDir,
      attempts: firstPass.attempts,
      renamed: false,
      skipped: false,
      errorMessage: "Unable to rename temp workspace for deferred cleanup.",
    };
  }

  const secondPass = await removeWithRetry(renamedPath, retryDelays);
  if (secondPass.ok) {
    return {
      ok: true,
      tempDir,
      finalPath: renamedPath,
      attempts: firstPass.attempts + secondPass.attempts,
      renamed: true,
      skipped: false,
    };
  }

  const finalError = secondPass.error ?? firstPass.error;
  return {
    ok: false,
    tempDir,
    finalPath: renamedPath,
    attempts: firstPass.attempts + secondPass.attempts,
    renamed: true,
    skipped: false,
    errorCode: getErrorCode(finalError),
    errorMessage: finalError instanceof Error ? finalError.message : String(finalError),
  };
}
