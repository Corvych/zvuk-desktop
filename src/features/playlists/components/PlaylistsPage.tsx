import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUserPlaylists, getPlaylist, createPlaylist, type Playlist, type Track } from '../../../api';
import { usePlayerStore } from '../../player/playerStore';
import { EditPlaylistModal } from './EditPlaylistModal';
import { PlaylistCover } from './PlaylistCover';
import { useAuthStore } from '../../auth/authStore';
import { usePlaylistModalStore } from '../playlistModalStore';

export function PlaylistsPage() {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [editingTracks, setEditingTracks] = useState<Track[]>([]);
  const { setQueue } = usePlayerStore();
  const currentUser = useAuthStore((s) => s.user);
  const checkIsOwner = usePlaylistModalStore((s) => s.checkIsOwner);

  useEffect(() => {
    let isSubscribed = true;

    async function loadPlaylists() {
      try {
        setLoading(true);
        const res = await getUserPlaylists(0, 50);
        if (isSubscribed && res?.items) {
          setPlaylists(res.items);
        }
      } catch (err) {
        console.error('[Playlists] Error loading playlists:', err);
      } finally {
        if (isSubscribed) setLoading(false);
      }
    }

    loadPlaylists();

    return () => {
      isSubscribed = false;
    };
  }, []);

  const handlePlayDirect = async (e: React.MouseEvent, playlist: Playlist) => {
    e.stopPropagation();
    try {
      const fullPlaylist = (!playlist.tracks || playlist.tracks.length === 0 || !playlist.track_ids)
        ? await getPlaylist(playlist.id)
        : playlist;

      if (fullPlaylist?.tracks && fullPlaylist.tracks.length > 0) {
        setQueue(fullPlaylist.tracks, 0, {
          type: 'playlist',
          id: String(fullPlaylist.id),
          offset: fullPlaylist.tracks.length,
          total: fullPlaylist.track_ids?.length ?? fullPlaylist.track_count ?? fullPlaylist.tracks.length,
          hasNext: (fullPlaylist.track_ids?.length ?? 0) > fullPlaylist.tracks.length,
          allTrackIds: fullPlaylist.track_ids ? fullPlaylist.track_ids.map(String) : undefined,
        });
      }
    } catch (err) {
      console.error('[Playlists] Failed to play playlist:', err);
    }
  };

  const handleCreatePlaylist = async () => {
    const title = prompt('Введите название плейлиста:');
    if (title && title.trim()) {
      try {
        const newPl = await createPlaylist(title.trim());
        usePlaylistModalStore.getState().addUserPlaylistId(newPl.id);
        setPlaylists((prev) => [newPl, ...prev]);
      } catch (err) {
        console.error('[Playlists] Failed to create playlist:', err);
      }
    }
  };

  return (
    <div className="page-enter page-enter-active">
      <div className="flex items-center justify-between mb-lg">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1 className="page-header__title">Плейлисты</h1>
          <p className="page-header__subtitle">Ваши плейлисты и подборки</p>
        </div>
        <button className="btn btn--primary" onClick={handleCreatePlaylist}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Создать плейлист
        </button>
      </div>

      <div className="card-grid">
        {/* Create New Playlist Card */}
        <div
          className="card"
          onClick={handleCreatePlaylist}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '240px',
            border: '2px dashed var(--border)',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--accent-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '12px',
              color: 'var(--accent-light)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
            Новый плейлист
          </span>
        </div>

        {/* Playlist Cards */}
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card">
              <div className="card__cover">
                <div className="skeleton" style={{ width: '100%', height: '100%' }} />
              </div>
              <div className="skeleton" style={{ width: '80%', height: '14px', marginBottom: '6px' }} />
              <div className="skeleton" style={{ width: '50%', height: '12px' }} />
            </div>
          ))
        ) : (
          playlists.map((playlist) => (
            <div key={playlist.id} className="card" onClick={() => navigate(`/playlist/${playlist.id}`)}>
              <div className="card__cover">
                <PlaylistCover playlist={playlist} />
                <button
                  className="card__play-btn"
                  title="Воспроизвести"
                  onClick={(e) => handlePlayDirect(e, playlist)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
                {checkIsOwner(playlist, currentUser?.id) && (
                  <button
                    className="card__play-btn"
                    title="Редактировать плейлист"
                    style={{
                      right: '54px',
                      background: 'rgba(255, 255, 255, 0.16)',
                      color: '#ffffff',
                    }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const full = (!playlist.tracks || playlist.tracks.length === 0 || typeof playlist.is_public !== 'boolean')
                          ? await getPlaylist(playlist.id)
                          : playlist;
                        setEditingPlaylist(full);
                        setEditingTracks(full.tracks || []);
                      } catch (err) {
                        console.error('[Playlists] Failed to load full playlist for editing:', err);
                      }
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="card__title">{playlist.title}</div>
              <div className="card__subtitle">
                {playlist.is_public === false ? '🔒 ' : ''}
                {playlist.track_count ?? 0} треков
              </div>
            </div>
          ))
        )}
      </div>

      {editingPlaylist && (
        <EditPlaylistModal
          isOpen={Boolean(editingPlaylist)}
          onClose={() => setEditingPlaylist(null)}
          playlist={editingPlaylist}
          initialTracks={editingTracks}
          onSaveSuccess={(updatedName, updatedTracks, isPublic) => {
            setPlaylists((prev) =>
              prev.map((p) =>
                p.id === editingPlaylist.id
                  ? {
                      ...p,
                      title: updatedName,
                      tracks: updatedTracks,
                      track_count: updatedTracks.length,
                      cover_urls: updatedTracks.slice(0, 4).map((t) => t.cover_url).filter((u): u is string => Boolean(u)),
                      cover_url: updatedTracks[0]?.cover_url ?? p.cover_url,
                      is_public: isPublic,
                    }
                  : p
              )
            );
          }}
        />
      )}
    </div>
  );
}
