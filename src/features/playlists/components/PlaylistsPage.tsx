import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUserPlaylists, getPlaylist, createPlaylist, type Playlist } from '../../../api';
import { usePlayerStore } from '../../player/playerStore';

export function PlaylistsPage() {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const { setQueue } = usePlayerStore();

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
      if (playlist.tracks && playlist.tracks.length > 0) {
        setQueue(playlist.tracks, 0);
      } else {
        const fullPlaylist = await getPlaylist(playlist.id);
        if (fullPlaylist?.tracks && fullPlaylist.tracks.length > 0) {
          setQueue(fullPlaylist.tracks, 0);
        }
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
                {playlist.cover_url ? (
                  <img src={playlist.cover_url} alt={playlist.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', background: 'var(--bg-card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    🎶
                  </div>
                )}
                <button
                  className="card__play-btn"
                  title="Воспроизвести"
                  onClick={(e) => handlePlayDirect(e, playlist)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              </div>
              <div className="card__title">{playlist.title}</div>
              <div className="card__subtitle">{playlist.track_count ?? 0} треков</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
