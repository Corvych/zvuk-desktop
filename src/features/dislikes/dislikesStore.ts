import { create } from 'zustand';
import {
  getDislikedTrackIds,
  getDislikedArtistIds,
  dislikeTrack,
  undislikeTrack,
  dislikeArtist,
  undislikeArtist,
} from '../../api';
import { useFavouritesStore } from '../favourites/favouritesStore';
import { usePlayerStore } from '../player/playerStore';
import { showToast } from '../../components/Toast';

interface DislikesState {
  dislikedTrackIds: Set<number>;
  dislikedArtistIds: Set<number>;
  isInitialized: boolean;
  isLoading: boolean;

  loadDislikedIds: () => Promise<void>;
  loadDislikedTrackIds: () => Promise<void>;
  loadDislikedArtistIds: () => Promise<void>;

  isDisliked: (trackId: number | string | undefined | null) => boolean;
  toggleDislikeTrack: (
    trackId: number | string,
    options?: { skipCurrent?: boolean }
  ) => Promise<boolean>;

  isArtistDisliked: (artistId: number | string | undefined | null) => boolean;
  toggleDislikeArtist: (
    artistId: number | string,
    artistName?: string
  ) => Promise<boolean>;
}

export const useDislikesStore = create<DislikesState>((set, get) => ({
  dislikedTrackIds: new Set<number>(),
  dislikedArtistIds: new Set<number>(),
  isInitialized: false,
  isLoading: false,

  loadDislikedIds: async () => {
    await Promise.all([
      get().loadDislikedTrackIds(),
      get().loadDislikedArtistIds(),
    ]);
  },

  loadDislikedTrackIds: async () => {
    try {
      const ids = await getDislikedTrackIds();
      set({
        dislikedTrackIds: new Set(ids.map((id) => Number(id))),
        isInitialized: true,
      });
    } catch (err) {
      console.warn('[DislikesStore] Failed to load disliked track IDs:', err);
    }
  },

  loadDislikedArtistIds: async () => {
    try {
      const ids = await getDislikedArtistIds();
      set({
        dislikedArtistIds: new Set(ids.map((id) => Number(id))),
      });
    } catch (err) {
      console.warn('[DislikesStore] Failed to load disliked artist IDs:', err);
    }
  },

  isDisliked: (trackId) => {
    if (trackId == null) return false;
    const numId = Number(trackId);
    return get().dislikedTrackIds.has(numId);
  },

  toggleDislikeTrack: async (trackId, options = {}) => {
    if (trackId == null) return false;
    const numId = Number(trackId);
    const currentlyDisliked = get().dislikedTrackIds.has(numId);
    const nextState = !currentlyDisliked;
    const { skipCurrent = true } = options;

    // Optimistic state update
    set((state) => {
      const next = new Set(state.dislikedTrackIds);
      if (nextState) {
        next.add(numId);
      } else {
        next.delete(numId);
      }
      return { dislikedTrackIds: next };
    });

    if (nextState) {
      // Dislike placed: mutually clear like if present
      if (useFavouritesStore.getState().isLiked(numId)) {
        void useFavouritesStore.getState().toggleLikeTrack(numId);
      }

      // If currently playing track is being disliked, skip to next track
      if (skipCurrent) {
        const cur = usePlayerStore.getState().currentTrack;
        if (cur && Number(cur.id) === numId) {
          usePlayerStore.getState().nextTrack(true);
        }
      }

      showToast('Трек скрыт и не будет рекомендоваться');
    } else {
      showToast('Трек восстановлен в рекомендациях');
    }

    try {
      if (nextState) {
        await dislikeTrack(numId);
      } else {
        await undislikeTrack(numId);
      }
      return nextState;
    } catch (err) {
      console.error('[DislikesStore] Failed to toggle dislike for track:', err);
      // Revert optimistic update
      set((state) => {
        const reverted = new Set(state.dislikedTrackIds);
        if (currentlyDisliked) {
          reverted.add(numId);
        } else {
          reverted.delete(numId);
        }
        return { dislikedTrackIds: reverted };
      });
      showToast('Не удалось обновить статус дизлайка');
      return currentlyDisliked;
    }
  },

  isArtistDisliked: (artistId) => {
    if (artistId == null) return false;
    const numId = Number(artistId);
    return get().dislikedArtistIds.has(numId);
  },

  toggleDislikeArtist: async (artistId, artistName) => {
    if (artistId == null) return false;
    const numId = Number(artistId);
    const currentlyDisliked = get().dislikedArtistIds.has(numId);
    const nextState = !currentlyDisliked;

    // Optimistic update
    set((state) => {
      const next = new Set(state.dislikedArtistIds);
      if (nextState) {
        next.add(numId);
      } else {
        next.delete(numId);
      }
      return { dislikedArtistIds: next };
    });

    if (nextState) {
      // If currently playing track belongs to this artist, skip track
      const cur = usePlayerStore.getState().currentTrack;
      const curArtistId = cur?.artist_id || (cur?.artists && cur.artists[0]?.id);
      if (curArtistId && Number(curArtistId) === numId) {
        usePlayerStore.getState().nextTrack(true);
      }

      showToast(artistName ? `Исполнитель «${artistName}» скрыт` : 'Исполнитель скрыт');
    } else {
      showToast(artistName ? `Исполнитель «${artistName}» восстановлен` : 'Исполнитель восстановлен');
    }

    try {
      if (nextState) {
        await dislikeArtist(numId);
      } else {
        await undislikeArtist(numId);
      }
      return nextState;
    } catch (err) {
      console.error('[DislikesStore] Failed to toggle dislike for artist:', err);
      // Revert optimistic update
      set((state) => {
        const reverted = new Set(state.dislikedArtistIds);
        if (currentlyDisliked) {
          reverted.add(numId);
        } else {
          reverted.delete(numId);
        }
        return { dislikedArtistIds: reverted };
      });
      showToast('Не удалось скрыть исполнителя');
      return currentlyDisliked;
    }
  },
}));

