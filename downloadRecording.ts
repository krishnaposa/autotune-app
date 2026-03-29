import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/**
 * Web: triggers a browser download of the WAV.
 * iOS/Android: opens the share sheet so the user can save to Files, Drive, “Save to device”, etc.
 * Android uses a content URI so other apps can read the file from app storage.
 */
export async function downloadRecording(uri: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return;
    const a = document.createElement('a');
    a.href = uri;
    a.download = `autotune-capture-${Date.now()}.wav`;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device.');
  }

  let shareUri = uri;
  if (Platform.OS === 'android') {
    shareUri = await FileSystem.getContentUriAsync(uri);
  }

  await Sharing.shareAsync(shareUri, {
    mimeType: 'audio/wav',
    dialogTitle: 'Save or share recording',
    UTI: 'public.wav',
  });
}
