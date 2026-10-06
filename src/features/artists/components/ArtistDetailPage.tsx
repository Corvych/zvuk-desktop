import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getArtist, getAlbum, getArtistRadio, type ArtistDetail, type ArtistRelease } from '../../../api';

import { usePlayerStore } from '../../player/playerStore';
import { useFavouritesStore } from '../../favourites/favouritesStore';
import { formatTime } from '../../../lib/formatters';
import { ArtistLinks } from '../../../components/ArtistLinks';
import { extractMonetThemeFromPalette, extractMonetFromImage, type MonetTheme } from '../../../lib/monetPalette';
import { useAudioReactive } from '../../player/useAudioReactive';
import { LikeButton } from '../../../components/LikeButton';
import { HeartIcon } from '../../../components/HeartIcon';

function formatFollowersCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M подписчиков`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K подписчиков`;
  }
  return `${count} подписчиков`;
}

export function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Keep audio reactive calculations active
  useAudioReactive();

  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredTrackIndex, setHoveredTrackIndex] = useState<number | null>(null);
  const [releaseFilter, setReleaseFilter] = useState<'all' | 'album' | 'single'>('all');
  const [bioExpanded, setBioExpanded] = useState(false);
  const [radioLoading, setRadioLoading] = useState(false);

  const [monetTheme, setMonetTheme] = useState<MonetTheme>(() =>
    extractMonetThemeFromPalette(null)
  );

  const {
    currentTrack,
    isPlaying,
    isWaveMode,
    waveType,
    waveArtist,
    startArtistWave,
    setQueue,
    togglePlay,
  } = usePlayerStore();

  const {
    isLiked,
    toggleLikeTrack,
    isArtistLiked,
    toggleLikeArtist,
    isAlbumLiked,
    toggleLikeAlbum,
  } = useFavouritesStore();

  const isFollowed = artist ? isArtistLiked(artist.id) : false;

  useEffect(() => {
    let isMounted = true;
    if (!id) return;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await getArtist(Number(id));
        if (isMounted) {
          setArtist(data);
        }
      } catch (err: any) {
        console.error('[ArtistDetailPage] Failed to load artist:', err);
        if (isMounted) {
          setError(err?.message || 'Не удалось загрузить данные исполнителя');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [id]);

  // Extract adaptive Monet theme from artist avatar image or palette
  useEffect(() => {
    if (!artist) return;
    if (artist.imageUrl) {
      extractMonetFromImage(artist.imageUrl, artist.palette).then(setMonetTheme);
    } else if (artist.palette) {
      setMonetTheme(extractMonetThemeFromPalette(artist.palette));
    }
  }, [artist?.imageUrl, artist?.palette]);

  // Check if artist is currently playing
  const isArtistInCurrentTrack = Boolean(
    isPlaying &&
    currentTrack &&
    artist &&
    (
      (currentTrack.artist_id != null && Number(currentTrack.artist_id) === Number(artist.id)) ||
      (currentTrack.artists && currentTrack.artists.some((a) => Number(a.id) === Number(artist.id))) ||
      (currentTrack.artist && currentTrack.artist.toLowerCase().includes(artist.title.toLowerCase()))
    )
  );

  // Top / Actual Album Card
  const topAlbum = useMemo(() => {
    if (!artist) return null;
    return (
      artist.actualRelease ||
      artist.releases?.find((r) => r.releaseType === 'album') ||
      artist.releases?.[0] ||
      null
    );
  }, [artist]);

  // Cohesive stack of album/track covers for "Поток по артисту"
  const flowCovers = useMemo(() => {
    const covers: string[] = [];
    if (artist?.imageUrl) covers.push(artist.imageUrl);
    if (artist?.releases) {
      for (const r of artist.releases) {
        if (r.coverUrl && !covers.includes(r.coverUrl)) {
          covers.push(r.coverUrl);
          if (covers.length >= 3) break;
        }
      }
    }
    if (covers.length < 3 && artist?.popularTracks) {
      for (const t of artist.popularTracks) {
        if (t.cover_url && !covers.includes(t.cover_url)) {
          covers.push(t.cover_url);
          if (covers.length >= 3) break;
        }
      }
    }
    return covers;
  }, [artist]);

  const popularTracks = artist?.popularTracks || [];
  const maxPopular = Math.min(12, popularTracks.length);
  const midPoint = Math.ceil(maxPopular / 2);
  const leftTracks = popularTracks.slice(0, midPoint);
  const rightTracks = popularTracks.slice(midPoint, maxPopular);

  const isCurrentArtistPlaying =
    isPlaying && popularTracks.some((t) => t.id === currentTrack?.id);

  const handlePlayPopular = () => {
    if (popularTracks.length === 0) return;
    if (isCurrentArtistPlaying) {
      togglePlay();
      return;
    }
    setQueue(popularTracks, 0);
  };

  const handleTrackClick = (index: number) => {
    if (popularTracks.length === 0) return;
    if (currentTrack?.id === popularTracks[index].id) {
      togglePlay();
      return;
    }
    setQueue(popularTracks, index);
  };

  const isCurrentArtistWaveActive =
    isWaveMode &&
    waveType === 'artist' &&
    String(waveArtist?.id) === String(artist?.id);
  const isCurrentArtistWavePlaying = isCurrentArtistWaveActive && isPlaying;

  const handleStartArtistRadio = async () => {
    if (!artist) return;
    if (isCurrentArtistWaveActive) {
      togglePlay();
      return;
    }

    try {
      setRadioLoading(true);
      const res = await getArtistRadio(artist.id, 0, 25);
      if (res?.tracks && res.tracks.length > 0) {
        startArtistWave(
          {
            id: artist.id,
            name: artist.title,
            imageUrl: artist.imageUrl,
            palette: artist.palette,
          },
          res.tracks
        );
      }
    } catch (err) {
      console.error('[ArtistDetailPage] Failed to start artist radio:', err);
    } finally {
      setRadioLoading(false);
    }
  };

  const handleToggleSubscribe = async () => {
    if (!artist) return;
    const nextSubscribed = await toggleLikeArtist(artist.id);
    if (artist.likesCount != null) {
      setArtist((prev) =>
        prev
          ? {
              ...prev,
              likesCount: nextSubscribed
                ? (prev.likesCount || 0) + 1
                : Math.max(0, (prev.likesCount || 0) - 1),
            }
          : null
      );
    }
  };

  const handleShufflePlay = () => {
    if (popularTracks.length === 0) return;
    const shuffled = [...popularTracks].sort(() => Math.random() - 0.5);
    setQueue(shuffled, 0);
  };

  const handlePlayRelease = async (e: React.MouseEvent, release: ArtistRelease) => {
    e.stopPropagation();
    try {
      const full = await getAlbum(release.id);
      if (full?.tracks && full.tracks.length > 0) {
        setQueue(full.tracks, 0);
      }
    } catch (err) {
      console.error('[ArtistDetailPage] Failed to play release:', err);
    }
  };

  const filteredReleases = useMemo(() => {
    if (!artist?.releases) return [];
    if (releaseFilter === 'all') return artist.releases;
    return artist.releases.filter((r) => r.releaseType === releaseFilter);
  }, [artist?.releases, releaseFilter]);

  if (loading) {
    return (
      <div className="detail-page page-enter page-enter-active">
        <button className="detail-back-btn" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Назад
        </button>
        <div className="artist-hero-grid">
          <div className="artist-hero__left">
            <div className="skeleton" style={{ width: '80px', height: '18px', borderRadius: '4px', marginBottom: '12px' }} />
            <div className="skeleton" style={{ width: '55%', height: '52px', borderRadius: '8px', marginBottom: '16px' }} />
            <div className="skeleton" style={{ width: '40%', height: '20px', borderRadius: '4px', marginBottom: '24px' }} />
            <div className="skeleton" style={{ width: '70%', height: '60px', borderRadius: '8px', marginBottom: '32px' }} />
            <div style={{ display: 'flex', gap: '14px' }}>
              <div className="skeleton" style={{ width: '130px', height: '48px', borderRadius: '24px' }} />
              <div className="skeleton" style={{ width: '150px', height: '48px', borderRadius: '24px' }} />
            </div>
          </div>
          <div className="skeleton" style={{ width: '230px', height: '260px', borderRadius: '20px' }} />
          <div className="skeleton" style={{ width: '270px', height: '270px', borderRadius: '24px' }} />
        </div>
      </div>
    );
  }

  if (error || !artist) {
    return (
      <div className="detail-page page-enter page-enter-active">
        <button className="detail-back-btn" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Назад
        </button>
        <div className="detail-empty">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>👤</div>
          <h2>{error || 'Исполнитель не найден'}</h2>
          <button className="btn btn--secondary mt-md" onClick={() => navigate('/')}>
            На главную
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="detail-page artist-page-container page-enter page-enter-active"
      style={{
        '--artist-glow-rgb': monetTheme.glowRgb,
        '--artist-secondary-rgb': monetTheme.secondaryRgb,
        '--artist-accent-color': monetTheme.accentColor,
      } as React.CSSProperties}
    >
      {/* Back button */}
      <button className="detail-back-btn" onClick={() => navigate(-1)} title="Вернуться назад">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Назад
      </button>

      {/* ─── Hero Section: 3-Column Layout ──────────────────────────────────── */}
      <div className="artist-hero-grid">
        {/* Left Column: Info & Actions */}
        <div className="artist-hero__left">
          <div>
            <div className="artist-hero__badge">Артист</div>
            <h1 className="artist-hero__title">{artist.title}</h1>

            <div className="artist-hero__meta">
              {artist.genres.length > 0 &&
                artist.genres.map((g) => (
                  <span key={g.id} className="artist-hero__genre-tag">
                    #{g.rname || g.name}
                  </span>
                ))}
              {artist.likesCount != null && (
                <span className="artist-hero__followers">
                  {formatFollowersCount(artist.likesCount)}
                </span>
              )}
            </div>

            {artist.description && (
              <div className="artist-hero__bio">
                <p className={`artist-hero__bio-text ${bioExpanded ? 'artist-hero__bio-text--expanded' : ''}`}>
                  {artist.description}
                  {artist.description.length > 140 && (
                    <button
                      type="button"
                      className="artist-hero__bio-toggle"
                      onClick={() => setBioExpanded((v) => !v)}
                    >
                      {bioExpanded ? 'Свернуть' : 'Развернуть'}
                    </button>
                  )}
                </p>
              </div>
            )}
          </div>

          <div className="artist-hero__actions">
            {/* White pill "Слушать" */}
            <button
              className="artist-hero__play-btn"
              onClick={handlePlayPopular}
              disabled={popularTracks.length === 0}
              title={isCurrentArtistPlaying ? 'Приостановить' : 'Воспроизвести популярные'}
            >
              {isCurrentArtistPlaying ? (
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

            {/* Dark pill "Подписаны" / "Подписаться" */}
            <button
              className={`artist-hero__subscribe-btn ${isFollowed ? 'artist-hero__subscribe-btn--active' : ''}`}
              onClick={handleToggleSubscribe}
              title={isFollowed ? 'Отписаться от исполнителя' : 'Подписаться на исполнителя'}
            >
              <HeartIcon filled={isFollowed} size={18} />
              <span>{isFollowed ? 'Подписаны' : 'Подписаться'}</span>
            </button>

            {/* Shuffle Icon button */}
            <button
              className="artist-hero__shuffle-btn"
              onClick={handleShufflePlay}
              disabled={popularTracks.length === 0}
              title="Перемешать популярные"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 3H21V8" />
                <path d="M4 20L21 3" />
                <path d="M21 16V21H16" />
                <path d="M15 15L21 21" />
                <path d="M4 4L9 9" />
              </svg>
            </button>
          </div>
        </div>

        {/* Middle Column: Top Album Card */}
        {topAlbum && (
          <div
            className="artist-top-album-card"
            onClick={() => navigate(`/album/${topAlbum.id}`)}
          >
            <LikeButton
              className="artist-top-album-card__like-btn"
              isLiked={isAlbumLiked(topAlbum.id)}
              onToggle={() => toggleLikeAlbum(topAlbum.id)}
              title={isAlbumLiked(topAlbum.id) ? 'Удалить альбом из любимых' : 'Добавить альбом в любимое'}
              size={18}
            />

            <div className="artist-top-album-card__label">ТОП АЛЬБОМ</div>
            <div className="artist-top-album-card__title" title={topAlbum.title}>
              {topAlbum.title}
            </div>

            <div className="artist-top-album-card__cover">
              {topAlbum.coverUrl ? (
                <img src={topAlbum.coverUrl} alt={topAlbum.title} />
              ) : (
                <div className="artist-top-album-card__fallback">💿</div>
              )}
              <button
                className="card__play-btn card__play-overlay"
                title="Воспроизвести альбом"
                onClick={(e) => handlePlayRelease(e, topAlbum)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Right Column: Avatar Photo with Audio-Reactive Glow Behind It */}
        <div className="artist-hero__avatar-col">
          {/* Volumetric glow in the color of the avatar */}
          <div
            className={`artist-avatar-glow ${isArtistInCurrentTrack ? 'artist-avatar-glow--reactive' : ''}`}
            aria-hidden="true"
          >
            <div className="artist-avatar-glow__outer" />
            <div className="artist-avatar-glow__inner" />
          </div>

          {/* Rounded rectangular photo */}
          <div className="artist-hero__avatar-frame">
            {artist.imageUrl ? (
              <img
                src={artist.imageUrl}
                alt={artist.title}
                className="artist-hero__avatar-img"
              />
            ) : (
              <div className="artist-hero__avatar-fallback">👤</div>
            )}
          </div>
        </div>
      </div>

      {/* ─── "Поток по артисту" Banner ──────────────────────────────────────── */}
      <div
        className={`artist-flow-banner ${isCurrentArtistWavePlaying ? 'artist-flow-banner--playing' : ''}`}
        onClick={handleStartArtistRadio}
        title={isCurrentArtistWavePlaying ? 'Приостановить поток' : `Запустить поток по артисту: ${artist.title}`}
      >
        {/* Audio-reactive glow along the bottom of the card when flow is playing */}
        <div className="artist-flow-banner__bottom-glow" aria-hidden="true" />

        <div className="artist-flow-banner__content">
          <div className="artist-flow-banner__covers">
            {flowCovers.length > 2 && (
              <div
                className="artist-flow-banner__cover artist-flow-banner__cover--back"
                style={{ backgroundImage: `url(${flowCovers[2]})` }}
              />
            )}
            {flowCovers.length > 1 && (
              <div
                className="artist-flow-banner__cover artist-flow-banner__cover--mid"
                style={{ backgroundImage: `url(${flowCovers[1]})` }}
              />
            )}
            <div
              className="artist-flow-banner__cover artist-flow-banner__cover--front"
              style={{ backgroundImage: `url(${flowCovers[0] || artist.imageUrl || ''})` }}
            >
              {radioLoading && <div className="artist-flow-banner__spinner" />}
            </div>
          </div>

          <div className="artist-flow-banner__info">
            <div className="artist-flow-banner__title">Поток по артисту</div>
            <div className="artist-flow-banner__subtitle">
              {artist.title} и другие похожие артисты
            </div>
          </div>

          {/* Right Action / Status badge */}
          <div className="artist-flow-banner__action">
            {isCurrentArtistWavePlaying ? (
              <div className="artist-flow-banner__badge artist-flow-banner__badge--playing">
                <div className="equalizer-indicator">
                  <span />
                  <span />
                  <span />
                </div>
                <span>Играет поток</span>
              </div>
            ) : (
              <div className="artist-flow-banner__badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5V19L19 12L8 5Z" />
                </svg>
                <span>Включить поток</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── "Популярные треки" 2-Column Grid ────────────────────────────────── */}
      {popularTracks.length > 0 && (
        <section className="mb-xl">
          <div className="artist-section-title">
            <span>Популярные треки</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18L15 12L9 6" />
            </svg>
          </div>

          <div className="artist-popular-columns">
            {/* Column 1 (Left 6 tracks) */}
            <div className="artist-popular-col">
              {leftTracks.map((track, colIdx) => {
                const globalIndex = colIdx;
                const isCurrent = currentTrack?.id === track.id;
                const isHovered = hoveredTrackIndex === globalIndex;
                const trackLiked = isLiked(track.id);

                return (
                  <div
                    key={`${track.id}-${globalIndex}`}
                    className={`artist-track-row ${isCurrent ? 'artist-track-row--active' : ''}`}
                    onMouseEnter={() => setHoveredTrackIndex(globalIndex)}
                    onMouseLeave={() => setHoveredTrackIndex(null)}
                    onClick={() => handleTrackClick(globalIndex)}
                  >
                    <div className="artist-track-num">
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
                        <span>{globalIndex + 1}</span>
                      )}
                    </div>

                    {track.cover_url && (
                      <img
                        src={track.cover_url}
                        alt={track.title}
                        className="artist-track-cover"
                      />
                    )}

                    <div className="artist-track-info">
                      <div className="artist-track-title">
                        <span className={isCurrent ? 'text-accent' : ''}>
                          {track.title}
                        </span>
                        {track.is_explicit && (
                          <span className="track-badge-e" title="Explicit">E</span>
                        )}
                        {track.has_flac && (
                          <span className="track-badge-hifi" title="HiFi Audio">HiFi</span>
                        )}
                      </div>
                      <div className="artist-track-artist">
                        <ArtistLinks
                          artists={track.artists}
                          artistId={track.artist_id}
                          artistName={track.artist}
                        />
                      </div>
                    </div>

                    <div className="artist-track-actions">
                      <LikeButton
                        isLiked={trackLiked}
                        onToggle={() => toggleLikeTrack(track.id)}
                        size={15}
                      />
                    </div>

                    <div className="artist-track-duration">
                      {formatTime(track.duration)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Column 2 (Right 6 tracks) */}
            {rightTracks.length > 0 && (
              <div className="artist-popular-col">
                {rightTracks.map((track, colIdx) => {
                  const globalIndex = leftTracks.length + colIdx;
                  const isCurrent = currentTrack?.id === track.id;
                  const isHovered = hoveredTrackIndex === globalIndex;
                  const trackLiked = isLiked(track.id);

                  return (
                    <div
                      key={`${track.id}-${globalIndex}`}
                      className={`artist-track-row ${isCurrent ? 'artist-track-row--active' : ''}`}
                      onMouseEnter={() => setHoveredTrackIndex(globalIndex)}
                      onMouseLeave={() => setHoveredTrackIndex(null)}
                      onClick={() => handleTrackClick(globalIndex)}
                    >
                      <div className="artist-track-num">
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
                          <span>{globalIndex + 1}</span>
                        )}
                      </div>

                      {track.cover_url && (
                        <img
                          src={track.cover_url}
                          alt={track.title}
                          className="artist-track-cover"
                        />
                      )}

                      <div className="artist-track-info">
                        <div className="artist-track-title">
                          <span className={isCurrent ? 'text-accent' : ''}>
                            {track.title}
                          </span>
                          {track.is_explicit && (
                            <span className="track-badge-e" title="Explicit">E</span>
                          )}
                          {track.has_flac && (
                            <span className="track-badge-hifi" title="HiFi Audio">HiFi</span>
                          )}
                        </div>
                        <div className="artist-track-artist">
                          <ArtistLinks
                            artists={track.artists}
                            artistId={track.artist_id}
                            artistName={track.artist}
                          />
                        </div>
                      </div>

                      <div className="artist-track-actions">
                        <LikeButton
                          isLiked={trackLiked}
                          onToggle={() => toggleLikeTrack(track.id)}
                          size={15}
                        />
                      </div>

                      <div className="artist-track-duration">
                        {formatTime(track.duration)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── Discography / Releases ─────────────────────────────────────────── */}
      {artist.releases && artist.releases.length > 0 && (
        <section className="mb-lg">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>Дискография</h3>
            <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
              <button
                className={`tabs__tab ${releaseFilter === 'all' ? 'tabs__tab--active' : ''}`}
                onClick={() => setReleaseFilter('all')}
              >
                Все
              </button>
              <button
                className={`tabs__tab ${releaseFilter === 'album' ? 'tabs__tab--active' : ''}`}
                onClick={() => setReleaseFilter('album')}
              >
                Альбомы
              </button>
              <button
                className={`tabs__tab ${releaseFilter === 'single' ? 'tabs__tab--active' : ''}`}
                onClick={() => setReleaseFilter('single')}
              >
                Синглы и EP
              </button>
            </div>
          </div>

          <div className="card-grid">
            {filteredReleases.map((release) => {
              const releaseYear = release.date ? release.date.slice(0, 4) : null;

              return (
                <div
                  key={release.id}
                  className="card"
                  onClick={() => navigate(`/album/${release.id}`)}
                >
                  <div className="card__cover">
                    {release.coverUrl ? (
                      <img
                        src={release.coverUrl}
                        alt={release.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          background: 'var(--bg-card-hover)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        💿
                      </div>
                    )}
                    <button
                      className="card__play-btn card__play-overlay"
                      title="Воспроизвести"
                      onClick={(e) => handlePlayRelease(e, release)}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  </div>

                  <div className="card__title" title={release.title}>
                    {release.title}
                  </div>

                  <div className="card__subtitle" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {release.explicit && (
                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: 700,
                          padding: '1px 3px',
                          borderRadius: '2px',
                          background: 'rgba(255,255,255,0.15)',
                          color: 'var(--text-muted)',
                          lineHeight: 1,
                        }}
                      >
                        E
                      </span>
                    )}
                    <span>
                      {releaseYear ? `${releaseYear} · ` : ''}
                      {release.releaseType === 'single' ? 'Сингл' : 'Альбом'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── Related Artists ────────────────────────────────────────────────── */}
      {artist.relatedArtists && artist.relatedArtists.length > 0 && (
        <section className="mb-lg">
          <h3 className="mb-md">Похожие исполнители</h3>
          <div className="card-grid">
            {artist.relatedArtists.map((rel) => (
              <div
                key={rel.id}
                className="card"
                style={{ textAlign: 'center' }}
                onClick={() => navigate(`/artist/${rel.id}`)}
              >
                <div
                  className="card__cover"
                  style={{
                    borderRadius: '50%',
                    overflow: 'hidden',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                  }}
                >
                  {rel.imageUrl ? (
                    <img
                      src={rel.imageUrl}
                      alt={rel.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        background: 'var(--bg-card-hover)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '32px',
                      }}
                    >
                      👤
                    </div>
                  )}
                </div>
                <div className="card__title" style={{ marginTop: '8px' }}>
                  {rel.title}
                </div>
                <div className="card__subtitle">Исполнитель</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
