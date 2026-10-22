import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getPlaylist, getTracksByIds, type Playlist, type Track } from '../../../api';
import { usePlayerStore } from '../../player/playerStore';
import { useFavouritesStore } from '../../favourites/favouritesStore';
import { ArtistLinks } from '../../../components/ArtistLinks';
import { LikeButton } from '../../../components/LikeButton';
import { ShareIcon } from '../../../components/ShareIcon';
import { showToast } from '../../../components/Toast';
import { EditPlaylistModal } from './EditPlaylistModal';
import { PlaylistCover } from './PlaylistCover';
import { usePlaylistModalStore } from '../playlistModalStore';
import { useAuthStore } from '../../auth/authStore';


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

export function PlaylistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMoreTracks, setLoadingMoreTracks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);

  const tracksSentinelRef = useRef<HTMLDivElement | null>(null);
  const playlistStateRef = useRef({ loading: false, offset: 0, hasNext: false });

  const { currentTrack, isPlaying, setQueue, togglePlay } = usePlayerStore();
  const { isLiked, toggleLikeTrack } = useFavouritesStore();
  const currentUser = useAuthStore((s) => s.user);
  const checkIsOwner = usePlaylistModalStore((s) => s.checkIsOwner);

  const isOwner = checkIsOwner(playlist, currentUser?.id);

  useEffect(() => {
    let isSubscribed = true;
    if (!id) return;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        setPlaylistTracks([]);
        playlistStateRef.current = { loading: false, offset: 0, hasNext: false };
        const data = await getPlaylist(Number(id));
        if (isSubscribed) {
          setPlaylist(data);
          const initialTracks = data.tracks || [];
          setPlaylistTracks(initialTracks);
          const allIds = data.track_ids || [];
          const initialOffset = Math.min(50, allIds.length);
          const hasMore = allIds.length > initialOffset;
          playlistStateRef.current = {
            loading: false,
            offset: initialOffset,
            hasNext: hasMore,
          };
        }
      } catch (err: any) {
        console.error('[PlaylistDetailPage] Failed to load playlist:', err);
        if (isSubscribed) {
          setError(err?.message || 'Не удалось загрузить плейлист');
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

  const loadMorePlaylistTracks = useCallback(async () => {
    if (!playlist?.track_ids || playlistStateRef.current.loading || !playlistStateRef.current.hasNext) return;
    playlistStateRef.current.loading = true;
    setLoadingMoreTracks(true);
    try {
      const allIds = playlist.track_ids;
      const currentOffset = playlistStateRef.current.offset;
      const nextSlice = allIds.slice(currentOffset, currentOffset + 50);
      if (nextSlice.length > 0) {
        const newTracks = await getTracksByIds(nextSlice);
        if (newTracks && newTracks.length > 0) {
          setPlaylistTracks((prev) => {
            const existingIds = new Set(prev.map((t) => t.id));
            const unique = newTracks.filter((t) => !existingIds.has(t.id));
            return [...prev, ...unique];
          });
          const nextOffset = currentOffset + nextSlice.length;
          const hasNext = nextOffset < allIds.length;
          playlistStateRef.current.offset = nextOffset;
          playlistStateRef.current.hasNext = hasNext;

          // If currently playing this playlist, append to player queue
          const { queueContext, appendToQueue } = usePlayerStore.getState();
          if (queueContext?.type === 'playlist' && String(queueContext.id) === String(playlist.id)) {
            appendToQueue(newTracks);
          }
        }
      } else {
        playlistStateRef.current.hasNext = false;
      }
    } catch (err) {
      console.error('[PlaylistDetailPage] Failed to load more tracks:', err);
    } finally {
      playlistStateRef.current.loading = false;
      setLoadingMoreTracks(false);
    }
  }, [playlist?.track_ids, playlist?.id]);

  // Sentinel observer for infinite scrolling of tracks
  useEffect(() => {
    const el = tracksSentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          playlistStateRef.current.hasNext &&
          !playlistStateRef.current.loading
        ) {
          loadMorePlaylistTracks();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [playlistTracks.length, loadMorePlaylistTracks]);

  // Synchronize playlistTracks if player loads more tracks in background
  const queue = usePlayerStore((s) => s.queue);
  const queueContext = usePlayerStore((s) => s.queueContext);

  useEffect(() => {
    if (
      queueContext?.type === 'playlist' &&
      String(queueContext.id) === String(playlist?.id) &&
      queue.length > playlistTracks.length
    ) {
      setPlaylistTracks((prev) => {
        const existingIds = new Set(prev.map((t) => String(t.id)));
        const newTracks = queue.filter((t) => !existingIds.has(String(t.id)));
        if (newTracks.length === 0) return prev;
        const next = [...prev, ...newTracks];
        if (typeof queueContext.offset === 'number' && queueContext.offset > playlistStateRef.current.offset) {
          playlistStateRef.current.offset = queueContext.offset;
          playlistStateRef.current.hasNext = (playlist?.track_ids?.length || 0) > queueContext.offset;
        }
        return next;
      });
    }
  }, [queue, queueContext, playlist?.id, playlist?.track_ids?.length, playlistTracks.length]);

  const tracks = playlistTracks;
  const isCurrentPlaylistPlaying =
    isPlaying && tracks.some((t) => t.id === currentTrack?.id);

  const handlePlayAll = () => {
    if (tracks.length === 0) return;
    if (isCurrentPlaylistPlaying) {
      togglePlay();
      return;
    }
    const allIds = playlist?.track_ids ? playlist.track_ids.map(String) : [];
    const currentOffset = playlistStateRef.current.offset;
    setQueue(tracks, 0, {
      type: 'playlist',
      id: String(playlist?.id),
      allTrackIds: allIds,
      offset: currentOffset,
      hasNext: allIds.length > currentOffset,
      total: playlist?.track_count ?? allIds.length,
    });
  };

  const handleTrackClick = (index: number) => {
    if (tracks.length === 0) return;
    if (currentTrack?.id === tracks[index].id) {
      togglePlay();
      return;
    }
    const allIds = playlist?.track_ids ? playlist.track_ids.map(String) : [];
    const currentOffset = playlistStateRef.current.offset;
    setQueue(tracks, index, {
      type: 'playlist',
      id: String(playlist?.id),
      allTrackIds: allIds,
      offset: currentOffset,
      hasNext: allIds.length > currentOffset,
      total: playlist?.track_count ?? allIds.length,
    });
  };

  const handleShufflePlay = () => {
    if (tracks.length === 0) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    const allIds = playlist?.track_ids ? playlist.track_ids.map(String) : [];
    const currentOffset = playlistStateRef.current.offset;
    setQueue(shuffled, 0, {
      type: 'playlist',
      id: String(playlist?.id),
      allTrackIds: allIds,
      offset: currentOffset,
      hasNext: allIds.length > currentOffset,
      total: playlist?.track_count ?? allIds.length,
    });
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
            <div className="skeleton" style={{ width: '90px', height: '22px', borderRadius: '12px', marginBottom: '12px' }} />
            <div className="skeleton" style={{ width: '60%', height: '36px', marginBottom: '16px' }} />
            <div className="skeleton" style={{ width: '40%', height: '16px', marginBottom: '24px' }} />
            <div className="skeleton" style={{ width: '130px', height: '48px', borderRadius: '24px' }} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="detail-page page-enter page-enter-active">
        <button className="detail-back-btn" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Назад
        </button>
        <div className="detail-empty">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2>{error || 'Плейлист не найден'}</h2>
          <button className="btn btn--secondary mt-md" onClick={() => navigate('/playlists')}>
            Ко всем плейлистам
          </button>
        </div>
      </div>
    );
  }

  const totalDuration = tracks.reduce((acc, t) => acc + (t.duration || 0), 0) || playlist.duration;

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
        {(() => {
          const backdrop = tracks[0]?.cover_url || playlist.cover_url || (playlist.cover_urls && playlist.cover_urls[0]);
          return backdrop ? (
            <div
              className="detail-hero__backdrop"
              style={{ backgroundImage: `url(${backdrop})` }}
            />
          ) : null;
        })()}
        <div className="detail-hero__cover">
          <PlaylistCover playlist={playlist} tracks={tracks} />
        </div>

        <div className="detail-hero__info">
          <span className="detail-badge">ПЛЕЙЛИСТ</span>
          <h1 className="detail-hero__title">{playlist.title}</h1>
          {playlist.description && (
            <p className="detail-hero__desc">{playlist.description}</p>
          )}

          <div className="detail-hero__meta">
            <span className="detail-hero__author">
              {playlist.owner ? `Автор: ${playlist.owner}` : 'Редакция Звука'}
            </span>
            <span className="detail-hero__dot">·</span>
            <span>{tracks.length} треков</span>
            {totalDuration > 0 && (
              <>
                <span className="detail-hero__dot">·</span>
                <span>{formatDuration(totalDuration)}</span>
              </>
            )}
            {typeof playlist.is_public === 'boolean' && (
              <>
                <span className="detail-hero__dot">·</span>
                <span
                  className={`detail-publicity-tag ${playlist.is_public ? 'detail-publicity-tag--public' : 'detail-publicity-tag--private'}`}
                  title={playlist.is_public ? 'Публичный плейлист: доступен всем' : 'Приватный плейлист: доступен только вам'}
                >
                  {playlist.is_public ? '🌐 Публичный' : '🔒 Приватный'}
                </span>
              </>
            )}
          </div>

          <div className="detail-hero__actions">
            <button
              className="detail-play-btn"
              onClick={handlePlayAll}
              disabled={tracks.length === 0}
              title={isCurrentPlaylistPlaying ? 'Приостановить' : 'Воспроизвести все'}
            >
              {isCurrentPlaylistPlaying ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5V19L19 12L8 5Z" />
                </svg>
              )}
              {isCurrentPlaylistPlaying ? 'Пауза' : 'Слушать'}
            </button>

            <button
              className="detail-action-btn"
              onClick={handleShufflePlay}
              disabled={tracks.length === 0}
              title="Перемешать и воспроизвести"
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
              className="detail-action-btn"
              onClick={() => {
                navigator.clipboard.writeText(`https://zvuk.com/playlist/${playlist.id}`);
                showToast('Ссылка на плейлист скопирована', 'success');
              }}
              title="Поделиться плейлистом"
            >
              <ShareIcon size={18} />
            </button>

            {isOwner && (
              <button
                className="detail-action-btn"
                onClick={() => setIsEditModalOpen(true)}
                title="Редактировать плейлист (название, порядок треков)"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tracks Section */}
      <div className="detail-tracks-section">
        {isOwner && tracks.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setIsEditModalOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '13px',
                padding: '6px 14px',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Изменить порядок треков
            </button>
          </div>
        )}
        {tracks.length === 0 ? (
          <div className="detail-empty">
            <p>В этом плейлисте пока нет треков</p>
          </div>
        ) : (
          <div className="detail-table">
            <div className="detail-table__head">
              <div className="detail-table__th detail-table__col-num">#</div>
              <div className="detail-table__th detail-table__col-title">Название</div>
              <div className="detail-table__th detail-table__col-album">Альбом</div>
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
                        {track.cover_url ? (
                          <img
                            src={track.cover_url}
                            alt={track.title}
                            className="detail-track-thumb"
                          />
                        ) : (
                          <div className="detail-track-thumb detail-track-thumb--empty">♫</div>
                        )}
                        <div className="detail-track-names">
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

                    <div className="detail-table__col-album">
                      {track.album_id ? (
                        <span
                          className="detail-album-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/album/${track.album_id}`);
                          }}
                        >
                          {track.album || '—'}
                        </span>
                      ) : (
                        <span>{track.album || '—'}</span>
                      )}
                    </div>

                    <div className="detail-table__col-actions">
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
              {/* Sentinel for infinite scroll / pagination */}
              <div ref={tracksSentinelRef} style={{ height: '20px' }} />
              {loadingMoreTracks && (
                <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  Загрузка треков...
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {playlist && (
        <EditPlaylistModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          playlist={playlist}
          initialTracks={tracks}
          onSaveSuccess={(updatedName, updatedTracks, isPublic) => {
            setPlaylist((prev) =>
              prev
                ? {
                    ...prev,
                    title: updatedName,
                    is_public: isPublic,
                    tracks: updatedTracks,
                    cover_urls: updatedTracks
                      .slice(0, 4)
                      .map((t) => t.cover_url)
                      .filter((u): u is string => Boolean(u)),
                    cover_url: updatedTracks[0]?.cover_url ?? prev.cover_url,
                  }
                : null
            );
            setPlaylistTracks(updatedTracks);
          }}
        />
      )}
    </div>
  );
}
