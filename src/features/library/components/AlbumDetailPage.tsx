import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAlbum, type Album } from '../../../api';
import { usePlayerStore } from '../../player/playerStore';
import { useFavouritesStore } from '../../favourites/favouritesStore';
import { ArtistLinks } from '../../../components/ArtistLinks';
import { LikeButton } from '../../../components/LikeButton';
import { HeartIcon } from '../../../components/HeartIcon';
import { ShareIcon } from '../../../components/ShareIcon';
import { showToast } from '../../../components/Toast';
import { CrystalIcon } from '../../../components/CrystalIcon';
import { usePlaylistModalStore } from '../../playlists/playlistModalStore';
import { extractMonetFromImage, type MonetTheme } from '../../../lib/monetPalette';
import { useAudioReactive } from '../../player/useAudioReactive';


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

  useAudioReactive();

  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [backdropTheme, setBackdropTheme] = useState<MonetTheme | null>(null);

  const { currentTrack, isPlaying, setQueue, togglePlay, startTrackRadio } = usePlayerStore();
  const { isLiked, toggleLikeTrack, isAlbumLiked, toggleLikeAlbum } = useFavouritesStore();

  useEffect(() => {
    setBackdropTheme(null);
    if (!album?.cover_url) return;
    let active = true;
    extractMonetFromImage(album.cover_url).then((theme) => {
      if (active) setBackdropTheme(theme);
    });
    return () => {
      active = false;
    };
  }, [album?.cover_url]);

  useEffect(() => {
    if (!album || !backdropTheme) return;
    const root = document.documentElement;
    root.style.setProperty('--artist-glow-rgb', backdropTheme.glowRgb);
    root.style.setProperty('--artist-secondary-rgb', backdropTheme.secondaryRgb);
    root.style.setProperty('--artist-tertiary-rgb', backdropTheme.tertiaryRgb);

    return () => {
      root.style.removeProperty('--artist-glow-rgb');
      root.style.removeProperty('--artist-secondary-rgb');
      root.style.removeProperty('--artist-tertiary-rgb');
    };
  }, [album, backdropTheme]);

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
    <div
      className="detail-page artist-page-container page-enter page-enter-active"
      style={
        backdropTheme
          ? ({
              '--artist-glow-rgb': backdropTheme.glowRgb,
              '--artist-secondary-rgb': backdropTheme.secondaryRgb,
              '--artist-tertiary-rgb': backdropTheme.tertiaryRgb,
              '--artist-gradient': backdropTheme.gradient,
              '--artist-accent-color': backdropTheme.accentColor,
              '--accent': backdropTheme.accentColor,
              '--accent-light': backdropTheme.accentColor,
              '--accent-muted': `rgba(${backdropTheme.glowRgb}, 0.15)`,
              '--accent-glow': `rgba(${backdropTheme.glowRgb}, 0.45)`,
            } as React.CSSProperties)
          : undefined
      }
    >
      {/* ─── Album Backdrop Artwork (Frameless Right-Flank Background Bleed with Vignette) ─── */}
      {album.cover_url && (
        <div
          className="artist-backdrop detail-backdrop"
          aria-hidden="true"
          style={{ opacity: backdropTheme ? 1 : 0, transition: 'opacity 0.35s ease' }}
        >
          <div className={`artist-backdrop__glow ${isCurrentAlbumPlaying ? 'artist-backdrop__glow--reactive' : ''}`}>
            <div className="artist-backdrop__glow-outer" />
            <div className="artist-backdrop__glow-chromatic">
              <img
                src={album.cover_url}
                alt=""
                className="artist-backdrop__glow-chromatic-img detail-backdrop__chromatic-img"
              />
            </div>
            <div className="artist-backdrop__glow-rim" />
            <div className="artist-backdrop__glow-inner" />
          </div>

          <div className="artist-backdrop__photo-wrap">
            <img
              src={album.cover_url}
              alt=""
              className="artist-backdrop__img detail-backdrop__img"
            />
            <div className="artist-backdrop__vignette" />
          </div>
        </div>
      )}

      {/* Back button */}
      <button className="detail-back-btn" onClick={() => navigate(-1)} title="Вернуться назад" style={{ position: 'relative', zIndex: 3 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Назад
      </button>

      {/* ─── Hero Section (Mirrors Favourites / Artist Detail Header) ───────── */}
      <div className="artist-hero-grid favorites-hero-grid--artist">
        <div className="artist-hero__left">
          <div>
            <div className="artist-hero__badge">{isSingle ? 'Сингл' : 'Альбом'}</div>
            <h1 className="artist-hero__title">{album.title}</h1>

            <div className="artist-hero__meta">
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
          </div>

          <div className="artist-hero__actions">
            <button
              className="artist-hero__play-btn"
              onClick={handlePlayAll}
              disabled={tracks.length === 0}
              title={isCurrentAlbumPlaying ? 'Приостановить' : 'Воспроизвести альбом'}
            >
              {isCurrentAlbumPlaying ? (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                  <span>Пауза</span>
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5V19L19 12L8 5Z" />
                  </svg>
                  <span>Слушать</span>
                </>
              )}
            </button>

            <button
              className="artist-hero__shuffle-btn"
              onClick={handleShufflePlay}
              disabled={tracks.length === 0}
              title="Перемешать и слушать"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 3H21V8" />
                <path d="M4 20L21 3" />
                <path d="M21 16V21H16" />
                <path d="M15 15L21 21" />
                <path d="M4 4L9 9" />
              </svg>
            </button>

            <button
              className="artist-hero__shuffle-btn"
              onClick={() => toggleLikeAlbum(album.id)}
              title={albumLiked ? 'Удалить из медиатеки' : 'Добавить альбом в медиатеку'}
              style={albumLiked && backdropTheme ? { color: backdropTheme.accentColor } : undefined}
            >
              <HeartIcon filled={albumLiked} size={22} />
            </button>

            <button
              className="artist-hero__shuffle-btn"
              onClick={() => {
                navigator.clipboard.writeText(`https://zvuk.com/release/${album.id}`);
                showToast('Ссылка на альбом скопирована', 'success');
              }}
              title="Поделиться альбомом"
            >
              <ShareIcon size={18} />
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
                              <span className="track-badge-hifi" title="HiFi Audio (Lossless)"><CrystalIcon size={13} /></span>
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
                      <button
                        type="button"
                        className="detail-row-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          startTrackRadio(track);
                          showToast(`Запущен поток в стиле «${track.title}»`, 'info');
                        }}
                        title="Поток по треку"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
                          <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
                          <circle cx="12" cy="12" r="2" fill="currentColor" />
                          <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
                          <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="detail-row-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          usePlaylistModalStore.getState().openAddToPlaylist(track);
                        }}
                        title="Добавить в плейлист"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="detail-row-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(`https://zvuk.com/track/${track.id}`);
                          showToast('Ссылка на трек скопирована', 'success');
                        }}
                        title="Поделиться треком"
                      >
                        <ShareIcon size={14} />
                      </button>
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
