/** Web stub — native pitch module is not available in the browser. */
const noopSub = { remove() {} };

const LivePitchDetection = {
  startListening: async () => {},
  stopListening: async () => {},
  addListener: (_cb: (e: { frequency: number; note: string }) => void) => noopSub,
  setOptions: (_opts: {
    updateIntervalMs?: number;
    bufferSize?: number;
    a4Frequency?: number;
  }) => {},
};

export default LivePitchDetection;
