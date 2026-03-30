package com.anonymous.autotuneapp

import android.content.Context
import android.media.AudioManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Routes capture/playback toward a paired Bluetooth headset mic using SCO (phone-call style).
 * Many wireless headset mics only appear when SCO is active.
 */
class BluetoothAudioModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  private val audioManager: AudioManager
    get() = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  @ReactMethod
  fun setBluetoothScoEnabled(enabled: Boolean, promise: Promise) {
    try {
      val am = audioManager
      if (enabled) {
        am.mode = AudioManager.MODE_IN_COMMUNICATION
        am.startBluetoothSco()
        am.isBluetoothScoOn = true
      } else {
        am.stopBluetoothSco()
        am.isBluetoothScoOn = false
        am.mode = AudioManager.MODE_NORMAL
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject(ERR, e.message, e)
    }
  }

  companion object {
    const val NAME = "BluetoothAudio"
    private const val ERR = "E_BLUETOOTH_AUDIO"
  }
}
