import wabtInit from "wabt";

const watSource = `
(module
  (memory (export "memory") 1)

  (func (export "sample_luminance_rgba") (param $ptr i32) (param $len i32) (result f32)
    (local $i i32)
    (local $sum f32)
    (local $count f32)
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $sum
          (f32.add
            (local.get $sum)
            (f32.div
              (f32.add
                (f32.add
                  (f32.mul (f32.convert_i32_u (i32.load8_u (i32.add (local.get $ptr) (local.get $i)))) (f32.const 0.2126))
                  (f32.mul (f32.convert_i32_u (i32.load8_u (i32.add (i32.add (local.get $ptr) (local.get $i)) (i32.const 1)))) (f32.const 0.7152))
                )
                (f32.mul (f32.convert_i32_u (i32.load8_u (i32.add (i32.add (local.get $ptr) (local.get $i)) (i32.const 2)))) (f32.const 0.0722))
              )
              (f32.const 255)
            )
          )
        )
        (local.set $count (f32.add (local.get $count) (f32.const 1)))
        (local.set $i (i32.add (local.get $i) (i32.const 4)))
        (br $loop)
      )
    )
    (if (result f32)
      (f32.gt (local.get $count) (f32.const 0))
      (then (f32.div (local.get $sum) (local.get $count)))
      (else (f32.const 0))
    )
  )

  (func (export "sample_strided_luminance_rgba")
    (param $ptr i32)
    (param $width i32)
    (param $height i32)
    (param $strideX i32)
    (param $strideY i32)
    (result f32)
    (local $x i32)
    (local $y i32)
    (local $offset i32)
    (local $sum f32)
    (local $count f32)
    (block $doneY
      (loop $loopY
        (br_if $doneY (i32.ge_u (local.get $y) (local.get $height)))
        (local.set $x (i32.const 0))
        (block $doneX
          (loop $loopX
            (br_if $doneX (i32.ge_u (local.get $x) (local.get $width)))
            (local.set $offset
              (i32.add
                (local.get $ptr)
                (i32.mul
                  (i32.add
                    (i32.mul (local.get $y) (local.get $width))
                    (local.get $x)
                  )
                  (i32.const 4)
                )
              )
            )
            (local.set $sum
              (f32.add
                (local.get $sum)
                (f32.div
                  (f32.add
                    (f32.add
                      (f32.mul (f32.convert_i32_u (i32.load8_u (local.get $offset))) (f32.const 0.2126))
                      (f32.mul (f32.convert_i32_u (i32.load8_u (i32.add (local.get $offset) (i32.const 1)))) (f32.const 0.7152))
                    )
                    (f32.mul (f32.convert_i32_u (i32.load8_u (i32.add (local.get $offset) (i32.const 2)))) (f32.const 0.0722))
                  )
                  (f32.const 255)
                )
              )
            )
            (local.set $count (f32.add (local.get $count) (f32.const 1)))
            (local.set $x (i32.add (local.get $x) (local.get $strideX)))
            (br $loopX)
          )
        )
        (local.set $y (i32.add (local.get $y) (local.get $strideY)))
        (br $loopY)
      )
    )
    (if (result f32)
      (f32.gt (local.get $count) (f32.const 0))
      (then (f32.div (local.get $sum) (local.get $count)))
      (else (f32.const 0))
    )
  )

  (func (export "count_dark_strided_rgba")
    (param $ptr i32)
    (param $width i32)
    (param $height i32)
    (param $strideX i32)
    (param $strideY i32)
    (result i32)
    (local $x i32)
    (local $y i32)
    (local $offset i32)
    (local $luminance f32)
    (local $count i32)
    (block $doneY
      (loop $loopY
        (br_if $doneY (i32.ge_u (local.get $y) (local.get $height)))
        (local.set $x (i32.const 0))
        (block $doneX
          (loop $loopX
            (br_if $doneX (i32.ge_u (local.get $x) (local.get $width)))
            (local.set $offset
              (i32.add
                (local.get $ptr)
                (i32.mul
                  (i32.add
                    (i32.mul (local.get $y) (local.get $width))
                    (local.get $x)
                  )
                  (i32.const 4)
                )
              )
            )
            (local.set $luminance
              (f32.div
                (f32.add
                  (f32.add
                    (f32.mul (f32.convert_i32_u (i32.load8_u (local.get $offset))) (f32.const 0.2126))
                    (f32.mul (f32.convert_i32_u (i32.load8_u (i32.add (local.get $offset) (i32.const 1)))) (f32.const 0.7152))
                  )
                  (f32.mul (f32.convert_i32_u (i32.load8_u (i32.add (local.get $offset) (i32.const 2)))) (f32.const 0.0722))
                )
                (f32.const 255)
              )
            )
            (if
              (f32.lt (local.get $luminance) (f32.const 0.02))
              (then
                (local.set $count (i32.add (local.get $count) (i32.const 1)))
              )
            )
            (local.set $x (i32.add (local.get $x) (local.get $strideX)))
            (br $loopX)
          )
        )
        (local.set $y (i32.add (local.get $y) (local.get $strideY)))
        (br $loopY)
      )
    )
    (local.get $count)
  )

  (func (export "particle_apply_batch")
    (param $count i32)
    (param $xPtr i32)
    (param $yPtr i32)
    (param $vxPtr i32)
    (param $vyPtr i32)
    (param $agePtr i32)
    (param $baseSizePtr i32)
    (param $currentSizePtr i32)
    (param $axPtr i32)
    (param $ayPtr i32)
    (param $dampingPtr i32)
    (param $pulsePtr i32)
    (param $width f32)
    (param $height f32)
    (local $i i32)
    (local $offset i32)
    (local $vx f32) (local $vy f32)
    (local $x f32) (local $y f32)
    (local $widthVec v128)
    (local $heightVec v128)
    (local $zeroVec v128)
    (local $xVec v128) (local $yVec v128) (local $vxVec v128) (local $vyVec v128)
    (local.set $widthVec (f32x4.splat (local.get $width)))
    (local.set $heightVec (f32x4.splat (local.get $height)))
    (local.set $zeroVec (f32x4.splat (f32.const 0)))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $count)))
        (if
          (i32.le_u (i32.add (local.get $i) (i32.const 4)) (local.get $count))
          (then
            (local.set $vxVec
              (f32x4.mul
                (f32x4.add
                  (v128.load (i32.add (local.get $vxPtr) (i32.mul (local.get $i) (i32.const 4))))
                  (v128.load (i32.add (local.get $axPtr) (i32.mul (local.get $i) (i32.const 4))))
                )
                (v128.load (i32.add (local.get $dampingPtr) (i32.mul (local.get $i) (i32.const 4))))
              )
            )
            (local.set $vyVec
              (f32x4.mul
                (f32x4.add
                  (v128.load (i32.add (local.get $vyPtr) (i32.mul (local.get $i) (i32.const 4))))
                  (v128.load (i32.add (local.get $ayPtr) (i32.mul (local.get $i) (i32.const 4))))
                )
                (v128.load (i32.add (local.get $dampingPtr) (i32.mul (local.get $i) (i32.const 4))))
              )
            )
            (local.set $xVec
              (f32x4.pmin
                (local.get $widthVec)
                (f32x4.pmax
                  (local.get $zeroVec)
                  (f32x4.add
                    (v128.load (i32.add (local.get $xPtr) (i32.mul (local.get $i) (i32.const 4))))
                    (local.get $vxVec)
                  )
                )
              )
            )
            (local.set $yVec
              (f32x4.pmin
                (local.get $heightVec)
                (f32x4.pmax
                  (local.get $zeroVec)
                  (f32x4.add
                    (v128.load (i32.add (local.get $yPtr) (i32.mul (local.get $i) (i32.const 4))))
                    (local.get $vyVec)
                  )
                )
              )
            )
            (v128.store (i32.add (local.get $vxPtr) (i32.mul (local.get $i) (i32.const 4))) (local.get $vxVec))
            (v128.store (i32.add (local.get $vyPtr) (i32.mul (local.get $i) (i32.const 4))) (local.get $vyVec))
            (v128.store (i32.add (local.get $xPtr) (i32.mul (local.get $i) (i32.const 4))) (local.get $xVec))
            (v128.store (i32.add (local.get $yPtr) (i32.mul (local.get $i) (i32.const 4))) (local.get $yVec))
            (v128.store
              (i32.add (local.get $currentSizePtr) (i32.mul (local.get $i) (i32.const 4)))
              (f32x4.mul
                (v128.load (i32.add (local.get $baseSizePtr) (i32.mul (local.get $i) (i32.const 4))))
                (v128.load (i32.add (local.get $pulsePtr) (i32.mul (local.get $i) (i32.const 4))))
              )
            )
            (i32.store16
              (i32.add (local.get $agePtr) (i32.mul (local.get $i) (i32.const 2)))
              (i32.add
                (i32.load16_u (i32.add (local.get $agePtr) (i32.mul (local.get $i) (i32.const 2))))
                (i32.const 1)
              )
            )
            (i32.store16
              (i32.add (local.get $agePtr) (i32.mul (i32.add (local.get $i) (i32.const 1)) (i32.const 2)))
              (i32.add
                (i32.load16_u (i32.add (local.get $agePtr) (i32.mul (i32.add (local.get $i) (i32.const 1)) (i32.const 2))))
                (i32.const 1)
              )
            )
            (i32.store16
              (i32.add (local.get $agePtr) (i32.mul (i32.add (local.get $i) (i32.const 2)) (i32.const 2)))
              (i32.add
                (i32.load16_u (i32.add (local.get $agePtr) (i32.mul (i32.add (local.get $i) (i32.const 2)) (i32.const 2))))
                (i32.const 1)
              )
            )
            (i32.store16
              (i32.add (local.get $agePtr) (i32.mul (i32.add (local.get $i) (i32.const 3)) (i32.const 2)))
              (i32.add
                (i32.load16_u (i32.add (local.get $agePtr) (i32.mul (i32.add (local.get $i) (i32.const 3)) (i32.const 2))))
                (i32.const 1)
              )
            )
            (local.set $i (i32.add (local.get $i) (i32.const 4)))
          )
          (else
            (local.set $offset (i32.mul (local.get $i) (i32.const 4)))
            (local.set $vx
              (f32.mul
                (f32.add
                  (f32.load (i32.add (local.get $vxPtr) (local.get $offset)))
                  (f32.load (i32.add (local.get $axPtr) (local.get $offset)))
                )
                (f32.load (i32.add (local.get $dampingPtr) (local.get $offset)))
              )
            )
            (local.set $vy
              (f32.mul
                (f32.add
                  (f32.load (i32.add (local.get $vyPtr) (local.get $offset)))
                  (f32.load (i32.add (local.get $ayPtr) (local.get $offset)))
                )
                (f32.load (i32.add (local.get $dampingPtr) (local.get $offset)))
              )
            )
            (local.set $x
              (f32.min
                (local.get $width)
                (f32.max (f32.const 0) (f32.add (f32.load (i32.add (local.get $xPtr) (local.get $offset))) (local.get $vx)))
              )
            )
            (local.set $y
              (f32.min
                (local.get $height)
                (f32.max (f32.const 0) (f32.add (f32.load (i32.add (local.get $yPtr) (local.get $offset))) (local.get $vy)))
              )
            )
            (f32.store (i32.add (local.get $vxPtr) (local.get $offset)) (local.get $vx))
            (f32.store (i32.add (local.get $vyPtr) (local.get $offset)) (local.get $vy))
            (f32.store (i32.add (local.get $xPtr) (local.get $offset)) (local.get $x))
            (f32.store (i32.add (local.get $yPtr) (local.get $offset)) (local.get $y))
            (f32.store
              (i32.add (local.get $currentSizePtr) (local.get $offset))
              (f32.mul
                (f32.load (i32.add (local.get $baseSizePtr) (local.get $offset)))
                (f32.load (i32.add (local.get $pulsePtr) (local.get $offset)))
              )
            )
            (i32.store16
              (i32.add (local.get $agePtr) (i32.mul (local.get $i) (i32.const 2)))
              (i32.add
                (i32.load16_u (i32.add (local.get $agePtr) (i32.mul (local.get $i) (i32.const 2))))
                (i32.const 1)
              )
            )
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
          )
        )
        (br $loop)
      )
    )
  )
)
`;

type Exports = {
  memory: WebAssembly.Memory;
  sample_luminance_rgba: (ptr: number, len: number) => number;
  sample_strided_luminance_rgba: (ptr: number, width: number, height: number, strideX: number, strideY: number) => number;
  count_dark_strided_rgba: (ptr: number, width: number, height: number, strideX: number, strideY: number) => number;
  particle_apply_batch: (
    count: number,
    xPtr: number,
    yPtr: number,
    vxPtr: number,
    vyPtr: number,
    agePtr: number,
    baseSizePtr: number,
    currentSizePtr: number,
    axPtr: number,
    ayPtr: number,
    dampingPtr: number,
    pulsePtr: number,
    width: number,
    height: number,
  ) => void;
};

const wabt = await wabtInit();
const parsed = wabt.parseWat("perf-kernels.wat", watSource, { simd: true });
const { buffer } = parsed.toBinary({ write_debug_names: false });
const { instance } = await WebAssembly.instantiate(buffer);
const exportsRef = instance.exports as unknown as Exports;
const memory = exportsRef.memory;

function ensureCapacity(byteLength: number): void {
  const requiredPages = Math.ceil(byteLength / 65536);
  const currentPages = memory.buffer.byteLength / 65536;
  if (requiredPages > currentPages) {
    memory.grow(requiredPages - currentPages);
  }
}

function alignOffset(offset: number, alignment: number): number {
  const remainder = offset % alignment;
  return remainder === 0 ? offset : offset + (alignment - remainder);
}

export function sampleLuminanceWasm(data: Uint8Array): number {
  ensureCapacity(data.byteLength);
  new Uint8Array(memory.buffer, 0, data.byteLength).set(data);
  return exportsRef.sample_luminance_rgba(0, data.byteLength);
}

export function sampleStridedFrameStatsWasm(params: {
  data: Uint8Array;
  width: number;
  height: number;
  strideX: number;
  strideY: number;
}): { luminanceSample: number; darkestQuartileLuminance: number; darkSampleCount: number; sampleCount: number } {
  ensureCapacity(params.data.byteLength);
  new Uint8Array(memory.buffer, 0, params.data.byteLength).set(params.data);
  const luminanceSample = exportsRef.sample_strided_luminance_rgba(0, params.width, params.height, params.strideX, params.strideY);
  const darkSampleCount = exportsRef.count_dark_strided_rgba(0, params.width, params.height, params.strideX, params.strideY);
  const sampleCount =
    Math.ceil(params.width / Math.max(1, params.strideX)) *
    Math.ceil(params.height / Math.max(1, params.strideY));
  const histogramBins = 16;
  const histogram = new Uint32Array(histogramBins);
  for (let y = 0; y < params.height; y += Math.max(1, params.strideY)) {
    for (let x = 0; x < params.width; x += Math.max(1, params.strideX)) {
      const offset = (y * params.width + x) * 4;
      const luminance =
        (params.data[offset]! * 0.2126 +
          params.data[offset + 1]! * 0.7152 +
          params.data[offset + 2]! * 0.0722) /
        255;
      const bin = Math.min(histogramBins - 1, Math.max(0, Math.floor(luminance * histogramBins)));
      histogram[bin] += 1;
    }
  }
  const quartileTarget = Math.max(1, Math.ceil(sampleCount * 0.25));
  let cumulative = 0;
  let darkestQuartileLuminance = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index] ?? 0;
    if (cumulative >= quartileTarget) {
      darkestQuartileLuminance = (index + 0.5) / histogramBins;
      break;
    }
  }
  return { luminanceSample, darkestQuartileLuminance, darkSampleCount, sampleCount };
}

export function applyParticleBatchWasm(params: {
  count: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  age: Uint16Array;
  baseSize: Float32Array;
  currentSize: Float32Array;
  ax: Float32Array;
  ay: Float32Array;
  damping: Float32Array;
  pulseScale: Float32Array;
  width: number;
  height: number;
}): void {
  const floatBytes = params.count * Float32Array.BYTES_PER_ELEMENT;
  const ageBytes = params.count * Uint16Array.BYTES_PER_ELEMENT;
  const totalBytes = floatBytes * 10 + ageBytes + Float32Array.BYTES_PER_ELEMENT;
  ensureCapacity(totalBytes);
  let offset = 0;
  try {
    const xPtr = offset; new Float32Array(memory.buffer, xPtr, params.count).set(params.x.subarray(0, params.count)); offset += floatBytes;
    const yPtr = offset; new Float32Array(memory.buffer, yPtr, params.count).set(params.y.subarray(0, params.count)); offset += floatBytes;
    const vxPtr = offset; new Float32Array(memory.buffer, vxPtr, params.count).set(params.vx.subarray(0, params.count)); offset += floatBytes;
    const vyPtr = offset; new Float32Array(memory.buffer, vyPtr, params.count).set(params.vy.subarray(0, params.count)); offset += floatBytes;
    const agePtr = offset; new Uint16Array(memory.buffer, agePtr, params.count).set(params.age.subarray(0, params.count)); offset += ageBytes;
    offset = alignOffset(offset, Float32Array.BYTES_PER_ELEMENT);
    const baseSizePtr = offset; new Float32Array(memory.buffer, baseSizePtr, params.count).set(params.baseSize.subarray(0, params.count)); offset += floatBytes;
    const currentSizePtr = offset; new Float32Array(memory.buffer, currentSizePtr, params.count).set(params.currentSize.subarray(0, params.count)); offset += floatBytes;
    const axPtr = offset; new Float32Array(memory.buffer, axPtr, params.count).set(params.ax.subarray(0, params.count)); offset += floatBytes;
    const ayPtr = offset; new Float32Array(memory.buffer, ayPtr, params.count).set(params.ay.subarray(0, params.count)); offset += floatBytes;
    const dampingPtr = offset; new Float32Array(memory.buffer, dampingPtr, params.count).set(params.damping.subarray(0, params.count)); offset += floatBytes;
    const pulsePtr = offset; new Float32Array(memory.buffer, pulsePtr, params.count).set(params.pulseScale.subarray(0, params.count));

    exportsRef.particle_apply_batch(
      params.count,
      xPtr,
      yPtr,
      vxPtr,
      vyPtr,
      agePtr,
      baseSizePtr,
      currentSizePtr,
      axPtr,
      ayPtr,
      dampingPtr,
      pulsePtr,
      params.width,
      params.height,
    );

    params.x.set(new Float32Array(memory.buffer, xPtr, params.count), 0);
    params.y.set(new Float32Array(memory.buffer, yPtr, params.count), 0);
    params.vx.set(new Float32Array(memory.buffer, vxPtr, params.count), 0);
    params.vy.set(new Float32Array(memory.buffer, vyPtr, params.count), 0);
    params.age.set(new Uint16Array(memory.buffer, agePtr, params.count), 0);
    params.currentSize.set(new Float32Array(memory.buffer, currentSizePtr, params.count), 0);
  } catch (error) {
    throw new Error(
      `Particle WASM batch failed count=${params.count} floatBytes=${floatBytes} ageBytes=${ageBytes}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function applyHeroParticleBatchWasm(params: {
  count: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  ax: Float32Array;
  ay: Float32Array;
  heat: Float32Array;
  size: Float32Array;
  drag: Float32Array;
  age: Uint16Array;
  ttl: Uint16Array;
  width: number;
  height: number;
}): void {
  for (let index = 0; index < params.count; index += 1) {
    params.vx[index] = (params.vx[index]! + params.ax[index]!) * clamp01(params.drag[index]!);
    params.vy[index] = (params.vy[index]! + params.ay[index]!) * clamp01(params.drag[index]!);
    params.x[index] = Math.min(params.width, Math.max(0, params.x[index]! + params.vx[index]!));
    params.y[index] = Math.min(params.height, Math.max(0, params.y[index]! + params.vy[index]!));
    params.heat[index] = Math.max(0, params.heat[index]! * (0.94 - (1 - clamp01(params.drag[index]!)) * 0.08));
    params.size[index] = Math.max(0.02, params.size[index]! * (0.988 + params.heat[index]! * 0.002));
    params.age[index] = Math.min(65535, params.age[index]! + 1);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
