import { afterEach, describe, expect, test } from "bun:test";
import { ProgressLine } from "./progress";

const originalStdout = process.stdout.write;
const originalStderr = process.stderr.write;
const stdout: string[] = [];
const stderr: string[] = [];

afterEach(() => {
  process.stdout.write = originalStdout.bind(process.stdout);
  process.stderr.write = originalStderr.bind(process.stderr);
  stdout.length = 0;
  stderr.length = 0;
});

describe("progress line", () => {
  test("renders status, warnings, and completion messages", () => {
    process.stdout.write = ((chunk: string | Uint8Array) => { stdout.push(String(chunk)); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => { stderr.push(String(chunk)); return true; }) as typeof process.stderr.write;
    const progress = new ProgressLine();
    progress.setPhase("Render");
    progress.tick(1, 2, "chunk=0");
    progress.complete("done");
    progress.warn("warn");
    progress.fail("fail");
    expect(stdout.join("")).toContain("[Render]");
    expect(stdout.join("")).toContain("done");
    expect(stderr.join("")).toContain("warn");
    expect(stderr.join("")).toContain("fail");
  });
});
