/**
 * Stubs so App.tsx never loads react-native-audio-api on web (native JSI/TurboModules).
 * The low-latency monitor path is disabled on web in App.tsx.
 */
export const AudioContext = class {};

export class AudioRecorder {
  clearOnAudioReady() {}
  isRecording() {
    return false;
  }
  stop() {}
  start() {
    return { status: 'error' as const, message: 'Not available on web.' };
  }
  onAudioReady() {}
}

export const AudioManager = {
  requestRecordingPermissions: async () => 'Denied' as const,
  setAudioSessionActivity: async (_active: boolean) => true,
  setAudioSessionOptions: (_opts: unknown) => {},
  getDevicePreferredSampleRate: () => 44100,
};
