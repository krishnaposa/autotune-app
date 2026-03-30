import { NativeModules, Platform } from 'react-native';

type BluetoothAudioNative = {
  setBluetoothScoEnabled: (enabled: boolean) => Promise<void>;
};

const native: BluetoothAudioNative | undefined =
  Platform.OS === 'android' ? (NativeModules.BluetoothAudio as BluetoothAudioNative | undefined) : undefined;

export function isBluetoothInputAvailable(): boolean {
  return Platform.OS === 'android' && native != null;
}

/** Android: SCO / communication routing so headset mic can be used for capture. */
export async function setBluetoothScoInputEnabled(enabled: boolean): Promise<void> {
  if (!native?.setBluetoothScoEnabled) return;
  await native.setBluetoothScoEnabled(enabled);
}
