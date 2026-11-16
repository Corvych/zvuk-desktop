import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`Tauri IPC is not available.`);
  }
  return tauriInvoke<T>(cmd, args);
}

export interface SberDevice {
  id: string;
  name: string;
  host: string;
  port: number;
  model?: string | null;
  firmware?: string | null;
  pin_token?: string | null;
  is_paired: boolean;
}

export interface SberTrackInfo {
  track_id?: string | null;
  title?: string | null;
  artists: string[];
  album?: string | null;
  duration?: number | null;
  position?: number | null;
  position_ts_ms?: number | null;
  received_at_ms?: number | null;
  playing: boolean;
  shuffle: boolean;
  repeat_type?: string | null;
  liked: boolean;
  provider?: string | null;
}

export interface SberSpeakerState {
  volume_percent?: number | null;
  muted?: boolean | null;
}

export interface SberCastStatus {
  is_connected: boolean;
  is_connecting: boolean;
  is_pairing: boolean;
  active_device?: SberDevice | null;
  current_track?: SberTrackInfo | null;
  speaker_state?: SberSpeakerState | null;
}

export async function sbercastDiscoverDevices(): Promise<SberDevice[]> {
  return invoke<SberDevice[]>('sbercast_discover_devices');
}

export async function sbercastAddManualDevice(host: string, port?: number): Promise<SberDevice> {
  return invoke<SberDevice>('sbercast_add_manual_device', { host, port });
}

export async function sbercastPairDevice(host: string, port?: number, name?: string): Promise<SberDevice> {
  return invoke<SberDevice>('sbercast_pair_device', { host, port, name });
}

export async function sbercastConnectDevice(device: SberDevice): Promise<void> {
  return invoke<void>('sbercast_connect_device', { device });
}

export async function sbercastDisconnect(): Promise<void> {
  return invoke<void>('sbercast_disconnect');
}

export async function sbercastGetStatus(): Promise<SberCastStatus> {
  return invoke<SberCastStatus>('sbercast_get_status');
}

export async function sbercastGetSavedDevices(): Promise<SberDevice[]> {
  return invoke<SberDevice[]>('sbercast_get_saved_devices');
}

export async function sbercastRemoveSavedDevice(id: string): Promise<void> {
  return invoke<void>('sbercast_remove_saved_device', { id });
}

export async function sbercastPlayDeeplink(deeplink: string): Promise<void> {
  return invoke<void>('sbercast_play_deeplink', { deeplink });
}

export async function sbercastPlayTrack(trackId: string | number): Promise<void> {
  return invoke<void>('sbercast_play_track', { trackId: String(trackId) });
}

export async function sbercastPlayPlaylist(playlistId: string | number): Promise<void> {
  return invoke<void>('sbercast_play_playlist', { playlistId: String(playlistId) });
}

export async function sbercastPlayArtist(artistId: string | number): Promise<void> {
  return invoke<void>('sbercast_play_artist', { artistId: String(artistId) });
}

export async function sbercastPlayRelease(releaseId: string | number): Promise<void> {
  return invoke<void>('sbercast_play_release', { releaseId: String(releaseId) });
}

export async function sbercastMediaPlay(): Promise<void> {
  return invoke<void>('sbercast_media_play');
}

export async function sbercastMediaPause(): Promise<void> {
  return invoke<void>('sbercast_media_pause');
}

export async function sbercastMediaNext(): Promise<void> {
  return invoke<void>('sbercast_media_next');
}

export async function sbercastMediaPrev(): Promise<void> {
  return invoke<void>('sbercast_media_prev');
}

export async function sbercastMediaLike(): Promise<void> {
  return invoke<void>('sbercast_media_like');
}

export async function sbercastMediaDislike(): Promise<void> {
  return invoke<void>('sbercast_media_dislike');
}

export async function sbercastMediaShuffle(on: boolean): Promise<void> {
  return invoke<void>('sbercast_media_shuffle', { on });
}

export async function sbercastMediaRepeat(mode: string): Promise<void> {
  return invoke<void>('sbercast_media_repeat', { mode });
}

export async function sbercastSetVolume(percent: number): Promise<void> {
  return invoke<void>('sbercast_set_volume', { percent });
}

export async function sbercastSeek(seconds: number): Promise<void> {
  return invoke<void>('sbercast_seek', { seconds });
}

export function onSbercastTrackUpdated(callback: (track: SberTrackInfo) => void): Promise<UnlistenFn> {
  return listen<SberTrackInfo>('sbercast-track-updated', (event) => callback(event.payload));
}

export function onSbercastStateUpdated(callback: (state: SberSpeakerState) => void): Promise<UnlistenFn> {
  return listen<SberSpeakerState>('sbercast-state-updated', (event) => callback(event.payload));
}

export function onSbercastConnected(callback: (data: { device: SberDevice }) => void): Promise<UnlistenFn> {
  return listen<{ device: SberDevice }>('sbercast-connected', (event) => callback(event.payload));
}

export function onSbercastDisconnected(callback: () => void): Promise<UnlistenFn> {
  return listen<void>('sbercast-disconnected', () => callback());
}

export function onSbercastPairingStart(callback: (data: { host: string }) => void): Promise<UnlistenFn> {
  return listen<{ host: string }>('sbercast-pairing-start', (event) => callback(event.payload));
}

export function onSbercastPairingSuccess(callback: (data: { device: SberDevice }) => void): Promise<UnlistenFn> {
  return listen<{ device: SberDevice }>('sbercast-pairing-success', (event) => callback(event.payload));
}

export function onSbercastPairingError(callback: (data: { error: string }) => void): Promise<UnlistenFn> {
  return listen<{ error: string }>('sbercast-pairing-error', (event) => callback(event.payload));
}
