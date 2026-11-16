import { create } from 'zustand';
import {
  sbercastDiscoverDevices,
  sbercastAddManualDevice,
  sbercastPairDevice,
  sbercastConnectDevice,
  sbercastDisconnect,
  sbercastGetStatus,
  sbercastRemoveSavedDevice,
  sbercastSetVolume,
  sbercastSeek,
  onSbercastTrackUpdated,
  onSbercastStateUpdated,
  onSbercastConnected,
  onSbercastDisconnected,
  onSbercastPairingStart,
  onSbercastPairingSuccess,
  onSbercastPairingError,
  type SberDevice,
  type SberTrackInfo,
  type SberSpeakerState,
} from './sbercastApi';
import { showToast } from '../../components/Toast';
import { usePlayerStore } from '../player/playerStore';
import { setMasterVolume } from '../player/audioService';

const PRECAST_VOLUME_STORAGE_KEY = 'zvuk-precast-volume';

export interface PreCastVolumeSnapshot {
  volume: number;
  isMuted: boolean;
}

export function savePreCastVolume() {
  try {
    if (!localStorage.getItem(PRECAST_VOLUME_STORAGE_KEY)) {
      const { volume, isMuted } = usePlayerStore.getState();
      localStorage.setItem(
        PRECAST_VOLUME_STORAGE_KEY,
        JSON.stringify({ volume, isMuted: !!isMuted })
      );
    }
  } catch (e) {
    console.warn('[SberCast] Failed to save pre-cast volume:', e);
  }
}

export function restorePreCastVolume(): PreCastVolumeSnapshot | null {
  try {
    const raw = localStorage.getItem(PRECAST_VOLUME_STORAGE_KEY);
    if (raw) {
      localStorage.removeItem(PRECAST_VOLUME_STORAGE_KEY);
      const data = JSON.parse(raw) as PreCastVolumeSnapshot;
      if (typeof data.volume === 'number' && !isNaN(data.volume)) {
        usePlayerStore.setState({
          volume: Math.max(0, Math.min(1, data.volume)),
          isMuted: !!data.isMuted,
        });
        setMasterVolume(data.isMuted ? 0 : data.volume);
        return data;
      }
    }
  } catch (e) {
    console.warn('[SberCast] Failed to restore pre-cast volume:', e);
  }
  return null;
}

interface SberCastState {
  isConnected: boolean;
  isConnecting: boolean;
  isPairing: boolean;
  pairingHost: string | null;
  pairingDevice: SberDevice | null;
  activeDevice: SberDevice | null;
  devices: SberDevice[];
  isScanning: boolean;
  speakerVolume: number | null;
  speakerMuted: boolean;
  speakerTrack: SberTrackInfo | null;
  isModalOpen: boolean;

  setModalOpen: (open: boolean) => void;
  init: () => Promise<void>;
  scanDevices: () => Promise<void>;
  addManualDevice: (host: string, port?: number) => Promise<SberDevice>;
  pairDevice: (host: string, port?: number, name?: string) => Promise<SberDevice>;
  cancelPairing: () => void;
  connectDevice: (device: SberDevice) => Promise<void>;
  disconnect: () => Promise<void>;
  removeDevice: (id: string) => Promise<void>;
  setVolume: (percent: number) => Promise<void>;
  seek: (seconds: number) => Promise<void>;
}

let listenersInitialized = false;

export const useSberCastStore = create<SberCastState>((set, get) => ({
  isConnected: false,
  isConnecting: false,
  isPairing: false,
  pairingHost: null,
  pairingDevice: null,
  activeDevice: null,
  devices: [],
  isScanning: false,
  speakerVolume: null,
  speakerMuted: false,
  speakerTrack: null,
  isModalOpen: false,

  setModalOpen: (open) => set({ isModalOpen: open }),
  cancelPairing: () => set({ isPairing: false, pairingHost: null, pairingDevice: null }),

  init: async () => {
    if (listenersInitialized) return;
    listenersInitialized = true;

    try {
      const status = await sbercastGetStatus();
      if (!status.is_connected) {
        restorePreCastVolume();
      } else {
        savePreCastVolume();
      }
      set({
        isConnected: status.is_connected,
        isConnecting: status.is_connecting,
        isPairing: status.is_pairing,
        activeDevice: status.active_device || null,
        speakerTrack: status.current_track
          ? {
              ...status.current_track,
              received_at_ms:
                status.current_track.received_at_ms && status.current_track.received_at_ms > 0
                  ? status.current_track.received_at_ms
                  : Date.now(),
            }
          : null,
        speakerVolume: status.speaker_state?.volume_percent ?? null,
        speakerMuted: status.speaker_state?.muted ?? false,
      });

      // Fetch initial devices list
      const devs = await sbercastDiscoverDevices().catch(() => []);
      set({ devices: devs });
    } catch (e) {
      console.warn('[SberCast] Init failed:', e);
    }

    // Attach Tauri listeners
    onSbercastTrackUpdated((newTrack) => {
      if (!newTrack) {
        set({ speakerTrack: null });
        return;
      }

      set((prev) => {
        const prevTrack = prev.speakerTrack;
        const now = Date.now();

        // If no previous track or different track ID: brand new track anchor
        if (!prevTrack || String(prevTrack.track_id) !== String(newTrack.track_id)) {
          return {
            speakerTrack: {
              ...newTrack,
              received_at_ms: now,
            },
          };
        }

        // If playing state changed (play -> pause, pause -> play): anchor changed
        if (prevTrack.playing !== newTrack.playing) {
          return {
            speakerTrack: {
              ...newTrack,
              received_at_ms: now,
            },
          };
        }

        // A real seek on the speaker requires that the position actually jumped significantly (> 3s)
        const posDelta = Math.abs((newTrack.position ?? 0) - (prevTrack.position ?? 0));
        const isSeek = posDelta > 3.0;

        if (isSeek) {
          return {
            speakerTrack: {
              ...newTrack,
              received_at_ms: now,
            },
          };
        }

        // Periodic poll of same track without seek:
        // Keep the stable anchor (position & received_at_ms) to avoid backward jumping/jitter
        return {
          speakerTrack: {
            ...newTrack,
            position: prevTrack.position,
            position_ts_ms: prevTrack.position_ts_ms,
            received_at_ms: prevTrack.received_at_ms || now,
          },
        };
      });
    });

    onSbercastStateUpdated((state: SberSpeakerState) => {
      savePreCastVolume();
      set((prev) => ({
        speakerVolume: state.volume_percent ?? prev.speakerVolume,
        speakerMuted: state.muted ?? prev.speakerMuted,
      }));
    });

    onSbercastConnected(({ device }) => {
      savePreCastVolume();
      set({
        isConnected: true,
        isConnecting: false,
        activeDevice: device,
      });
      showToast(`Подключено к ${device.name}`);
    });

    onSbercastDisconnected(() => {
      restorePreCastVolume();
      set({
        isConnected: false,
        isConnecting: false,
        activeDevice: null,
        speakerTrack: null,
        speakerVolume: null,
      });
      showToast('Трансляция SberCast отключена');
    });

    onSbercastPairingStart(({ host }) => {
      const dev = get().devices.find((d) => d.host === host);
      set((prev) => ({
        isPairing: true,
        pairingHost: host,
        pairingDevice:
          prev.pairingDevice ||
          dev || {
            id: `sber-${host.replace(/\./g, '-')}`,
            name: 'SberBoom',
            host,
            port: 5000,
            is_paired: false,
          },
      }));
    });

    onSbercastPairingSuccess(({ device }) => {
      set((state) => ({
        isPairing: false,
        pairingHost: null,
        pairingDevice: null,
        devices: state.devices.map((d) => (d.host === device.host ? device : d)),
      }));
      showToast(`Колонка ${device.name} успешно сопряжена!`);
      get().connectDevice(device).catch((err) => {
        console.warn('[SberCast] Auto-connect after pairing failed:', err);
      });
    });

    onSbercastPairingError(({ error }) => {
      set({ isPairing: false, pairingHost: null, pairingDevice: null });
      showToast(`Ошибка сопряжения: ${error}`, 'error');
    });
  },

  scanDevices: async () => {
    set({ isScanning: true });
    try {
      const devs = await sbercastDiscoverDevices();
      set({ devices: devs });
    } catch (err: unknown) {
      showToast(`Ошибка поиска устройств: ${(err as Error).message || err}`, 'error');
    } finally {
      set({ isScanning: false });
    }
  },

  addManualDevice: async (host, port) => {
    try {
      const dev = await sbercastAddManualDevice(host, port);
      set((state) => {
        const exists = state.devices.some((d) => d.host === dev.host);
        return {
          devices: exists ? state.devices.map((d) => (d.host === dev.host ? dev : d)) : [...state.devices, dev],
        };
      });
      showToast(`Найдено устройство: ${dev.name}`);
      return dev;
    } catch (err: unknown) {
      showToast(`Не удалось подключиться к ${host}: ${(err as Error).message || err}`, 'error');
      throw err;
    }
  },

  pairDevice: async (host, port, name) => {
    const existing = get().devices.find((d) => d.host === host);
    const targetDev: SberDevice = existing || {
      id: `sber-${host.replace(/\./g, '-')}`,
      name: name || 'SberBoom',
      host,
      port: port || 5000,
      model: null,
      is_paired: false,
    };
    set({ isPairing: true, pairingHost: host, pairingDevice: targetDev });
    try {
      const dev = await sbercastPairDevice(host, port, name);
      set((state) => ({
        isPairing: false,
        pairingHost: null,
        pairingDevice: null,
        devices: state.devices.map((d) => (d.host === dev.host ? dev : d)),
      }));
      get().connectDevice(dev).catch((err) => {
        console.warn('[SberCast] Auto-connect after pairing failed:', err);
      });
      return dev;
    } catch (err: unknown) {
      set({ isPairing: false, pairingHost: null, pairingDevice: null });
      throw err;
    }
  },

  connectDevice: async (device) => {
    savePreCastVolume();
    set({ isConnecting: true });
    try {
      await sbercastConnectDevice(device);
      set({
        isConnected: true,
        isConnecting: false,
        activeDevice: device,
      });
    } catch (err: unknown) {
      set({ isConnecting: false });
      showToast(`Ошибка подключения к ${device.name}: ${(err as Error).message || err}`, 'error');
      throw err;
    }
  },

  disconnect: async () => {
    try {
      await sbercastDisconnect();
    } catch (err) {
      console.warn('[SberCast] Disconnect error:', err);
    } finally {
      restorePreCastVolume();
      set({
        isConnected: false,
        isConnecting: false,
        activeDevice: null,
        speakerTrack: null,
        speakerVolume: null,
      });
    }
  },

  removeDevice: async (id) => {
    try {
      await sbercastRemoveSavedDevice(id);
      set((state) => ({
        devices: state.devices.filter((d) => d.id !== id),
      }));
    } catch (err) {
      console.warn('[SberCast] Remove device error:', err);
    }
  },

  setVolume: async (percent) => {
    set({ speakerVolume: percent, speakerMuted: false });
    try {
      await sbercastSetVolume(percent);
    } catch (err) {
      console.warn('[SberCast] Set volume error:', err);
    }
  },

  seek: async (seconds) => {
    try {
      await sbercastSeek(seconds);
    } catch (err) {
      console.warn('[SberCast] Seek error:', err);
    }
  },
}));
