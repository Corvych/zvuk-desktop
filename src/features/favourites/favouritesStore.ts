import { create } from 'zustand';
import {
  getLikedTrackIds,
  getLikedAlbumIds,
  getLikedArtistIds,
  likeTrack,
  unlikeTrack,
  likeAlbum,
  unlikeAlbum,
  likeArtist,
  unlikeArtist,
} from '../../api';

interface FavouritesState {
  likedTrackIds: Set<number>;
  likedAlbumIds: Set<number>;
  likedArtistIds: Set<number>;
  isInitialized: boolean;
  isLoading: boolean;

  loadLikedIds: () => Promise<void>;
  loadLikedTrackIds: () => Promise<void>;
  loadLikedAlbumIds: () => Promise<void>;
  loadLikedArtistIds: () => Promise<void>;

  isLiked: (trackId: number | string | undefined | null) => boolean;
  toggleLikeTrack: (trackId: number | string) => Promise<boolean>;

  isAlbumLiked: (albumId: number | string | undefined | null) => boolean;
  toggleLikeAlbum: (albumId: number | string) => Promise<boolean>;

  isArtistLiked: (artistId: number | string | undefined | null) => boolean;
  toggleLikeArtist: (artistId: number | string) => Promise<boolean>;
}

export const useFavouritesStore = create<FavouritesState>((set, get) => ({
  likedTrackIds: new Set<number>(),
  likedAlbumIds: new Set<number>(),
  likedArtistIds: new Set<number>(),
  isInitialized: false,
  isLoading: false,

  loadLikedIds: async () => {
    await Promise.all([
      get().loadLikedTrackIds(),
      get().loadLikedAlbumIds(),
      get().loadLikedArtistIds(),
    ]);
  },

  loadLikedTrackIds: async () => {
    try {
      const ids = await getLikedTrackIds();
      set({
        likedTrackIds: new Set(ids.map((id) => Number(id))),
        isInitialized: true,
      });
    } catch (err) {
      console.error('[FavouritesStore] Failed to load liked track IDs:', err);
    }
  },

  loadLikedAlbumIds: async () => {
    try {
      const ids = await getLikedAlbumIds();
      set({
        likedAlbumIds: new Set(ids.map((id) => Number(id))),
      });
    } catch (err) {
      console.error('[FavouritesStore] Failed to load liked album IDs:', err);
    }
  },

  loadLikedArtistIds: async () => {
    try {
      const ids = await getLikedArtistIds();
      set({
        likedArtistIds: new Set(ids.map((id) => Number(id))),
      });
    } catch (err) {
      console.error('[FavouritesStore] Failed to load liked artist IDs:', err);
    }
  },

  isLiked: (trackId) => {
    if (trackId == null) return false;
    const numId = Number(trackId);
    return get().likedTrackIds.has(numId);
  },

  toggleLikeTrack: async (trackId) => {
    if (trackId == null) return false;
    const numId = Number(trackId);
    const currentlyLiked = get().likedTrackIds.has(numId);
    const nextState = !currentlyLiked;

    // Optimistic update
    set((state) => {
      const next = new Set(state.likedTrackIds);
      if (nextState) {
        next.add(numId);
      } else {
        next.delete(numId);
      }
      return { likedTrackIds: next };
    });

    try {
      if (nextState) {
        await likeTrack(numId);
      } else {
        await unlikeTrack(numId);
      }
      return nextState;
    } catch (err) {
      console.error('[FavouritesStore] Failed to toggle like track:', err);
      // Revert optimistic update
      set((state) => {
        const reverted = new Set(state.likedTrackIds);
        if (currentlyLiked) {
          reverted.add(numId);
        } else {
          reverted.delete(numId);
        }
        return { likedTrackIds: reverted };
      });
      return currentlyLiked;
    }
  },

  isAlbumLiked: (albumId) => {
    if (albumId == null) return false;
    const numId = Number(albumId);
    return get().likedAlbumIds.has(numId);
  },

  toggleLikeAlbum: async (albumId) => {
    if (albumId == null) return false;
    const numId = Number(albumId);
    const currentlyLiked = get().likedAlbumIds.has(numId);
    const nextState = !currentlyLiked;

    // Optimistic update
    set((state) => {
      const next = new Set(state.likedAlbumIds);
      if (nextState) {
        next.add(numId);
      } else {
        next.delete(numId);
      }
      return { likedAlbumIds: next };
    });

    try {
      if (nextState) {
        await likeAlbum(numId);
      } else {
        await unlikeAlbum(numId);
      }
      return nextState;
    } catch (err) {
      console.error('[FavouritesStore] Failed to toggle like album:', err);
      // Revert optimistic update
      set((state) => {
        const reverted = new Set(state.likedAlbumIds);
        if (currentlyLiked) {
          reverted.add(numId);
        } else {
          reverted.delete(numId);
        }
        return { likedAlbumIds: reverted };
      });
      return currentlyLiked;
    }
  },

  isArtistLiked: (artistId) => {
    if (artistId == null) return false;
    const numId = Number(artistId);
    return get().likedArtistIds.has(numId);
  },

  toggleLikeArtist: async (artistId) => {
    if (artistId == null) return false;
    const numId = Number(artistId);
    const currentlyLiked = get().likedArtistIds.has(numId);
    const nextState = !currentlyLiked;

    // Optimistic update
    set((state) => {
      const next = new Set(state.likedArtistIds);
      if (nextState) {
        next.add(numId);
      } else {
        next.delete(numId);
      }
      return { likedArtistIds: next };
    });

    try {
      if (nextState) {
        await likeArtist(numId);
      } else {
        await unlikeArtist(numId);
      }
      return nextState;
    } catch (err) {
      console.error('[FavouritesStore] Failed to toggle like/subscribe artist:', err);
      // Revert optimistic update
      set((state) => {
        const reverted = new Set(state.likedArtistIds);
        if (currentlyLiked) {
          reverted.add(numId);
        } else {
          reverted.delete(numId);
        }
        return { likedArtistIds: reverted };
      });
      return currentlyLiked;
    }
  },
}));

