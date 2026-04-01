/**
 * Streaming pitch shift using a delay ring (reads continuous audio, not “looping” one block).
 * Replaces the old block-circular approach that caused strong buzz / boundary artifacts.
 */

export type PitchRingState = {
  ring: Float32Array;
  writePos: number;
  readPos: number;
  initialized: boolean;
};

const RING_SIZE = 32768;
/** Minimum read lag behind write so interpolation always has valid samples. */
const MIN_READ_LAG = 8192;

export function createPitchRingState(): PitchRingState {
  return {
    ring: new Float32Array(RING_SIZE),
    writePos: 0,
    readPos: 0,
    initialized: false,
  };
}

export function resetPitchRingState(state: PitchRingState): void {
  state.ring.fill(0);
  state.writePos = 0;
  state.readPos = 0;
  state.initialized = false;
}

/** Catmull–Rom between p1 and p2 (t in [0,1]); smoother than linear for resampling. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function ringSample(ring: Float32Array, R: number, index: number): number {
  const i = ((Math.floor(index) % R) + R) % R;
  return ring[i]!;
}

/** Shortest signed delta from `from` to `to` on a length-R ring (both in [0, R)). */
function ringDelta(from: number, to: number, R: number): number {
  let d = to - from;
  if (d > R / 2) d -= R;
  if (d < -R / 2) d += R;
  return d;
}

function clampReadLagTarget(writePos: number, R: number): number {
  return (((writePos - MIN_READ_LAG + R * 2) % R) + R) % R;
}

/**
 * Write one block into the ring, then produce `input.length` output samples by reading
 * through the ring at `ratio` times normal speed (target/input pitch ratio).
 */
export function pitchShiftRingBlock(
  state: PitchRingState,
  input: Float32Array,
  ratio: number
): Float32Array {
  const R = state.ring.length;
  const n = input.length;
  const out = new Float32Array(n);

  const r = ratio > 0 && isFinite(ratio) ? Math.max(0.25, Math.min(4, ratio)) : 1;

  for (let i = 0; i < n; i++) {
    state.ring[(state.writePos + i) % R] = input[i]!;
  }
  state.writePos = (state.writePos + n) % R;

  if (!state.initialized) {
    state.readPos = clampReadLagTarget(state.writePos, R);
    state.initialized = true;
  }

  let rp = state.readPos;
  for (let i = 0; i < n; i++) {
    const base = Math.floor(rp);
    const frac = rp - base;
    const p0 = ringSample(state.ring, R, base - 1);
    const p1 = ringSample(state.ring, R, base);
    const p2 = ringSample(state.ring, R, base + 1);
    const p3 = ringSample(state.ring, R, base + 2);
    let y = catmullRom(p0, p1, p2, p3, frac);
    // Cubic overshoot near loud transients — blend down before hard clip to reduce crackle.
    if (y > 1 || y < -1) {
      const lin = p1 * (1 - frac) + p2 * frac;
      y = y * 0.55 + lin * 0.45;
    }
    out[i] = Math.max(-1, Math.min(1, y));
    rp += r;
    while (rp >= R) rp -= R;
    while (rp < 0) rp += R;
  }

  // Keep read head behind write. A single-step snap caused audible "breaks"; nudge over several blocks.
  const dist = (state.writePos - Math.floor(rp) + R * 2) % R;
  if (dist < MIN_READ_LAG) {
    const targetRp = clampReadLagTarget(state.writePos, R);
    let delta = ringDelta(rp, targetRp, R);
    const maxStep = Math.max(64, Math.min(480, Math.floor(n * 0.35)));
    if (Math.abs(delta) <= maxStep) {
      rp = targetRp;
    } else {
      rp += Math.sign(delta) * maxStep;
    }
    while (rp < 0) rp += R;
    while (rp >= R) rp -= R;
  }
  state.readPos = rp;

  return out;
}
