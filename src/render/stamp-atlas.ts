import { createCanvas } from "@napi-rs/canvas";
import type { HeroGlyphKind, PlacementLayer, ParticleShapeMode, ShapeStampKey } from "../types";

type StampShape = ParticleShapeMode | HeroGlyphKind;

function cacheKey(key: ShapeStampKey, color: string): string {
  return `${key.shape}:${key.sizeBucket}:${color}:${key.layer}:${key.purpose ?? "base"}:${key.variant ?? "base"}:${key.intent ?? "base"}`;
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: StampShape,
  size: number,
): void {
  switch (shape) {
    case "ring":
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "shard":
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.46);
      ctx.lineTo(size * 0.32, -size * 0.05);
      ctx.lineTo(size * 0.08, size * 0.34);
      ctx.lineTo(-size * 0.28, size * 0.12);
      ctx.closePath();
      ctx.fill();
      break;
    case "chevron":
      ctx.beginPath();
      ctx.moveTo(size * 0.34, 0);
      ctx.lineTo(-size * 0.1, -size * 0.3);
      ctx.lineTo(-size * 0.3, -size * 0.18);
      ctx.lineTo(0, 0);
      ctx.lineTo(-size * 0.3, size * 0.18);
      ctx.lineTo(-size * 0.1, size * 0.3);
      ctx.closePath();
      ctx.fill();
      break;
    case "diamond":
    case "glint":
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.42);
      ctx.lineTo(size * 0.32, 0);
      ctx.lineTo(0, size * 0.42);
      ctx.lineTo(-size * 0.32, 0);
      ctx.closePath();
      shape === "glint" ? ctx.stroke() : ctx.fill();
      break;
    case "arc":
    case "crescent":
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.42, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.stroke();
      break;
    case "hexagon":
      ctx.beginPath();
      for (let index = 0; index < 6; index += 1) {
        const angle = (Math.PI / 3) * index;
        const x = Math.cos(angle) * size * 0.42;
        const y = Math.sin(angle) * size * 0.42;
        index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    case "rose":
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2; a += 0.16) {
        const r = size * 0.4 * Math.cos(4 * a);
        const x = r * Math.cos(a);
        const y = r * Math.sin(a);
        a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    case "spiral":
      ctx.beginPath();
      for (let angle = 0; angle <= Math.PI * 5; angle += 0.18) {
        const r = (size * 0.42 / (Math.PI * 5)) * angle;
        const x = r * Math.cos(angle);
        const y = r * Math.sin(angle);
        angle === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    case "star":
      ctx.beginPath();
      for (let index = 0; index < 10; index += 1) {
        const angle = -Math.PI / 2 + index * (Math.PI / 5);
        const radius = index % 2 === 0 ? size * 0.44 : size * 0.18;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case "blob":
    case "dot":
    case "infinity":
    case "teardrop":
    default:
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}

export class ShapeStampAtlas {
  private readonly cache = new Map<string, any>();

  getStamp(key: ShapeStampKey, color: string) {
    const mapKey = cacheKey(key, color);
    const cached = this.cache.get(mapKey);
    if (cached) {
      return cached;
    }
    const size = Math.max(16, key.sizeBucket * 8);
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Unable to create stamp context.");
    }
    ctx.translate(size * 0.5, size * 0.5);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = key.layer === "hero" ? 1.8 : key.layer === "support" ? 1.2 : 1;
    if (key.purpose === "ambient-fog") {
      ctx.globalAlpha = 0.5;
      ctx.filter = "blur(2px)";
    } else if (key.purpose === "burst-remnant" || key.variant === "burst-falloff") {
      ctx.scale(1.15, 0.8);
    } else if (key.purpose === "ritual-ring") {
      ctx.scale(1.1, 1.1);
    } else if (key.variant === "braid-lane" || key.variant === "signal-drift") {
      ctx.scale(1.2, 0.75);
    }
    drawShape(ctx as unknown as CanvasRenderingContext2D, key.shape, size);
    this.cache.set(mapKey, canvas);
    return canvas;
  }
}
