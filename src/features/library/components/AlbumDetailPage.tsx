import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAlbum, type Album } from '../../../api';
import { usePlayerStore } from '../../player/playerStore';
import { useFavouritesStore } from '../../favourites/favouritesStore';
import { ArtistLinks } from '../../../components/ArtistLinks';
import { LikeButton } from '../../../components/LikeButton';
import { HeartIcon } from '../../../components/HeartIcon';


function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return '0 мин';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} ч ${minutes} мин`;
  }
  return `${minutes} мин`;
}

function formatTrackTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function AlbumDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { currentTrack, isPlaying, setQueue, togglePlay } = usePlayerStore();
  const { isLiked, toggleLikeTrack, isAlbumLiked, toggleLikeAlbum } = useFavouritesStore();

  useEffect(() => {
    let isSubscribed = true;
    if (!id) return;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await getAlbum(Number(id));
        if (isSubscribed) {
          setAlbum(data);
        }
      } catch (err: any) {
        console.error('[AlbumDetailPage] Failed to load album:', err);
        if (isSubscribed) {
          setError(err?.message || 'Не удалось загрузить альбом');
        }
      } finally {
        if (isSubscribed) setLoading(false);
      }
    }

    load();

    return () => {
      isSubscribed = false;
    };
  }, [id]);

  const tracks = album?.tracks || [];
  const isCurrentAlbumPlaying =
    isPlaying && tracks.some((t) => t.id === currentTrack?.id);

  const handlePlayAll = () => {
    if (tracks.length === 0) return;
    if (isCurrentAlbumPlaying) {
      togglePlay();
      return;
    }
    setQueue(tracks, 0);
  };

  const handleTrackClick = (index: number) => {
    if (tracks.length === 0) return;
    if (currentTrack?.id === tracks[index].id) {
      togglePlay();
      return;
    }
    setQueue(tracks, index);
  };

  const handleShufflePlay = () => {
    if (tracks.length === 0) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    setQueue(shuffled, 0);
  };

  if (loading) {
    return (
      <div className="detail-page page-enter page-enter-active">
        <button className="detail-back-btn" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Назад
        </button>
        <div className="detail-hero">
          <div className="skeleton detail-hero__cover-skeleton" />
          <div className="detail-hero__info">
            <div className="skeleton" style={{ width: '80px', height: '22px', borderRadius: '12px', marginBottom: '12px' }} />
            <div className="skeleton" style={{ width: '60%', height: '36px', marginBottom: '16px' }} />
            <div className="skeleton" style={{ width: '35%', height: '16px', marginBottom: '24px' }} />
            <div className="skeleton" style={{ width: '130px', height: '48px', borderRadius: '24px' }} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !album) {
    return (
      <div className="detail-page page-enter page-enter-active">
        <button className="detail-back-btn" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Назад
        </button>
        <div className="detail-empty">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>💿</div>
          <h2>{error || 'Альбом не найден'}</h2>
          <button className="btn btn--secondary mt-md" onClick={() => navigate('/library')}>
            В медиатеку
          </button>
        </div>
      </div>
    );
  }

  const totalDuration = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const isSingle = (album.track_count || tracks.length) <= 2;
  const albumLiked = isAlbumLiked(album.id);

  return (
    <div className="detail-page page-enter page-enter-active">
      {/* Back button */}
      <button className="detail-back-btn" onClick={() => navigate(-1)} title="Вернуться назад">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Назад
      </button>

      {/* Hero Header */}
      <div className="detail-hero">
        {album.cover_url && (
          <div
            className="detail-hero__backdrop"
            style={{ backgroundImage: `url(${album.cover_url})` }}
          />
        )}
        <div className="detail-hero__cover">
          {album.cover_url ? (
            <img src={album.cover_url} alt={album.title} />
          ) : (
            <div className="detail-hero__cover-fallback">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </div>
          )}
        </div>

        <div className="detail-hero__info">
          <span className="detail-badge">{isSingle ? 'СИНГЛ' : 'АЛЬБОМ'}</span>
          <h1 className="detail-hero__title">{album.title}</h1>

          <div className="detail-hero__meta">
            <ArtistLinks
              artists={album.artists}
              artistId={album.artist_id}
              artistName={album.artist}
              className="detail-hero__author"
              style={{ fontWeight: 600 }}
            />


            {album.release_year && (
              <>
                <span className="detail-hero__dot">·</span>
                <span>{album.release_year}</span>
              </>
            )}
            <span className="detail-hero__dot">·</span>
            <span>{tracks.length > 0 ? tracks.length : album.track_count} треков</span>
            {totalDuration > 0 && (
              <>
                <span className="detail-hero__dot">·</span>
                <span>{formatDuration(totalDuration)}</span>
              </>
            )}
          </div>

          <div className="detail-hero__actions">
            <button
              className="detail-play-btn"
              onClick={handlePlayAll}
              disabled={tracks.length === 0}
              title={isCurrentAlbumPlaying ? 'Приостановить' : 'Воспроизвести альбом'}
            >
              {isCurrentAlbumPlaying ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5V19L19 12L8 5Z" />
                </svg>
              )}
              {isCurrentAlbumPlaying ? 'Пауза' : 'Слушать'}
            </button>

            <button
              className="detail-action-btn"
              onClick={handleShufflePlay}
              disabled={tracks.length === 0}
              title="Перемешать и слушать"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M16 3H21V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4 20L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M21 16V21H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15 15L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4 4L9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <button
              className={`detail-action-btn ${albumLiked ? 'detail-action-btn--liked' : ''}`}
              onClick={() => toggleLikeAlbum(album.id)}
              title={albumLiked ? 'Удалить из медиатеки' : 'Добавить альбом в медиатеку'}
            >
              <HeartIcon filled={albumLiked} size={22} />
            </button>
          </div>
        </div>
      </div>

      {/* Tracks Section */}
      <div className="detail-tracks-section">
        {tracks.length === 0 ? (
          <div className="detail-empty">
            <p>В этом альбоме пока нет треков</p>
          </div>
        ) : (
          <div className="detail-table">
            <div className="detail-table__head">
              <div className="detail-table__th detail-table__col-num">#</div>
              <div className="detail-table__th detail-table__col-title">Название</div>
              <div className="detail-table__th detail-table__col-actions" />
              <div className="detail-table__th detail-table__col-time">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/>
                  <path d="M12 7V12L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
            </div>

            <div className="detail-table__body">
              {tracks.map((track, index) => {
                const isCurrent = currentTrack?.id === track.id;
                const isHovered = hoveredIndex === index;
                const trackLiked = isLiked(track.id);

                return (
                  <div
                    key={`${track.id}-${index}`}
                    className={`detail-row ${isCurrent ? 'detail-row--active' : ''}`}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    onClick={() => handleTrackClick(index)}
                  >
                    <div className="detail-table__col-num">
                      {isCurrent && isPlaying ? (
                        <div className="equalizer-indicator">
                          <span />
                          <span />
                          <span />
                        </div>
                      ) : isHovered ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5V19L19 12L8 5Z" />
                        </svg>
                      ) : (
                        <span>{index + 1}</span>
                      )}
                    </div>

                    <div className="detail-table__col-title">
                      <div className="detail-track-info">
                        <div className="detail-track-names" style={{ marginLeft: 0 }}>
                          <div className="detail-track-title">
                            <span className={isCurrent ? 'text-accent' : ''}>
                              {track.title}
                            </span>
                            {track.is_explicit && (
                              <span className="track-badge-e" title="Explicit content">E</span>
                            )}
                            {track.has_flac && (
                              <span className="track-badge-hifi" title="HiFi Audio">HiFi</span>
                            )}
                          </div>
                          <div className="detail-track-artist">
                            <ArtistLinks
                              artists={track.artists}
                              artistId={track.artist_id}
                              artistName={track.artist}
                            />
                          </div>
                        </div>


                      </div>
                    </div>

                    <div className="detail-table__col-actions">
                      <LikeButton
                        isLiked={trackLiked}
                        onToggle={() => toggleLikeTrack(track.id)}
                        size={16}
                      />
                    </div>

                    <div className="detail-table__col-time">
                      {formatTrackTime(track.duration)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
