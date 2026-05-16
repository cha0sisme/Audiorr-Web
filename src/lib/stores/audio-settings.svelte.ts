/**
 * audio-settings — preferencias de audio device-local (no se sincronizan
 * cross-device vía backend, igual que el volumen).
 *
 * Mirror del JSSettings dict de iOS (`SettingsView.swift:33,63`). Por ahora
 * solo `useReplayGain`; cuando portemos crossfade/scrobble settings vivirán
 * aquí también.
 *
 * Persistencia: localStorage. SSR-safe (browser check en lectura/escritura).
 */

import { browser } from '$app/environment';

/** Clave compartida con iOS UserDefaults / JSSettings — coherencia entre
    clientes aunque cada device guarda su valor por separado. */
const USE_REPLAY_GAIN_KEY = 'audiorr_useReplayGain';
/** Default `true` paridad iOS (`SettingsView.swift:33` — `@Published var
    useReplayGain = true`). */
const DEFAULT_USE_REPLAY_GAIN = true;

function loadUseReplayGain(): boolean {
  if (!browser) return DEFAULT_USE_REPLAY_GAIN;
  try {
    const raw = localStorage.getItem(USE_REPLAY_GAIN_KEY);
    if (raw === null) return DEFAULT_USE_REPLAY_GAIN;
    return raw === 'true';
  } catch {
    return DEFAULT_USE_REPLAY_GAIN;
  }
}

function persistUseReplayGain(v: boolean): void {
  if (!browser) return;
  try {
    localStorage.setItem(USE_REPLAY_GAIN_KEY, v ? 'true' : 'false');
  } catch {
    // private mode / quota — silencioso.
  }
}

class AudioSettingsStore {
  private _useReplayGain = $state(loadUseReplayGain());

  get useReplayGain(): boolean {
    return this._useReplayGain;
  }
  set useReplayGain(v: boolean) {
    this._useReplayGain = v;
    persistUseReplayGain(v);
  }
}

export const audioSettings = new AudioSettingsStore();
