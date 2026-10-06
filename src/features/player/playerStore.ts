import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  getPersonalWave,
  getArtistRadio,
  type Track,
  type StreamInfo,
  type PersonalWaveContentInput,
  type PersonalWaveOptions,
} from '../../api';

export type RepeatMode = 'off' | 'all' | 'one';

export type AudioQuality = 'flac' | 'high' | 'mid';

export interface EmotionDescriptor {
  id: string;
  label: string;
  color: string;
  rgb: [number, number, number];
}

export interface WaveMoodInfo {
  activeRgb: string; // e.g. "152, 175, 244"
  dominantEmotions: EmotionDescriptor[];
  pad: { x: number; y: number };
  discovery: 'favorite' | 'unfamiliar' | null;
  popularity: 'popular' | 'rare' | null;
  language: 'russian' | 'foreign' | 'instrumental' | null;
}

export interface WaveArtist {
  id: string | number;
  name: string;
  imageUrl?: string | null;
  palette?: string | null;
}

interface PlayerState {
  // Current track
  currentTrack: Track | null;
  streamInfo: StreamInfo | null;

  // Queue
  queue: Track[];
  queueIndex: number;

  // Playback state
  isPlaying: boolean;
  progress: number; // seconds
  duration: number; // seconds
  volume: number; // 0-1
  isMuted: boolean;

  // Seek — set by user drag/click; consumed & cleared by useAudioPlayer
  seekTarget: number | null;

  // Modes
  shuffle: boolean;
  repeat: RepeatMode;

  // Quality
  isHiFi: boolean;
  quality: AudioQuality;

  // Personal Wave & Artist Radio (Сила Звука)
  isWaveMode: boolean;
  waveType: 'personal' | 'artist';
  waveArtist: WaveArtist | null;
  artistRadioPlayedCount: number;
  waveOptions: PersonalWaveOptions | null;
  waveMood: WaveMoodInfo | null;

  // Fullscreen player
  isFullscreenPlayerOpen: boolean;
  fullscreenTab: 'track' | 'lyrics' | 'queue';

  // Actions
  setTrack: (track: Track, streamInfo?: StreamInfo) => void;
  setQueue: (tracks: Track[], startIndex?: number) => void;
  startWave: (initialTracks: Track[], options?: PersonalWaveOptions | null) => void;
  startArtistWave: (artist: WaveArtist, initialTracks: Track[]) => void;
  setWaveOptions: (options: PersonalWaveOptions) => void;
  setWaveMood: (mood: WaveMoodInfo | null) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  nextTrack: (isSkipped?: boolean | unknown) => void;
  previousTrack: () => void;

  setIsPlaying: (playing: boolean) => void;
  togglePlay: () => void;
  setProgress: (seconds: number) => void;
  setDuration: (seconds: number) => void;
  seekTo: (seconds: number) => void;
  clearSeekTarget: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setQuality: (q: AudioQuality) => void;

  toggleShuffle: () => void;
  cycleRepeat: () => void;

  setStreamInfo: (info: StreamInfo) => void;
  clearPlayer: () => void;

  openFullscreenPlayer: (tab?: 'track' | 'lyrics' | 'queue') => void;
  closeFullscreenPlayer: () => void;
  setFullscreenTab: (tab: 'track' | 'lyrics' | 'queue') => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      streamInfo: null,
      queue: [],
      queueIndex: -1,
      isPlaying: false,
      progress: 0,
      duration: 0,
      volume: 0.7,
      isMuted: false,
      seekTarget: null,
      shuffle: false,
      repeat: 'off' as RepeatMode,
      isHiFi: false,
      quality: 'high' as AudioQuality,
      isWaveMode: false,
      waveType: 'personal',
      waveArtist: null,
      artistRadioPlayedCount: 0,
      waveOptions: null,
      waveMood: null,
      isFullscreenPlayerOpen: false,
      fullscreenTab: 'track',

      setTrack: (track, streamInfo) =>
        set({
          currentTrack: track,
          streamInfo: streamInfo ?? null,
          progress: 0,
          seekTarget: null,
          duration: track.duration,
          isPlaying: true,
          isHiFi: streamInfo?.quality === 'Flac',
          isWaveMode: false,
          waveType: 'personal',
          waveArtist: null,
          artistRadioPlayedCount: 0,
        }),

      setQueue: (tracks, startIndex = 0) =>
        set({
          queue: tracks,
          queueIndex: startIndex,
          currentTrack: tracks[startIndex] ?? null,
          progress: 0,
          seekTarget: null,
          isPlaying: true,
          isWaveMode: false,
          waveType: 'personal',
          waveArtist: null,
          artistRadioPlayedCount: 0,
        }),

      startWave: (initialTracks, options) =>
        set({
          isWaveMode: true,
          waveType: 'personal',
          waveArtist: null,
          artistRadioPlayedCount: 0,
          waveOptions: options ?? { popular: null, mood: 'energy:0.5,fun:0.5' },
          queue: initialTracks,
          queueIndex: 0,
          currentTrack: initialTracks[0] ?? null,
          progress: 0,
          seekTarget: null,
          isPlaying: true,
        }),

      startArtistWave: (artist, initialTracks) => {
        let resolvedArtist = { ...artist };
        if (!resolvedArtist.palette || !resolvedArtist.imageUrl) {
          const match = initialTracks
            .flatMap((t) => t.artists || [])
            .find((a) => String(a.id) === String(artist.id));
          if (match) {
            if (!resolvedArtist.palette && match.palette) {
              resolvedArtist.palette = match.palette;
            }
            if (!resolvedArtist.imageUrl && match.image_url) {
              resolvedArtist.imageUrl = match.image_url;
            }
          }
        }

        set({
          isWaveMode: true,
          waveType: 'artist',
          waveArtist: resolvedArtist,
          artistRadioPlayedCount: 0,
          waveOptions: null,
          queue: initialTracks,
          queueIndex: 0,
          currentTrack: initialTracks[0] ?? null,
          progress: 0,
          seekTarget: null,
          isPlaying: true,
        });
      },

      setWaveOptions: (options) =>
        set({
          waveOptions: options,
        }),

      setWaveMood: (mood) => {
        set({ waveMood: mood });
        if (typeof document !== 'undefined') {
          const rgb = mood?.activeRgb ?? '112, 220, 85';
          document.documentElement.style.setProperty('--wave-mood-rgb', rgb);
        }
      },

      addToQueue: (track) =>
        set((state) => ({
          queue: [...state.queue, track],
        })),

      removeFromQueue: (index) =>
        set((state) => {
          const newQueue = [...state.queue];
          newQueue.splice(index, 1);
          return { queue: newQueue };
        }),

      nextTrack: async (isSkipped?: boolean | unknown) => {
        const {
          queue,
          queueIndex,
          shuffle,
          repeat,
          isWaveMode,
          waveType,
          waveArtist,
          artistRadioPlayedCount,
          currentTrack,
          progress,
          waveOptions,
        } = get();
        if (queue.length === 0 && !isWaveMode) return;

        const skipped = typeof isSkipped === 'boolean' ? isSkipped : true;

        // If in artist wave mode:
        if (isWaveMode && waveType === 'artist' && waveArtist) {
          const nextPlayedCount = artistRadioPlayedCount + 1;
          set({ artistRadioPlayedCount: nextPlayedCount });

          // If remaining tracks in queue <= 5, fetch more tracks with cursor = nextPlayedCount
          const remainingInQueue = queue.length - (queueIndex + 1);
          if (remainingInQueue <= 5) {
            getArtistRadio(waveArtist.id, nextPlayedCount, 25)
              .then((res) => {
                if (res?.tracks && res.tracks.length > 0) {
                  const currentQueue = get().queue;
                  const tailIds = new Set(currentQueue.slice(-15).map((t) => t.id));
                  const toAdd = res.tracks.filter((t) => !tailIds.has(t.id));
                  if (toAdd.length > 0) {
                    set((state) => ({ queue: [...state.queue, ...toAdd] }));
                  }
                }
              })
              .catch((err) => console.warn('[ArtistRadio] Failed to fetch next wave tracks:', err));
          }
        } else if (isWaveMode && currentTrack) {
          // Standard personal wave replenishment
          const contentInput: PersonalWaveContentInput = {
            trackId: String(currentTrack.id),
            trackDuration: Math.max(0, Math.round(currentTrack.duration)),
            playDuration: Math.max(0, Math.round(progress)),
            isSkipped: skipped,
          };

          const waveTypeParam = get().waveMood?.discovery === 'favorite' ? 'FAVTRACKS' : null;
          getPersonalWave(contentInput, 2, waveOptions, 'AMAZME', waveTypeParam)
            .then((newTracks) => {
              if (newTracks && newTracks.length > 0) {
                const currentQueue = get().queue;
                const tailIds = new Set(currentQueue.slice(-10).map((t) => t.id));
                const toAdd = newTracks.filter((t) => !tailIds.has(t.id));
                if (toAdd.length > 0) {
                  set((state) => ({ queue: [...state.queue, ...toAdd] }));
                }
              }
            })
            .catch((err) => console.warn('[PersonalWave] Failed to fetch next wave tracks:', err));
        }

        let nextIndex: number;
        if (repeat === 'one') {
          nextIndex = queueIndex;
        } else if (shuffle) {
          nextIndex = Math.floor(Math.random() * queue.length);
        } else {
          nextIndex = queueIndex + 1;
          if (nextIndex >= queue.length) {
            if (isWaveMode) {
              if (waveType === 'artist' && waveArtist) {
                // End of artist radio queue reached, fetch synchronously
                try {
                  const res = await getArtistRadio(waveArtist.id, get().artistRadioPlayedCount, 25);
                  if (res?.tracks && res.tracks.length > 0) {
                    const currentQueue = get().queue;
                    const tailIds = new Set(currentQueue.slice(-15).map((t) => t.id));
                    const newTracks = res.tracks.filter((t) => !tailIds.has(t.id));
                    const toUse = newTracks.length > 0 ? newTracks : res.tracks;
                    set({
                      queue: [...currentQueue, ...toUse],
                      queueIndex: currentQueue.length,
                      currentTrack: toUse[0],
                      progress: 0,
                      isPlaying: true,
                    });
                    return;
                  }
                } catch (e) {
                  console.error('[ArtistRadio] End of queue fetch failed:', e);
                }
              } else {
                // If we reached the end of the queue in wave mode, fetch synchronously
                try {
                  const contentInput: PersonalWaveContentInput | null = currentTrack
                    ? {
                        trackId: String(currentTrack.id),
                        trackDuration: Math.max(0, Math.round(currentTrack.duration)),
                        playDuration: Math.max(0, Math.round(progress)),
                        isSkipped: skipped,
                      }
                    : null;
                  const newTracks = await getPersonalWave(contentInput, 1, waveOptions);
                  if (newTracks && newTracks.length > 0) {
                    const currentQueue = get().queue;
                    set({
                      queue: [...currentQueue, ...newTracks],
                      queueIndex: currentQueue.length,
                      currentTrack: newTracks[0],
                      progress: 0,
                      seekTarget: null,
                      isPlaying: true,
                    });
                    return;
                  }
                } catch (e) {
                  console.error('[PersonalWave] End of queue fetch failed:', e);
                }
              }
            }

            if (repeat === 'all') {
              nextIndex = 0;
            } else {
              set({ isPlaying: false, seekTarget: null });
              return;
            }
          }
        }

        set({
          queueIndex: nextIndex,
          currentTrack: queue[nextIndex],
          progress: 0,
          seekTarget: null,
          isPlaying: true,
        });
      },

      previousTrack: () => {
        const { queue, queueIndex, progress } = get();
        if (queue.length === 0) return;

        // If more than 3s into the track, restart it
        if (progress > 3) {
          set({ progress: 0, seekTarget: 0 });
          return;
        }

        const prevIndex = queueIndex > 0 ? queueIndex - 1 : queue.length - 1;
        set({
          queueIndex: prevIndex,
          currentTrack: queue[prevIndex],
          progress: 0,
          seekTarget: null,
          isPlaying: true,
        });
      },

      setIsPlaying: (playing) => set({ isPlaying: playing }),
      togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
      setProgress: (seconds) => set({ progress: seconds }),
      setDuration: (seconds) => set({ duration: seconds }),
      // User-initiated seek: update both display and signal the audio element
      seekTo: (seconds) => set({ progress: seconds, seekTarget: seconds }),
      clearSeekTarget: () => set({ seekTarget: null }),

      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)), isMuted: false }),
      toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
      setQuality: (q) => set({ quality: q }),

      toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),
      cycleRepeat: () =>
        set((state) => {
          const modes: RepeatMode[] = ['off', 'all', 'one'];
          const currentIdx = modes.indexOf(state.repeat);
          return { repeat: modes[(currentIdx + 1) % modes.length] };
        }),

      setStreamInfo: (info) =>
        set({
          streamInfo: info,
          isHiFi: info.quality === 'Flac',
        }),

      clearPlayer: () =>
        set({
          currentTrack: null,
          streamInfo: null,
          queue: [],
          queueIndex: -1,
          isPlaying: false,
          progress: 0,
          duration: 0,
          isWaveMode: false,
          waveType: 'personal',
          waveArtist: null,
          artistRadioPlayedCount: 0,
        }),

      openFullscreenPlayer: (tab = 'track') =>
        set({ isFullscreenPlayerOpen: true, fullscreenTab: tab }),

      closeFullscreenPlayer: () =>
        set({ isFullscreenPlayerOpen: false }),

      setFullscreenTab: (tab) =>
        set({ fullscreenTab: tab }),
    }),
    {
      name: 'zvuk-player',
      partialize: (state) => ({
        // Preferences
        volume: state.volume,
        isMuted: state.isMuted,
        shuffle: state.shuffle,
        repeat: state.repeat,
        quality: state.quality,

        // Playback state & Queue
        currentTrack: state.currentTrack,
        queue: state.queue,
        queueIndex: state.queueIndex,
        progress: state.progress,
        duration: state.duration,
        isHiFi: state.isHiFi,

        // Wave mode state
        isWaveMode: state.isWaveMode,
        waveType: state.waveType,
        waveArtist: state.waveArtist,
        artistRadioPlayedCount: state.artistRadioPlayedCount,
        waveOptions: state.waveOptions,
        waveMood: state.waveMood,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isPlaying = false;
          state.seekTarget = null;
        }
      },
    }
  )
);

