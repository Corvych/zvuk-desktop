import { create } from 'zustand';
import { getUserShortPlaylists } from '../../api';

export interface TargetTrackInfo {
  id: number | string;
  title: string;
  artist?: string;
  cover_url?: string | null;
}

interface PlaylistModalState {
  isAddToPlaylistOpen: boolean;
  targetTrack: TargetTrackInfo | null;
  userPlaylistIds: Set<string>;
  openAddToPlaylist: (track: TargetTrackInfo) => void;
  closeAddToPlaylist: () => void;
  loadUserPlaylistIds: () => Promise<void>;
  addUserPlaylistId: (id: string | number) => void;
  checkIsOwner: (
    playlist: { id: number | string; owner?: string | null; is_editable?: boolean } | null,
    currentUserId?: number | string | null
  ) => boolean;
}

export const usePlaylistModalStore = create<PlaylistModalState>((set, get) => ({
  isAddToPlaylistOpen: false,
  targetTrack: null,
  userPlaylistIds: new Set<string>(),

  openAddToPlaylist: (track) => set({ isAddToPlaylistOpen: true, targetTrack: track }),
  closeAddToPlaylist: () => set({ isAddToPlaylistOpen: false, targetTrack: null }),

  loadUserPlaylistIds: async () => {
    try {
      const res = await getUserShortPlaylists(50, '');
      const ids = new Set((res.playlists || []).map((p) => String(p.id)));
      set({ userPlaylistIds: ids });
    } catch (err) {
      console.error('[playlistModalStore] Failed to load user playlist IDs:', err);
    }
  },

  addUserPlaylistId: (id) =>
    set((state) => {
      const next = new Set(state.userPlaylistIds);
      next.add(String(id));
      return { userPlaylistIds: next };
    }),

  checkIsOwner: (playlist, currentUserId) => {
    if (!playlist) return false;
    // 1. Explicit is_editable flag from API
    if (playlist.is_editable) return true;
    // 2. Direct owner ID match with current user ID
    if (
      currentUserId &&
      playlist.owner &&
      String(playlist.owner).trim() === String(currentUserId).trim()
    ) {
      return true;
    }
    // 3. Playlist is in user's own playlists collection
    if (get().userPlaylistIds.has(String(playlist.id))) {
      return true;
    }
    return false;
  },
}));
