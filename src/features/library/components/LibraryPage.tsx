import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLikedTracks, getLikedAlbums, getUserPlaylists, type Album, type Playlist } from '../../../api';

export function LibraryPage() {
  const navigate = useNavigate();
  const [trackCount, setTrackCount] = useState<number>(0);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isSubscribed = true;

    async function loadLibrary() {
      try {
        setLoading(true);
        const [tracksRes, albumsRes, playlistsRes] = await Promise.allSettled([
          getLikedTracks(0, 1),
          getLikedAlbums(0, 10),
          getUserPlaylists(0, 10),
        ]);

        if (!isSubscribed) return;

        if (tracksRes.status === 'fulfilled' && tracksRes.value) {
          setTrackCount(tracksRes.value.total ?? 0);
        }
        if (albumsRes.status === 'fulfilled' && albumsRes.value?.items) {
          setAlbums(albumsRes.value.items);
        }
        if (playlistsRes.status === 'fulfilled' && playlistsRes.value?.items) {
          setPlaylists(playlistsRes.value.items);
        }
      } catch (err) {
        console.error('[Library] Error loading library data:', err);
      } finally {
        if (isSubscribed) setLoading(false);
      }
    }

    loadLibrary();

    return () => {
      isSubscribed = false;
    };
  }, []);

  return (
    <div className="page-enter page-enter-active">
      <div className="page-header">
        <h1 className="page-header__title">Моя музыка</h1>
        <p className="page-header__subtitle">Ваша библиотека</p>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '32px' }}>
        <StatCard label="Треков" value={loading ? '...' : String(trackCount)} icon="♫" />
        <StatCard label="Альбомов" value={loading ? '...' : String(albums.length)} icon="◉" />
        <StatCard label="Плейлистов" value={loading ? '...' : String(playlists.length)} icon="☰" />
      </div>

      {/* Liked Albums */}
      <section className="mb-lg">
        <div className="flex items-center justify-between mb-md">
          <h3>Сохранённые альбомы</h3>
        </div>
        <div className="card-grid">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card">
                <div className="card__cover">
                  <div className="skeleton" style={{ width: '100%', height: '100%' }} />
                </div>
                <div className="skeleton" style={{ width: '80%', height: '14px', marginBottom: '6px' }} />
                <div className="skeleton" style={{ width: '60%', height: '12px' }} />
              </div>
            ))
          ) : albums.length > 0 ? (
            albums.map((album) => (
              <div key={album.id} className="card" onClick={() => navigate(`/album/${album.id}`)}>
                <div className="card__cover">
                  {album.cover_url ? (
                    <img src={album.cover_url} alt={album.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'var(--bg-card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      💿
                    </div>
                  )}
                  <button className="card__play-btn" title="Воспроизвести" onClick={(e) => { e.stopPropagation(); navigate(`/album/${album.id}`); }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  </button>
                </div>
                <div className="card__title">{album.title}</div>
                <div className="card__subtitle">{album.artist}</div>
              </div>
            ))
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>У вас пока нет сохранённых альбомов</p>
          )}
        </div>
      </section>

      {/* User Playlists */}
      <section className="mb-lg">
        <div className="flex items-center justify-between mb-md">
          <h3>Мои плейлисты</h3>
        </div>
        <div className="card-grid">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card">
                <div className="card__cover">
                  <div className="skeleton" style={{ width: '100%', height: '100%' }} />
                </div>
                <div className="skeleton" style={{ width: '80%', height: '14px', marginBottom: '6px' }} />
                <div className="skeleton" style={{ width: '60%', height: '12px' }} />
              </div>
            ))
          ) : playlists.length > 0 ? (
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
                  <button className="card__play-btn" title="Открыть плейлист" onClick={(e) => { e.stopPropagation(); navigate(`/playlist/${playlist.id}`); }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  </button>
                </div>
                <div className="card__title">{playlist.title}</div>
                <div className="card__subtitle">{playlist.track_count ?? 0} треков</div>
              </div>
            ))
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>У вас пока нет созданных плейлистов</p>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div
      style={{
        flex: 1,
        padding: '16px 20px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <span style={{ fontSize: '24px', opacity: 0.5 }}>{icon}</span>
      <div>
        <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>{value}</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{label}</div>
      </div>
    </div>
  );
}
