export const A4 = 440;

/** MIDI pitch classes in C major (C, D, E, F, G, A, B). */
const C_MAJOR_PC = new Set([0, 2, 4, 5, 7, 9, 11]);

export function freqToMidi(f: number): number {
  return 12 * Math.log2(f / A4) + 69;
}

export function midiToFreq(m: number): number {
  return A4 * Math.pow(2, (m - 69) / 12);
}

/** Nearest MIDI note that lies in C major (any octave). */
export function snapMidiToNearestCMajor(midi: number): number {
  const lo = Math.floor(midi) - 6;
  const hi = Math.ceil(midi) + 6;
  let best = Math.round(midi);
  let bestDist = Infinity;
  for (let m = lo; m <= hi; m++) {
    const pc = ((m % 12) + 12) % 12;
    if (!C_MAJOR_PC.has(pc)) continue;
    const d = Math.abs(midi - m);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

export type NoteLockState = {
  lockedMidi: number;
  candidate: number | null;
  streak: number;
  initialized: boolean;
};

export function createNoteLockState(seedMidi = 69): NoteLockState {
  return {
    lockedMidi: seedMidi,
    candidate: null,
    streak: 0,
    initialized: false,
  };
}

export function resetNoteLockState(s: NoteLockState, seedMidi = 69): void {
  s.lockedMidi = seedMidi;
  s.candidate = null;
  s.streak = 0;
  s.initialized = false;
}

/**
 * Hold a snapped scale note until a different candidate wins for `minStreak` blocks.
 * Reduces rapid toggling between neighbors when pitch estimates jitter (clearer autotune).
 */
export function nextLockedMidi(s: NoteLockState, midiIn: number, minStreak: number): number {
  const rawT = snapMidiToNearestCMajor(midiIn);
  if (!s.initialized) {
    s.lockedMidi = rawT;
    s.initialized = true;
    s.candidate = null;
    s.streak = 0;
    return s.lockedMidi;
  }
  if (rawT === s.lockedMidi) {
    s.candidate = null;
    s.streak = 0;
    return s.lockedMidi;
  }
  if (s.candidate !== rawT) {
    s.candidate = rawT;
    s.streak = 1;
  } else {
    s.streak += 1;
  }
  if (s.streak >= minStreak) {
    s.lockedMidi = rawT;
    s.candidate = null;
    s.streak = 0;
  }
  return s.lockedMidi;
}
