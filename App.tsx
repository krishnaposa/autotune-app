import 'react-native-gesture-handler';
import 'react-native-reanimated';
import 'react-native-worklets';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
} from 'expo-audio';
import { AudioContext, AudioManager, AudioRecorder } from './audioApi';
import LivePitchDetection from './livePitch';

const A4 = 440;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** MIDI pitch classes in C major (C, D, E, F, G, A, B). */
const C_MAJOR_PC = new Set([0, 2, 4, 5, 7, 9, 11]);

function freqToMidi(f: number): number {
  return 12 * Math.log2(f / A4) + 69;
}

function midiToFreq(m: number): number {
  return A4 * Math.pow(2, (m - 69) / 12);
}

function formatNote(midi: number): string {
  const n = Math.round(midi);
  const pc = ((n % 12) + 12) % 12;
  const octave = Math.floor(n / 12) - 1;
  return `${NOTE_NAMES[pc]}${octave}`;
}

/** Nearest MIDI note that lies in C major (any octave). */
function snapMidiToNearestCMajor(midi: number): number {
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

/** Classic autocorrelation pitch estimate (returns Hz or -1 if unclear). */
function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length;
  if (SIZE < 256) return -1;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.015) return -1;

  let r1 = 0;
  let r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < thres) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < thres) {
      r2 = SIZE - i;
      break;
    }
  }
  const trimmed = buf.subarray(r1, r2);
  const c = new Float32Array(trimmed.length);
  for (let i = 0; i < trimmed.length; i++) {
    for (let j = 0; j < trimmed.length - i; j++) {
      c[i] += trimmed[j] * trimmed[j + i];
    }
  }
  let d = 0;
  while (d < c.length - 1 && c[d] > c[d + 1]) d++;
  let maxval = -1;
  let maxpos = -1;
  for (let i = d; i < trimmed.length; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }
  if (maxpos < 2 || maxpos >= c.length - 2) return -1;
  let T0 = maxpos;
  const x1 = c[T0 - 1];
  const x2 = c[T0];
  const x3 = c[T0 + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (Math.abs(a) > 1e-6) {
    T0 -= b / (2 * a);
  }
  const f = sampleRate / T0;
  if (f < 50 || f > 2000) return -1;
  return f;
}

/** Resample in-block for pitch shift: readPos advances by (target/input) per output sample. */
function pitchShiftBlock(
  input: Float32Array,
  ratio: number,
  readOffsetRef: React.MutableRefObject<number>
): Float32Array {
  const out = new Float32Array(input.length);
  if (ratio <= 0 || !isFinite(ratio) || input.length < 2) {
    out.set(input);
    return out;
  }
  let readPos = readOffsetRef.current;
  const n = input.length;
  for (let i = 0; i < out.length; i++) {
    const base = Math.floor(readPos);
    const i0 = ((base % n) + n) % n;
    const i1 = (i0 + 1) % n;
    const frac = readPos - base;
    const s0 = input[i0];
    const s1 = input[i1];
    out[i] = s0 * (1 - frac) + s1 * frac;
    readPos += ratio;
  }
  readOffsetRef.current = readPos % n;
  return out;
}

export default function App() {
  const { width } = useWindowDimensions();

  /** Keeps the expo-audio player subsystem initialized alongside the monitor pipeline. */
  useAudioPlayer(null);

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  const [permissionGranted, setPermissionGranted] = useState(false);
  const [inputHz, setInputHz] = useState(0);
  const [inputNote, setInputNote] = useState('—');
  const [targetMidi, setTargetMidi] = useState(69);
  const [targetNote, setTargetNote] = useState('A4');
  const [monitorOn, setMonitorOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ratioSmoothed = useRef(1);
  const readPhase = useRef(0);
  const pitchSubRef = useRef<ReturnType<typeof LivePitchDetection.addListener> | null>(null);

  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<ReturnType<AudioContext['createBufferQueueSource']> | null>(null);

  const updateTargetFromHz = useCallback((hz: number) => {
    if (hz <= 0 || !isFinite(hz)) return;
    const midi = freqToMidi(hz);
    const snapped = snapMidiToNearestCMajor(midi);
    setTargetMidi(snapped);
    setTargetNote(formatNote(snapped));
  }, []);

  const stopLivePitch = useCallback(() => {
    pitchSubRef.current?.remove();
    pitchSubRef.current = null;
    void LivePitchDetection.stopListening().catch(() => {});
  }, []);

  const startLivePitch = useCallback(() => {
    stopLivePitch();
    void LivePitchDetection.startListening()
      .then(() => {
        pitchSubRef.current = LivePitchDetection.addListener((e) => {
          setInputHz(e.frequency);
          setInputNote(e.note);
          updateTargetFromHz(e.frequency);
        });
      })
      .catch((err: Error) => setError(err.message ?? String(err)));
  }, [stopLivePitch, updateTargetFromHz]);

  const stopMonitorGraph = useCallback(async () => {
    const rec = audioRecorderRef.current;
    const ctx = audioContextRef.current;
    const q = queueRef.current;
    try {
      rec?.clearOnAudioReady();
      if (rec?.isRecording()) rec.stop();
    } catch {
      /* ignore */
    }
    try {
      q?.clearBuffers();
      q?.stop(0);
    } catch {
      /* ignore */
    }
    try {
      await ctx?.close();
    } catch {
      /* ignore */
    }
    audioRecorderRef.current = null;
    audioContextRef.current = null;
    queueRef.current = null;
    readPhase.current = 0;
    ratioSmoothed.current = 1;
    await AudioManager.setAudioSessionActivity(false);
  }, []);

  const startMonitorGraph = useCallback(async () => {
    if (Platform.OS === 'web') {
      setError('Low-latency monitor uses native audio (iOS/Android).');
      return;
    }
    setError(null);
    await stopLivePitch();

    const perm = await AudioManager.requestRecordingPermissions();
    if (perm !== 'Granted') {
      setError('Microphone permission is required for monitoring.');
      return;
    }

    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'default',
      iosOptions: [],
    });

    const ok = await AudioManager.setAudioSessionActivity(true);
    if (!ok) {
      setError('Could not activate the audio session.');
      return;
    }

    const sampleRate = AudioManager.getDevicePreferredSampleRate() || 44100;
    const bufferFrames = 512;

    const audioContext = new AudioContext({ sampleRate });
    const queue = audioContext.createBufferQueueSource();
    queue.connect(audioContext.destination);
    queue.start(0);

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const audioRecorder = new AudioRecorder();

    audioRecorder.onAudioReady(
      {
        sampleRate,
        bufferLength: bufferFrames,
        channelCount: 1,
      },
      ({ buffer, numFrames }) => {
        const input = buffer.getChannelData(0);
        const slice = input.subarray(0, numFrames);
        const f = autoCorrelate(slice, buffer.sampleRate);
        let ratio = 1;
        if (f > 0) {
          setInputHz(f);
          setInputNote(formatNote(freqToMidi(f)));
          const midiIn = freqToMidi(f);
          const midiT = snapMidiToNearestCMajor(midiIn);
          const fTarget = midiToFreq(midiT);
          ratio = fTarget / f;
          setTargetMidi(midiT);
          setTargetNote(formatNote(midiT));
        }
        ratioSmoothed.current = ratioSmoothed.current * 0.92 + ratio * 0.08;

        const shifted = pitchShiftBlock(slice, ratioSmoothed.current, readPhase);
        const outBuf = audioContext.createBuffer(1, shifted.length, buffer.sampleRate);
        outBuf.copyToChannel(shifted, 0);
        queue.enqueueBuffer(outBuf);
      }
    );

    const startResult = audioRecorder.start();
    if (startResult.status === 'error') {
      setError(startResult.message);
      await audioContext.close();
      return;
    }

    audioRecorderRef.current = audioRecorder;
    audioContextRef.current = audioContext;
    queueRef.current = queue;
  }, [stopLivePitch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (Platform.OS === 'web') {
          if (!cancelled) setPermissionGranted(true);
          return;
        }
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: 'mixWithOthers',
        });
        const { granted, status } = await requestRecordingPermissionsAsync();
        if (cancelled) return;
        if (!granted) {
          setError(`Microphone permission: ${status}`);
          return;
        }
        LivePitchDetection.setOptions({
          updateIntervalMs: 50,
          bufferSize: 2048,
          a4Frequency: A4,
        });
        setPermissionGranted(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!permissionGranted) return;

    if (monitorOn) {
      if (Platform.OS === 'web') {
        return undefined;
      }
      void startMonitorGraph();
      return () => {
        void stopMonitorGraph();
      };
    }

    if (Platform.OS === 'web') {
      return undefined;
    }

    startLivePitch();
    return () => {
      stopLivePitch();
    };
  }, [permissionGranted, monitorOn, startLivePitch, startMonitorGraph, stopLivePitch, stopMonitorGraph]);

  /** Browser mic → Web Audio AnalyserNode + shared autocorrelation (native uses LivePitchDetection instead). */
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!permissionGranted || monitorOn) return;

    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let browserCtx: {
      sampleRate: number;
      resume: () => Promise<void>;
      close: () => Promise<void>;
    } | null = null;

    const AC =
      typeof globalThis !== 'undefined' &&
      (globalThis.AudioContext ||
        (globalThis as unknown as { webkitAudioContext?: typeof globalThis.AudioContext }).webkitAudioContext);
    if (!AC) {
      setError('Web Audio API is not available in this browser.');
      return;
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError('Allow microphone access to see live pitch on web.');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      setError(null);
      const ctx = new AC();
      browserCtx = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.85;
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize);

      const loop = () => {
        if (cancelled) return;
        analyser.getFloatTimeDomainData(data);
        const f = autoCorrelate(data, ctx.sampleRate);
        if (f > 0) {
          setInputHz(f);
          setInputNote(formatNote(freqToMidi(f)));
          updateTargetFromHz(f);
        } else {
          setInputHz(0);
          setInputNote('—');
        }
        rafId = requestAnimationFrame(loop);
      };

      await ctx.resume();
      if (!cancelled) loop();
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      void browserCtx?.close();
    };
  }, [permissionGranted, monitorOn, updateTargetFromHz]);

  /**
   * Web monitor: mic → ScriptProcessor (same C-major snap + pitchShiftBlock as native) → speakers.
   * Higher latency than native; use headphones to reduce feedback.
   */
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!permissionGranted || !monitorOn) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: InstanceType<typeof globalThis.AudioContext> | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;

    const AC =
      typeof globalThis !== 'undefined' &&
      (globalThis.AudioContext ||
        (globalThis as unknown as { webkitAudioContext?: typeof globalThis.AudioContext }).webkitAudioContext);
    if (!AC) {
      setError('Web Audio API is not available in this browser.');
      return;
    }

    ratioSmoothed.current = 1;
    readPhase.current = 0;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch {
        setError('Allow microphone access for monitor on web.');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      setError(null);
      const ctx = new AC();
      audioCtx = ctx;
      sourceNode = ctx.createMediaStreamSource(stream);

      const bufferSize = 4096;
      const createProc = (
        ctx as unknown as {
          createScriptProcessor?: (buf: number, inch: number, outch: number) => ScriptProcessorNode;
        }
      ).createScriptProcessor;
      if (!createProc) {
        setError('This browser cannot run web monitor (no ScriptProcessor). Try Chrome or Edge.');
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        return;
      }
      processor = createProc.call(ctx, bufferSize, 1, 1);

      let uiTick = 0;
      processor.onaudioprocess = (ev: AudioProcessingEvent) => {
        const input = ev.inputBuffer.getChannelData(0);
        const output = ev.outputBuffer.getChannelData(0);
        const sr = ctx.sampleRate;
        const f = autoCorrelate(input, sr);
        let ratio = 1;
        if (f > 0) {
          const midiIn = freqToMidi(f);
          const midiT = snapMidiToNearestCMajor(midiIn);
          const fTarget = midiToFreq(midiT);
          ratio = fTarget / f;
          uiTick += 1;
          if (uiTick % 6 === 0) {
            setInputHz(f);
            setInputNote(formatNote(midiIn));
            setTargetMidi(midiT);
            setTargetNote(formatNote(midiT));
          }
        } else {
          ratio = 1;
        }
        ratioSmoothed.current = ratioSmoothed.current * 0.92 + ratio * 0.08;
        const shifted = pitchShiftBlock(input, ratioSmoothed.current, readPhase);
        output.set(shifted);
      };

      sourceNode.connect(processor);
      processor.connect(ctx.destination);
      await ctx.resume();
    })();

    return () => {
      cancelled = true;
      try {
        processor?.disconnect();
        sourceNode?.disconnect();
      } catch {
        /* ignore */
      }
      stream?.getTracks().forEach((t) => t.stop());
      void audioCtx?.close();
      processor = null;
      sourceNode = null;
      audioCtx = null;
      ratioSmoothed.current = 1;
      readPhase.current = 0;
    };
  }, [permissionGranted, monitorOn]);

  const centsOff = useMemo(() => {
    if (inputHz <= 0) return 0;
    return 1200 * Math.log2(midiToFreq(targetMidi) / inputHz);
  }, [inputHz, targetMidi]);

  const vizWidth = Math.min(width - 48, 360);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Text style={styles.title}>Autotune monitor</Text>
      <Text style={styles.hint}>
        {Platform.OS === 'web'
          ? 'Web: pitch readout uses an analyser; turn the monitor on for C-major–snapped audio to your speakers (higher latency than native—headphones help prevent feedback).'
          : 'Pitch readout uses LivePitchDetection while monitoring is off. On iOS/Android, turning monitoring on releases the pitch module and uses the same audio buffers for pitch + output to avoid microphone conflicts.'}
      </Text>

      <View style={styles.row}>
        <Text style={styles.label}>Low-latency monitor (C major snap)</Text>
        <Switch
          value={monitorOn}
          onValueChange={setMonitorOn}
          disabled={!permissionGranted}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Input</Text>
          <Text style={styles.metricNote}>{inputNote}</Text>
          <Text style={styles.metricHz}>{inputHz > 0 ? `${inputHz.toFixed(1)} Hz` : '—'}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Target (C major)</Text>
          <Text style={styles.metricNote}>{targetNote}</Text>
          <Text style={styles.metricHz}>{inputHz > 0 ? `${midiToFreq(targetMidi).toFixed(1)} Hz` : '—'}</Text>
        </View>
      </View>

      <Text style={styles.cents}>
        {inputHz > 0 ? `Δ ${centsOff >= 0 ? '+' : ''}${centsOff.toFixed(0)} cents vs target` : ''}
      </Text>

      <View style={[styles.viz, { width: vizWidth }]}>
        <Text style={styles.vizTitle}>Input vs target</Text>
        <View style={styles.vizBarTrack}>
          <View
            style={[
              styles.vizInput,
              {
                width: `${Math.min(100, (centsOff + 50) / 100) * 100}%`,
              },
            ]}
          />
        </View>
        <View style={styles.vizLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#7dd3fc' }]} />
            <Text style={styles.legendText}>Pointer = cents from target (−50…+50)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#4ade80' }]} />
            <Text style={styles.legendText}>Center = on target</Text>
          </View>
        </View>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingTop: 56,
    paddingHorizontal: 24,
    gap: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f8fafc',
  },
  hint: {
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  label: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#fca5a5',
    fontSize: 14,
  },
  metrics: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  metric: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  metricNote: {
    color: '#f1f5f9',
    fontSize: 28,
    fontWeight: '700',
  },
  metricHz: {
    color: '#64748b',
    fontSize: 14,
    marginTop: 4,
  },
  cents: {
    color: '#cbd5e1',
    fontSize: 14,
    minHeight: 20,
  },
  viz: {
    alignSelf: 'center',
    marginTop: 8,
  },
  vizTitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 8,
  },
  vizBarTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: '#1e293b',
    overflow: 'hidden',
  },
  vizInput: {
    height: '100%',
    backgroundColor: '#38bdf8',
    borderRadius: 6,
  },
  vizLegend: {
    marginTop: 12,
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    color: '#94a3b8',
    fontSize: 12,
  },
});
