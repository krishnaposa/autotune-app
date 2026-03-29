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
const MIN_READ_LAG = 6144;

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

function softClip(x: number): number {
  const s = Math.max(-1, Math.min(1, x * 0.92));
  return Math.tanh(s * 1.1);
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
    state.readPos = (state.writePos - MIN_READ_LAG + R * 2) % R;
    state.initialized = true;
  }

  let rp = state.readPos;
  for (let i = 0; i < n; i++) {
    const base = Math.floor(rp);
    const i0 = ((base % R) + R) % R;
    const i1 = (i0 + 1) % R;
    const frac = rp - base;
    const s0 = state.ring[i0]!;
    const s1 = state.ring[i1]!;
    out[i] = softClip(s0 * (1 - frac) + s1 * frac);
    rp += r;
    while (rp >= R) rp -= R;
    while (rp < 0) rp += R;
  }

  // Keep read head behind write; if pitch-up makes read gain on write, snap back.
  let dist = (state.writePos - Math.floor(rp) + R * 2) % R;
  if (dist < MIN_READ_LAG) {
    rp = ((state.writePos - MIN_READ_LAG + R * 2) % R + R) % R;
  }
  state.readPos = rp;

  return out;
}
