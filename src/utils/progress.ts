import { FRAME_STATUS_THROTTLE_MS } from "../config";

function formatEta(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hh = String(Math.floor(safe / 3600)).padStart(2, "0");
  const mm = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export class ProgressLine {
  private lastLine = "";
  private lastRenderAt = 0;
  private phase = "Starting";
  private startedAt = Date.now();

  setPhase(label: string): void {
    this.phase = label;
    this.render(`[${label}]`);
  }

  tick(current: number, total: number, extra = ""): void {
    const now = Date.now();
    if (now - this.lastRenderAt < FRAME_STATUS_THROTTLE_MS && current < total) {
      return;
    }

    const ratio = total > 0 ? current / total : 0;
    const elapsedSec = (now - this.startedAt) / 1000;
    const etaSec = ratio > 0 ? (elapsedSec * (1 - ratio)) / ratio : 0;
    const pct = (ratio * 100).toFixed(1);
    const suffix = extra ? ` ${extra}` : "";
    this.render(`[${this.phase}] ${current}/${total} (${pct}%) ETA ${formatEta(etaSec)}${suffix}`);
  }

  complete(message: string): void {
    this.status(message);
  }

  clear(): void {
    if (!this.lastLine) {
      return;
    }
    process.stdout.write(`\r${" ".repeat(this.lastLine.length)}\r`);
    this.lastLine = "";
  }

  status(message: string): void {
    this.clear();
    process.stdout.write(`${message}\n`);
  }

  warn(message: string): void {
    this.clear();
    process.stderr.write(`${message}\n`);
  }

  fail(message: string): void {
    this.clear();
    process.stderr.write(`${message}\n`);
  }

  private render(line: string): void {
    this.lastRenderAt = Date.now();
    const padding = this.lastLine.length > line.length ? " ".repeat(this.lastLine.length - line.length) : "";
    process.stdout.write(`\r${line}${padding}`);
    this.lastLine = line;
  }
}
