import { spawn } from "node:child_process";

const MIN_LINES = 85;
const MIN_FUNCS = 85;
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

function runCoverage() {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32"
      ? "bun.cmd test --coverage --coverage-reporter=text"
      : "bun test --coverage --coverage-reporter=text";
    const child = spawn(command, [], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let output = "";
    const appendChunk = (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    };
    child.stdout.on("data", appendChunk);
    child.stderr.on("data", appendChunk);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Coverage run failed with exit code ${code ?? 1}`));
        return;
      }
      resolve(output);
    });
  });
}

const output = (await runCoverage()).replaceAll(ANSI_PATTERN, "");
const summaryMatch = output.match(/All files\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)/);

if (!summaryMatch) {
  console.error("Coverage gate failed: could not find Bun coverage summary line.");
  process.exit(1);
}

const funcs = Number.parseFloat(summaryMatch[1] ?? "0");
const lines = Number.parseFloat(summaryMatch[2] ?? "0");

if (!Number.isFinite(funcs) || !Number.isFinite(lines)) {
  console.error(`Coverage gate failed: could not parse summary line: ${summaryMatch[0]}`);
  process.exit(1);
}

if (lines < MIN_LINES || funcs < MIN_FUNCS) {
  console.error(`Coverage gate failed: lines=${lines.toFixed(2)} funcs=${funcs.toFixed(2)} expected>=${MIN_LINES}/${MIN_FUNCS}`);
  process.exit(1);
}

console.log(`Coverage gate passed: lines=${lines.toFixed(2)} funcs=${funcs.toFixed(2)}`);
