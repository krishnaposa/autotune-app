/**
 * Low-latency mic cleanup for monitor/autotune: high-pass (rumble / DC) + soft noise gate (steady hiss).
 * Stateful — reuse one state object across consecutive blocks from the same capture stream.
 */

export type MicNoiseReduceState = {
  hpXm1: number;
  hpY: number;
  gateSmoothedGain: number;
};

export function createMicNoiseReduceState(): MicNoiseReduceState {
  return { hpXm1: 0, hpY: 0, gateSmoothedGain: 1 };
}

export function resetMicNoiseReduceState(s: MicNoiseReduceState): void {
  s.hpXm1 = 0;
  s.hpY = 0;
  s.gateSmoothedGain = 1;
}

const DEFAULT_HP_HZ = 100;
const GATE_CLOSE_RMS = 0.012;
const GATE_OPEN_RMS = 0.028;
const GATE_MIN_GAIN = 0.12;

function highPassInPlace(buf: Float32Array, sampleRate: number, fc: number, s: MicNoiseReduceState): void {
  const rc = 1 / (2 * Math.PI * fc);
  const dt = 1 / sampleRate;
  const a = rc / (rc + dt);
  let xm1 = s.hpXm1;
  let y = s.hpY;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    y = a * (y + x - xm1);
    xm1 = x;
    buf[i] = y;
  }
  s.hpXm1 = xm1;
  s.hpY = y;
}

function softGateInPlace(buf: Float32Array, s: MicNoiseReduceState): void {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    sum += x * x;
  }
  const rms = Math.sqrt(sum / buf.length) || 0;

  let targetGain = 1;
  if (rms < GATE_CLOSE_RMS) {
    targetGain = GATE_MIN_GAIN + (1 - GATE_MIN_GAIN) * (rms / GATE_CLOSE_RMS);
  } else if (rms < GATE_OPEN_RMS) {
    const t = (rms - GATE_CLOSE_RMS) / (GATE_OPEN_RMS - GATE_CLOSE_RMS);
    targetGain = GATE_MIN_GAIN + (1 - GATE_MIN_GAIN) * (0.35 + 0.65 * t);
  }

  const g = s.gateSmoothedGain * 0.82 + targetGain * 0.18;
  s.gateSmoothedGain = g;
  for (let i = 0; i < buf.length; i++) {
    buf[i]! *= g;
  }
}

/**
 * Copies `input` and returns a cleaned buffer, or returns `input` unchanged if disabled.
 */
export function reduceMicNoise(
  input: Float32Array,
  sampleRate: number,
  state: MicNoiseReduceState,
  enabled: boolean
): Float32Array {
  if (!enabled) {
    return input;
  }
  const buf = new Float32Array(input.length);
  buf.set(input);
  highPassInPlace(buf, sampleRate, DEFAULT_HP_HZ, state);
  softGateInPlace(buf, state);
  return buf;
}
