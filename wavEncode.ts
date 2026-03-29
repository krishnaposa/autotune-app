/** Encode mono float32 samples (−1…1) as 16-bit little-endian PCM WAV. */
export function encodeWavMonoFloat32(samples: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]!));
    const s = x < 0 ? x * 0x8000 : x * 0x7fff;
    view.setInt16(off, s | 0, true);
    off += 2;
  }

  return new Uint8Array(buffer);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== 'undefined') {
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
      const sub = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode.apply(null, Array.from(sub) as unknown as number[]);
    }
    return btoa(binary);
  }
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i]!;
    const b2 = i + 1 < len ? bytes[i + 1]! : 0;
    const b3 = i + 2 < len ? bytes[i + 2]! : 0;
    const triple = (b1 << 16) | (b2 << 8) | b3;
    const remaining = len - i;
    result += B64[(triple >> 18) & 63];
    result += B64[(triple >> 12) & 63];
    result += remaining > 1 ? B64[(triple >> 6) & 63] : '=';
    result += remaining > 2 ? B64[triple & 63] : '=';
  }
  return result;
}
