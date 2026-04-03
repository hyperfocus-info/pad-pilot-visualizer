import { describe, expect, test } from "bun:test";
import { applyHeroParticleBatchWasm, applyParticleBatchWasm, sampleLuminanceWasm, sampleStridedFrameStatsWasm } from "./wasm-kernels";

describe("wasm kernels", () => {
  test("samples luminance from rgba data", () => {
    const rgba = Uint8Array.from([
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);

    const luminance = sampleLuminanceWasm(rgba);

    expect(luminance).toBeCloseTo(0.5, 5);
  });

  test("samples strided frame stats from rgba data", () => {
    const rgba = Uint8Array.from([
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);

    const stats = sampleStridedFrameStatsWasm({
      data: rgba,
      width: 2,
      height: 2,
      strideX: 1,
      strideY: 1,
    });

    expect(stats.sampleCount).toBe(4);
    expect(stats.darkSampleCount).toBe(2);
    expect(stats.luminanceSample).toBeCloseTo(0.5, 5);
    expect(stats.darkestQuartileLuminance).toBeCloseTo(0.03125, 5);
  });

  test("applies particle integration batch updates", () => {
    const x = new Float32Array([10, 20, 30, 40]);
    const y = new Float32Array([5, 15, 25, 35]);
    const vx = new Float32Array([1, -2, 0.5, 3]);
    const vy = new Float32Array([0.5, 1, -1, 2]);
    const age = new Uint16Array([0, 1, 2, 3]);
    const baseSize = new Float32Array([2, 4, 6, 8]);
    const currentSize = new Float32Array([0, 0, 0, 0]);
    const ax = new Float32Array([0.5, 0.5, -0.5, 1]);
    const ay = new Float32Array([1, -0.5, 0.5, -1]);
    const damping = new Float32Array([0.5, 1, 0.8, 0.25]);
    const pulseScale = new Float32Array([1, 1.5, 0.75, 2]);

    applyParticleBatchWasm({
      count: 4,
      x,
      y,
      vx,
      vy,
      age,
      baseSize,
      currentSize,
      ax,
      ay,
      damping,
      pulseScale,
      width: 100,
      height: 100,
    });

    expect(vx[0]).toBeCloseTo(0.75, 5);
    expect(vx[1]).toBeCloseTo(-1.5, 5);
    expect(vx[2]).toBeCloseTo(0, 5);
    expect(vx[3]).toBeCloseTo(1, 5);
    expect(vy[0]).toBeCloseTo(0.75, 5);
    expect(vy[1]).toBeCloseTo(0.5, 5);
    expect(vy[2]).toBeCloseTo(-0.4, 5);
    expect(vy[3]).toBeCloseTo(0.25, 5);
    expect(x[0]).toBeCloseTo(10.75, 5);
    expect(x[1]).toBeCloseTo(18.5, 5);
    expect(x[2]).toBeCloseTo(30, 5);
    expect(x[3]).toBeCloseTo(41, 5);
    expect(y[0]).toBeCloseTo(5.75, 5);
    expect(y[1]).toBeCloseTo(15.5, 5);
    expect(y[2]).toBeCloseTo(24.6, 5);
    expect(y[3]).toBeCloseTo(35.25, 5);
    expect([...age]).toEqual([1, 2, 3, 4]);
    expect(currentSize[0]).toBeCloseTo(2, 5);
    expect(currentSize[1]).toBeCloseTo(6, 5);
    expect(currentSize[2]).toBeCloseTo(4.5, 5);
    expect(currentSize[3]).toBeCloseTo(16, 5);
  });

  test("applies hero particle batch updates with drag and cooling", () => {
    const x = new Float32Array([10, 20]);
    const y = new Float32Array([5, 15]);
    const vx = new Float32Array([1, -2]);
    const vy = new Float32Array([0.5, 1]);
    const ax = new Float32Array([0.5, 0.25]);
    const ay = new Float32Array([1, -0.5]);
    const heat = new Float32Array([1, 0.5]);
    const size = new Float32Array([2, 4]);
    const drag = new Float32Array([0.8, 0.9]);
    const age = new Uint16Array([0, 1]);
    const ttl = new Uint16Array([10, 10]);

    applyHeroParticleBatchWasm({
      count: 2,
      x,
      y,
      vx,
      vy,
      ax,
      ay,
      heat,
      size,
      drag,
      age,
      ttl,
      width: 100,
      height: 100,
    });

    expect(vx[0]).toBeCloseTo(1.2, 5);
    expect(vx[1]).toBeCloseTo(-1.575, 5);
    expect(vy[0]).toBeCloseTo(1.2, 5);
    expect(vy[1]).toBeCloseTo(0.45, 5);
    expect(x[0]).toBeCloseTo(11.2, 5);
    expect(y[0]).toBeCloseTo(6.2, 5);
    expect(heat[0]).toBeLessThan(1);
    expect(heat[1]).toBeLessThan(0.5);
    expect(size[0]).toBeGreaterThan(1.97);
    expect([...age]).toEqual([1, 2]);
  });
});
