import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  getPersonalWave,
  getArtistRadio,
  getLikedTracks,
  getTracksByIds,
  getPlaylist,
  type Track,
  type StreamInfo,
  type PersonalWaveContentInput,
  type PersonalWaveOptions,
} from '../../api';

export interface QueueContext {
  type: 'favourites' | 'playlist' | 'album' | 'artist' | 'custom';
  id?: string | number;
  offset: number;
  hasNext: boolean;
  total?: number;
  allTrackIds?: (string | number)[];
}

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

  // Queue Context for dynamic pagination (favourites, playlists, etc.)
  queueContext: QueueContext | null;
  isFetchingMoreQueue: boolean;

  // Actions
  setTrack: (track: Track, streamInfo?: StreamInfo) => void;
  setQueue: (tracks: Track[], startIndex?: number, context?: QueueContext | null) => void;
  appendToQueue: (tracks: Track[]) => void;
  loadMoreQueueTracks: () => Promise<boolean>;
  playQueueTrack: (index: number) => void;
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

let activeQueueFetchPromise: Promise<boolean> | null = null;
let activeFetchContextId = 0;

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
      queueContext: null,
      isFetchingMoreQueue: false,

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
          queueContext: null,
        }),

      setQueue: (tracks, startIndex = 0, context = null) => {
        activeFetchContextId++;
        activeQueueFetchPromise = null;
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
          queueContext: context ?? null,
          isFetchingMoreQueue: false,
        });

        // If starting near the end of loaded tracks, proactively prefetch next page
        const remaining = tracks.length - (startIndex + 1);
        if (context?.hasNext && remaining <= 5) {
          get().loadMoreQueueTracks().catch((err) =>
            console.warn('[playerStore] Initial prefetch error:', err)
          );
        }
      },

      appendToQueue: (tracks) =>
        set((state) => {
          if (!tracks || tracks.length === 0) return state;
          const existingIds = new Set(state.queue.map((t) => String(t.id)));
          const newTracks = tracks.filter((t) => !existingIds.has(String(t.id)));
          if (newTracks.length === 0) return state;
          const nextQueue = [...state.queue, ...newTracks];
          return {
            queue: nextQueue,
            queueContext: state.queueContext
              ? {
                  ...state.queueContext,
                  offset: Math.max(state.queueContext.offset, nextQueue.length),
                  hasNext: state.queueContext.total
                    ? nextQueue.length < state.queueContext.total
                    : state.queueContext.allTrackIds
                    ? nextQueue.length < state.queueContext.allTrackIds.length
                    : state.queueContext.hasNext,
                }
              : null,
          };
        }),

      playQueueTrack: (index: number) => {
        const { queue } = get();
        if (index >= 0 && index < queue.length) {
          set({
            queueIndex: index,
            currentTrack: queue[index],
            progress: 0,
            seekTarget: null,
            isPlaying: true,
          });
          const remaining = queue.length - (index + 1);
          if (remaining <= 5 && get().queueContext?.hasNext) {
            get().loadMoreQueueTracks().catch(() => {});
          }
        }
      },

      loadMoreQueueTracks: async () => {
        if (activeQueueFetchPromise) {
          return activeQueueFetchPromise;
        }

        const { queueContext } = get();
        if (!queueContext || !queueContext.hasNext) return false;

        const thisFetchContextId = activeFetchContextId;
        set({ isFetchingMoreQueue: true });

        activeQueueFetchPromise = (async () => {
          try {
            if (queueContext.type === 'favourites') {
              const currentQueue = get().queue;
              const currentOffset = Math.max(queueContext.offset, currentQueue.length);
              const res = await getLikedTracks(currentOffset, 50);
              if (activeFetchContextId !== thisFetchContextId) return false;

              if (res?.items && res.items.length > 0) {
                const freshQueue = get().queue;
                const existingIds = new Set(freshQueue.map((t) => String(t.id)));
                const newTracks = res.items.filter((t) => !existingIds.has(String(t.id)));
                const nextQueue = [...freshQueue, ...newTracks];
                const nextOffset = currentOffset + res.items.length;
                const hasNext = res.has_next;
                set((state) => ({
                  queue: nextQueue,
                  queueContext: state.queueContext
                    ? {
                        ...state.queueContext,
                        offset: nextOffset,
                        hasNext,
                        total: res.total,
                      }
                    : null,
                }));
                return newTracks.length > 0;
              } else {
                set((state) => ({
                  queueContext: state.queueContext ? { ...state.queueContext, hasNext: false } : null,
                }));
                return false;
              }
            } else if (queueContext.type === 'playlist') {
              let allTrackIds = queueContext.allTrackIds;
              if (!allTrackIds || allTrackIds.length === 0) {
                if (queueContext.id) {
                  try {
                    const pl = await getPlaylist(Number(queueContext.id));
                    if (pl?.track_ids && pl.track_ids.length > 0) {
                      allTrackIds = pl.track_ids.map(String);
                      if (activeFetchContextId === thisFetchContextId) {
                        set((state) => ({
                          queueContext: state.queueContext
                            ? { ...state.queueContext, allTrackIds }
                            : null,
                        }));
                      }
                    }
                  } catch (e) {
                    console.error('[playerStore] Failed to resolve playlist track_ids:', e);
                  }
                }
              }

              if (allTrackIds && allTrackIds.length > 0) {
                const currentQueue = get().queue;
                const currentOffset = Math.max(queueContext.offset, currentQueue.length);
                const nextSlice = allTrackIds.slice(currentOffset, currentOffset + 50);
                if (nextSlice.length > 0) {
                  const res = await getTracksByIds(nextSlice);
                  if (activeFetchContextId !== thisFetchContextId) return false;

                  if (res && res.length > 0) {
                    const freshQueue = get().queue;
                    const existingIds = new Set(freshQueue.map((t) => String(t.id)));
                    const newTracks = res.filter((t) => !existingIds.has(String(t.id)));
                    const nextQueue = [...freshQueue, ...newTracks];
                    const nextOffset = currentOffset + nextSlice.length;
                    const hasNext = nextOffset < allTrackIds.length;
                    set((state) => ({
                      queue: nextQueue,
                      queueContext: state.queueContext
                        ? {
                            ...state.queueContext,
                            offset: nextOffset,
                            hasNext,
                            allTrackIds,
                          }
                        : null,
                    }));
                    return newTracks.length > 0;
                  }
                } else {
                  set((state) => ({
                    queueContext: state.queueContext ? { ...state.queueContext, hasNext: false } : null,
                  }));
                  return false;
                }
              }
            }
            return false;
          } catch (err) {
            console.error('[playerStore] Failed to load more queue tracks:', err);
            return false;
          } finally {
            if (activeFetchContextId === thisFetchContextId) {
              set({ isFetchingMoreQueue: false });
            }
            activeQueueFetchPromise = null;
          }
        })();

        return activeQueueFetchPromise;
      },

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
            } else if (get().queueContext?.hasNext) {
              // End of queue reached in paginated source: await next page!
              await get().loadMoreQueueTracks();
              const updatedQueue = get().queue;
              if (nextIndex < updatedQueue.length) {
                set({
                  queueIndex: nextIndex,
                  currentTrack: updatedQueue[nextIndex],
                  progress: 0,
                  seekTarget: null,
                  isPlaying: true,
                });
                const remainingAfter = updatedQueue.length - (nextIndex + 1);
                if (remainingAfter <= 5 && get().queueContext?.hasNext) {
                  get().loadMoreQueueTracks().catch(() => {});
                }
                return;
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

        const currentQueue = get().queue;
        set({
          queueIndex: nextIndex,
          currentTrack: currentQueue[nextIndex],
          progress: 0,
          seekTarget: null,
          isPlaying: true,
        });

        // Proactively prefetch more tracks when remaining tracks <= 5
        const remainingInQueue = currentQueue.length - (nextIndex + 1);
        if (remainingInQueue <= 5 && get().queueContext?.hasNext) {
          get().loadMoreQueueTracks().catch((err) =>
            console.warn('[playerStore] Proactive queue fetch error:', err)
          );
        }
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

        // Queue context
        queueContext: state.queueContext,
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

