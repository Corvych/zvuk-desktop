import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchAll, type SearchResults, type Track } from '../../../api';
import { usePlayerStore } from '../../player/playerStore';
import { useFavouritesStore } from '../../favourites/favouritesStore';
import { formatTime } from '../../../lib/formatters';
import { ArtistLinks } from '../../../components/ArtistLinks';
import { LikeButton } from '../../../components/LikeButton';


export function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const { setQueue, currentTrack, isPlaying, togglePlay } = usePlayerStore();
  const isLiked = useFavouritesStore((s) => s.isLiked);
  const toggleLikeTrack = useFavouritesStore((s) => s.toggleLikeTrack);

  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        const res = await searchAll(query.trim());
        setResults(res);
      } catch (err) {
        console.error('[Search] Error fetching results:', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleTrackClick = (track: Track, tracks: Track[], index: number) => {
    if (currentTrack?.id === track.id) {
      togglePlay();
    } else {
      setQueue(tracks, index);
    }
  };

  const handleGenreClick = (genreName: string) => {
    setQuery(genreName);
  };

  return (
    <div className="page-enter page-enter-active">
      <div className="page-header">
        <h1 className="page-header__title">Поиск</h1>
      </div>

      {/* Search Input */}
      <div style={{ maxWidth: '600px', marginBottom: '32px' }}>
        <div className="search-bar">
          <svg className="search-bar__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            className="search-bar__input"
            style={{ height: '40px', fontSize: '15px', paddingLeft: '40px' }}
            type="text"
            placeholder="Искать треки, альбомы, исполнителей..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      {!hasQuery ? (
        /* Browse Genres */
        <section>
          <h3 className="mb-md">Обзор по жанрам</h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '12px',
          }}>
            {genres.map((genre) => (
              <div
                key={genre.name}
                onClick={() => handleGenreClick(genre.name)}
                style={{
                  padding: '20px 16px',
                  background: genre.color,
                  borderRadius: 'var(--radius-lg)',
                  cursor: 'pointer',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  fontWeight: 600,
                  fontSize: '14px',
                  color: 'white',
                }}
              >
                {genre.name}
              </div>
            ))}
          </div>
        </section>
      ) : loading ? (
        /* Loading Skeletons */
        <div>
          <section className="mb-lg">
            <h3 className="mb-md">Поиск...</h3>
            <div className="track-list">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="track-item">
                  <span className="track-item__number">{i + 1}</span>
                  <div className="track-item__info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div className="skeleton" style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-sm)', flexShrink: 0 }} />
                      <div>
                        <div className="skeleton" style={{ width: `140px`, height: '14px', marginBottom: '4px' }} />
                        <div className="skeleton" style={{ width: `90px`, height: '12px' }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        /* Real Search Results */
        <div>
          {/* Tracks Section */}
          {results?.tracks && results.tracks.length > 0 && (
            <section className="mb-lg">
              <h3 className="mb-md">Треки ({results.tracks.length})</h3>
              <div className="track-list">
                {results.tracks.map((track, idx) => {
                  const isCurrent = currentTrack?.id === track.id;
                  return (
                    <div
                      key={track.id}
                      className={`track-item ${isCurrent ? 'track-item--active' : ''}`}
                      onClick={() => handleTrackClick(track, results.tracks, idx)}
                    >
                      <span className="track-item__number">
                        {isCurrent && isPlaying ? '▶' : idx + 1}
                      </span>
                      <div className="track-item__info">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          {track.cover_url ? (
                            <img
                              src={track.cover_url}
                              alt={track.title}
                              style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-sm)', objectFit: 'cover' }}
                            />
                          ) : (
                            <div style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              🎵
                            </div>
                          )}
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 500, color: isCurrent ? 'var(--accent-light)' : 'var(--text-primary)' }}>
                              {track.title}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                              <ArtistLinks
                                artists={track.artists}
                                artistId={track.artist_id}
                                artistName={track.artist}
                              />
                            </div>
                          </div>

                        </div>
                      </div>
                      <div className="track-item__actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <LikeButton
                          isLiked={isLiked(track.id)}
                          onToggle={() => toggleLikeTrack(track.id)}
                          size={16}
                        />
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '36px', textAlign: 'right' }}>
                          {formatTime(track.duration)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Albums Section */}
          {results?.albums && results.albums.length > 0 && (
            <section className="mb-lg">
              <h3 className="mb-md">Альбомы</h3>
              <div className="card-grid">
                {results.albums.map((album) => (
                  <div key={album.id} className="card" onClick={() => navigate(`/album/${album.id}`)}>
                    <div className="card__cover">
                      {album.cover_url ? (
                        <img src={album.cover_url} alt={album.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', background: 'var(--bg-card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          💿
                        </div>
                      )}
                      <button className="card__play-btn" title="Открыть" onClick={(e) => { e.stopPropagation(); navigate(`/album/${album.id}`); }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                      </button>
                    </div>
                    <div className="card__title">{album.title}</div>
                    <div className="card__subtitle">
                      <ArtistLinks
                        artists={album.artists}
                        artistId={album.artist_id}
                        artistName={album.artist}
                      />
                    </div>
                  </div>

                ))}
              </div>
            </section>
          )}

          {/* Artists Section */}
          {results?.artists && results.artists.length > 0 && (
            <section className="mb-lg">
              <h3 className="mb-md">Исполнители</h3>
              <div className="card-grid">
                {results.artists.map((artist) => (
                  <div
                    key={artist.id}
                    className="card"
                    style={{ textAlign: 'center', cursor: 'pointer' }}
                    onClick={() => navigate(`/artist/${artist.id}`)}
                  >
                    <div className="card__cover" style={{ borderRadius: '50%', overflow: 'hidden' }}>
                      {artist.avatar_url ? (
                        <img src={artist.avatar_url} alt={artist.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', background: 'var(--bg-card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          👤
                        </div>
                      )}
                    </div>
                    <div className="card__title">{artist.name}</div>
                    <div className="card__subtitle">Исполнитель</div>
                  </div>
                ))}
              </div>
            </section>
          )}


          {!loading && results?.tracks?.length === 0 && results?.albums?.length === 0 && results?.artists?.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', marginTop: '40px' }}>
              Ничего не найдено по запросу «{query}»
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const genres = [
  { name: 'Поп', color: 'linear-gradient(135deg, #7C3AED, #6D28D9)' },
  { name: 'Рок', color: 'linear-gradient(135deg, #EF4444, #B91C1C)' },
  { name: 'Хип-хоп', color: 'linear-gradient(135deg, #F59E0B, #D97706)' },
  { name: 'Электроника', color: 'linear-gradient(135deg, #06B6D4, #0891B2)' },
  { name: 'Джаз', color: 'linear-gradient(135deg, #10B981, #059669)' },
  { name: 'Классика', color: 'linear-gradient(135deg, #8B5CF6, #6D28D9)' },
  { name: 'R&B', color: 'linear-gradient(135deg, #EC4899, #BE185D)' },
  { name: 'Инди', color: 'linear-gradient(135deg, #14B8A6, #0D9488)' },
  { name: 'Металл', color: 'linear-gradient(135deg, #64748B, #475569)' },
  { name: 'Регги', color: 'linear-gradient(135deg, #22C55E, #16A34A)' },
];
