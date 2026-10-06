import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`Приложение запущенно в обычном браузере. Выполните команду 'npm run tauri dev' для работы с Tauri IPC.`);
  }
  return tauriInvoke<T>(cmd, args);
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: number;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  subscription: Subscription | null;
}

export interface Subscription {
  is_prime: boolean;
  expiration_date: string | null;
  plan: string | null;
  is_active: boolean;
  is_hifi: boolean;
}

export interface TrackArtist {
  id: number;
  name: string;
  image_url?: string | null;
  palette?: string | null;
}

export interface Track {
  id: number;
  title: string;
  duration: number;
  artist: string;
  artist_id: number | null;
  artists?: TrackArtist[];
  album: string | null;
  album_id: number | null;
  cover_url: string | null;
  palette?: string | null;
  release_year: number | null;
  is_explicit: boolean;
  is_liked: boolean | null;
  has_flac: boolean;
}

export interface StreamInfo {
  url: string;
  quality: 'Low' | 'Mid' | 'High' | 'Flac';
  codec: string;
  bitrate: number | null;
  is_drm: boolean;
  license_url: string | null;
}

export interface Album {
  id: number;
  title: string;
  artist: string;
  artist_id: number | null;
  artists?: TrackArtist[];
  cover_url: string | null;
  release_year: number | null;
  track_count: number;
  tracks: Track[] | null;
  is_liked: boolean | null;
}


export interface Artist {
  id: number;
  name: string;
  avatar_url: string | null;
  description: string | null;
  albums: Album[] | null;
  top_tracks: Track[] | null;
}

export interface ArtistGenre {
  id: string;
  name: string;
  rname?: string | null;
}

export interface ArtistRelease {
  id: number;
  title: string;
  date?: string | null;
  releaseType?: string | null;
  coverUrl?: string | null;
  palette?: string | null;
  explicit: boolean;
}

export interface RelatedArtist {
  id: number;
  title: string;
  imageUrl?: string | null;
  palette?: string | null;
}

export interface ArtistDetail {
  id: number;
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  palette?: string | null;
  genres: ArtistGenre[];
  likesCount?: number | null;
  popularTracks: Track[];
  allTrackIds: number[];
  actualRelease?: ArtistRelease | null;
  releases: ArtistRelease[];
  hasMoreReleases: boolean;
  endCursor?: string | null;
  relatedArtists: RelatedArtist[];
}

export interface ArtistRadioResult {
  cursor: number;
  tracks: Track[];
}


export interface Playlist {
  id: number;
  title: string;
  description: string | null;
  cover_url: string | null;
  track_count: number;
  duration: number;
  is_editable: boolean;
  owner: string | null;
  tracks: Track[] | null;
}

export interface SearchResults {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}

export interface AutocompleteResult {
  text: string;
  result_type: string;
  id: number | null;
}

export interface FlowState {
  tracks: Track[];
  session_id: string | null;
}

export interface PersonalWaveContentInput {
  trackId: string;
  trackDuration: number;
  playDuration: number;
  isSkipped: boolean;
}

export interface PersonalWaveOptions {
  popular?: number | string | null;
  mood?: string | null;
}

export interface TunerSettings {
  energy: number;
  discovery: number;
  mood: number;
  popularity: number;
}

export interface CollectionPage<T> {
  items: T[];
  total: number;
  has_next: boolean;
  offset: number;
}

export interface LyricsInfo {
  lyrics: string;
  is_synced: boolean;
  translation?: string | null;
}

export interface MusicRecommendationItem {
  itemType: 'Playlist' | 'Release' | 'Artist' | 'FavoriteTracks' | 'PersonalWave' | string;
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  palette: string | null;
  explicit: boolean;
  trackCount: number | null;
}

export interface ListeningHistoryItem {
  last_listening_dttm?: string | null;
  track: Track;
}


// ─── API Functions ──────────────────────────────────────────────────────────

// Auth & Sber ID
export const loginWithToken = (token: string) =>
  invoke<UserProfile>('login_with_token', { token });

export const openSberIdLogin = () =>
  invoke<void>('open_sber_id_login');

export const openBrowserLogin = () =>
  invoke<void>('open_browser_login');

export const closeSberidWindow = () =>
  invoke<void>('close_sberid_window');

export const checkAuthStatus = () =>
  invoke<UserProfile | null>('check_auth_status');

export const getSubscription = () =>
  invoke<Subscription | null>('get_subscription');

export const logout = () =>
  invoke<void>('logout');

// Tracks, Albums & Artists
export const getTrack = (id: number) =>
  invoke<Track>('get_track', { id });

export const getAlbum = (id: number) =>
  invoke<Album>('get_album', { id });

export const getArtist = (id: number) =>
  invoke<ArtistDetail>('get_artist', { id });

export const getStreamUrl = (id: number, quality: string) =>

  invoke<StreamInfo>('get_stream_url', { id, quality });

export const getLyrics = (id: number) =>
  invoke<LyricsInfo | null>('get_lyrics', { id });

// Search
export const searchAll = (query: string) =>
  invoke<SearchResults>('search', { query });

export const autocomplete = (query: string) =>
  invoke<AutocompleteResult[]>('autocomplete', { query });

// Playlists
export const getPlaylist = (id: number) =>
  invoke<Playlist>('get_playlist', { id });

export const getUserPlaylists = (offset: number, limit: number) =>
  invoke<CollectionPage<Playlist>>('get_user_playlists', { offset, limit });

export const getEditorialPlaylists = () =>
  invoke<Playlist[]>('get_editorial_playlists');

export const createPlaylist = (title: string, description?: string) =>
  invoke<Playlist>('create_playlist', { title, description });

export const deletePlaylist = (id: number) =>
  invoke<void>('delete_playlist', { id });

export const addTrackToPlaylist = (playlistId: number, trackId: number) =>
  invoke<void>('add_track_to_playlist', { playlistId, trackId });

export const removeTrackFromPlaylist = (playlistId: number, trackId: number) =>
  invoke<void>('remove_track_from_playlist', { playlistId, trackId });

// Favourites
export const getLikedTracks = (offset: number, limit: number) =>
  invoke<CollectionPage<Track>>('get_liked_tracks', { offset, limit });

export const getLikedTrackIds = () =>
  invoke<number[]>('get_liked_track_ids');

export const getLikedAlbumIds = () =>
  invoke<number[]>('get_liked_album_ids');

export const getLikedAlbums = (offset: number, limit: number) =>
  invoke<CollectionPage<Album>>('get_liked_albums', { offset, limit });

export const likeTrack = (trackId: number) =>
  invoke<void>('like_track', { trackId });

export const unlikeTrack = (trackId: number) =>
  invoke<void>('unlike_track', { trackId });

export const likeAlbum = (albumId: number) =>
  invoke<void>('like_album', { albumId });

export const unlikeAlbum = (albumId: number) =>
  invoke<void>('unlike_album', { albumId });

export const getLikedArtistIds = () =>
  invoke<number[]>('get_liked_artist_ids');

export const likeArtist = (artistId: number) =>
  invoke<void>('like_artist', { artistId });

export const unlikeArtist = (artistId: number) =>
  invoke<void>('unlike_artist', { artistId });

// Recommendations / Sound Energy / Personal Wave
export const getPersonalWave = (
  contentInput?: PersonalWaveContentInput | null,
  first?: number | null,
  options?: PersonalWaveOptions | null,
  waveSrc?: string | null,
  waveType?: string | null,
  waveInput?: any
) =>
  invoke<Track[]>('get_personal_wave', {
    contentInput: contentInput ?? null,
    first: first ?? null,
    options: options ?? null,
    waveSrc: waveSrc ?? null,
    waveType: waveType ?? null,
    waveInput: waveInput ?? null,
  });

export const getFlow = (sessionId?: string) =>
  invoke<FlowState>('get_flow', { sessionId });

export const tuneFlow = (
  sessionId: string,
  energy: number,
  discovery: number,
  mood: number,
  popularity: number
) => invoke<FlowState>('tune_flow', { sessionId, energy, discovery, mood, popularity });

export const getMusicRecommendations = (limit?: number, offset?: number) =>
  invoke<MusicRecommendationItem[]>('get_music_recommendations', { limit, offset });

export const getArtistRadio = (
  artistId: string | number,
  cursor?: number,
  limit?: number
) =>
  invoke<ArtistRadioResult>('get_artist_radio', {
    artistId: String(artistId),
    cursor: cursor ?? 0,
    limit: limit ?? 25,
  });

export const getListeningHistory = (limit?: number, offset?: number) =>
  invoke<ListeningHistoryItem[]>('get_listening_history', { limit, offset });


