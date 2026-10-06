import { useEffect, useState, useRef } from 'react';
import { usePlayerStore } from '../../player/playerStore';
import {
  getLikedTracks,
  getEditorialPlaylists,
  getPlaylist,
  getAlbum,
  getMusicRecommendations,
  getListeningHistory,
  type Track,
  type Playlist,
  type MusicRecommendationItem,
  type ListeningHistoryItem,
} from '../../../api';
import { useNavigate } from 'react-router-dom';
import { SilaZvukaHero } from './SilaZvukaHero';
import { pluralizeTracks, formatRelativeTime } from '../../../lib/formatters';
import { ArtistLinks } from '../../../components/ArtistLinks';


export function HomePage() {
  const { setQueue } = usePlayerStore();
  const navigate = useNavigate();

  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [likedCount, setLikedCount] = useState<number>(0);
  const [editorialPlaylists, setEditorialPlaylists] = useState<Playlist[]>([]);
  const [recommendations, setRecommendations] = useState<MusicRecommendationItem[]>([]);
  const [showAllRecs, setShowAllRecs] = useState<boolean>(false);
  const [historyItems, setHistoryItems] = useState<ListeningHistoryItem[]>([]);
  const [showAllHistory, setShowAllHistory] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [gridColumns, setGridColumns] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const estimatedWidth = Math.max(300, window.innerWidth - 304);
      return Math.max(1, Math.floor((estimatedWidth + 20) / (180 + 20)));
    }
    return 5;
  });

  useEffect(() => {
    const el = gridContainerRef.current;
    if (!el) return;

    const calcCols = (width: number) => {
      if (width <= 0) return;
      const count = Math.max(1, Math.floor((width + 20) / (180 + 20)));
      setGridColumns((prev) => (prev !== count ? count : prev));
    };

    calcCols(el.clientWidth);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        calcCols(entry.contentRect.width);
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let isSubscribed = true;

    async function loadHomeData() {
      try {
        setLoading(true);
        const [likedRes, editorialRes, recRes, historyRes] = await Promise.allSettled([
          getLikedTracks(0, 10),
          getEditorialPlaylists(),
          getMusicRecommendations(30, 0),
          getListeningHistory(30, 0),
        ]);

        if (!isSubscribed) return;

        if (likedRes.status === 'fulfilled' && likedRes.value) {
          setLikedTracks(likedRes.value.items || []);
          setLikedCount(likedRes.value.total ?? (likedRes.value.items?.length || 0));
        }
        if (editorialRes.status === 'fulfilled' && Array.isArray(editorialRes.value)) {
          setEditorialPlaylists(editorialRes.value);
        }
        if (recRes.status === 'fulfilled' && Array.isArray(recRes.value)) {
          const nonNull = recRes.value.filter((item) => {
            if (item.itemType === 'Playlist') {
              return (item.trackCount ?? 0) > 0;
            }
            return true;
          });
          setRecommendations(nonNull);
        }
        if (historyRes.status === 'fulfilled' && Array.isArray(historyRes.value)) {
          const seen = new Set<number>();
          const uniqueHistory = historyRes.value.filter((item) => {
            if (seen.has(item.track.id)) return false;
            seen.add(item.track.id);
            return true;
          });
          setHistoryItems(uniqueHistory);
        }
      } catch (err) {
        console.error('[HomePage] Failed to load home data:', err);
      } finally {
        if (isSubscribed) setLoading(false);
      }
    }

    loadHomeData();

    return () => {
      isSubscribed = false;
    };
  }, []);

  const handlePlayLiked = () => {
    if (likedTracks.length > 0) {
      setQueue(likedTracks, 0);
    } else {
      navigate('/favourites');
    }
  };

  const handleTrackClick = (_track: Track, tracksList: Track[], index: number) => {
    setQueue(tracksList, index);
  };

  const handlePlayHistory = (_item: ListeningHistoryItem, index: number) => {
    const tracks = historyItems.map((h) => h.track);
    setQueue(tracks, index);
  };

  const handlePlayPlaylist = async (e: React.MouseEvent, playlist: Playlist) => {
    e.stopPropagation();
    try {
      const full = await getPlaylist(playlist.id);
      if (full?.tracks && full.tracks.length > 0) {
        setQueue(full.tracks, 0);
      }
    } catch (err) {
      console.error('[HomePage] Failed to play playlist:', err);
    }
  };

  const handleRecommendationClick = (item: MusicRecommendationItem) => {
    switch (item.itemType) {
      case 'Playlist':
        navigate(`/playlist/${item.id}`);
        break;
      case 'Release':
        navigate(`/album/${item.id}`);
        break;
      case 'Artist':
        navigate(`/artist/${item.id}`);
        break;
      case 'FavoriteTracks':
        navigate('/favourites');
        break;
      case 'PersonalWave':
        navigate('/sound-energy');
        break;
      default:
        break;
    }
  };

  const handlePlayRecommendation = async (e: React.MouseEvent, item: MusicRecommendationItem) => {
    e.stopPropagation();
    try {
      if (item.itemType === 'Playlist') {
        const full = await getPlaylist(Number(item.id));
        if (full?.tracks && full.tracks.length > 0) {
          setQueue(full.tracks, 0);
        }
      } else if (item.itemType === 'Release') {
        const full = await getAlbum(Number(item.id));
        if (full?.tracks && full.tracks.length > 0) {
          setQueue(full.tracks, 0);
        }
      } else if (item.itemType === 'FavoriteTracks') {
        handlePlayLiked();
      } else if (item.itemType === 'PersonalWave') {
        navigate('/sound-energy');
      } else if (item.itemType === 'Artist') {
        navigate(`/artist/${item.id}`);
      }
    } catch (err) {
      console.error('[HomePage] Failed to play recommendation item:', err);
    }
  };


  return (
    <div className="page-enter page-enter-active">
      {/* Integrated Interface Stage: Мой персональный поток with dynamic #70dc55 glow */}
      <SilaZvukaHero />

      <div ref={gridContainerRef} style={{ position: 'relative', zIndex: 2 }}>
        {/* Quick Access */}
        <section className="mb-lg">
        <h3 className="mb-md">Быстрый доступ</h3>
        <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', width: '100%' }}>
          <QuickCard
            title="Любимые треки"
            subtitle={likedCount > 0 ? pluralizeTracks(likedCount) : 'Ваша коллекция'}
            gradient="linear-gradient(135deg, rgba(239, 68, 68, 0.85) 0%, rgba(185, 28, 28, 0.95) 100%)"
            onClick={handlePlayLiked}
            icon={
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                <path d="M16 26C16 26 5 20 5 12C5 8 8 5 12 5C14 5 16 6 16 6C16 6 18 5 20 5C24 5 27 8 27 12C27 20 16 26 16 26Z" fill="white" fillOpacity="0.95"/>
              </svg>
            }
          />
          <QuickCard
            title="Мои плейлисты"
            subtitle="Созданные и сохранённые"
            gradient="linear-gradient(135deg, rgba(112, 220, 85, 0.3) 0%, rgba(185, 28, 28, 0) 100%), linear-gradient(135deg, rgba(112, 220, 85, 0.3) 0%, rgba(18, 50, 16, 0.8) 100%)"
            onClick={() => navigate('/playlists')}
            icon={
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                <path d="M6 8H22M6 14H18M6 20H14" stroke="#70dc55" strokeWidth="2.5" strokeLinecap="round"/>
                <circle cx="24" cy="22" r="4" stroke="#70dc55" strokeWidth="2"/>
                <path d="M28 10V22" stroke="#70dc55" strokeWidth="2"/>
              </svg>
            }
          />
          <QuickCard
            title="Коллекция"
            subtitle="Альбомы, треки и исполнители"
            gradient="linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%)"
            onClick={() => navigate('/library')}
            icon={
              <svg width="28" height="28" viewBox="0 0 20 20" fill="none">
                <path
                  fill="white"
                  fillOpacity="0.9"
                  d="M4.583 1.667H3.75a.417.417 0 0 0-.417.416v15.834c0 .23.187.416.417.416h.833c.23 0 .417-.186.417-.416V2.083a.417.417 0 0 0-.417-.416m3.75 0H7.5a.417.417 0 0 0-.417.416v15.834c0 .23.187.416.417.416h.833c.23 0 .417-.186.417-.416V2.083a.417.417 0 0 0-.417-.416m3.75 0h-.833a.417.417 0 0 0-.417.416v15.834c0 .23.187.416.417.416h.833c.23 0 .417-.186.417-.416V2.083a.417.417 0 0 0-.417-.416m3.547.054-.82.145a.417.417 0 0 0-.339.482l2.75 15.593c.04.227.256.378.482.338l.821-.145a.417.417 0 0 0 .338-.482l-2.75-15.593a.417.417 0 0 0-.482-.338"
                />
              </svg>
            }
          />
        </div>
      </section>

      {/* История прослушиваний */}
      {(loading || historyItems.length > 0) && (
        <section className="mb-lg">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>История прослушиваний</h3>
            {historyItems.length > gridColumns && (
              <button
                className="btn btn--ghost"
                style={{ fontSize: '13px', color: 'var(--accent)' }}
                onClick={() => setShowAllHistory((prev) => !prev)}
              >
                {showAllHistory ? 'Свернуть' : `Показать все (${historyItems.length}) →`}
              </button>
            )}
          </div>

          <div className="card-grid">
            {loading ? (
              Array.from({ length: gridColumns }).map((_, i) => (
                <div key={i} className="card">
                  <div className="card__cover">
                    <div className="skeleton" style={{ width: '100%', height: '100%' }} />
                  </div>
                  <div className="skeleton" style={{ width: '80%', height: '14px', marginBottom: '6px' }} />
                  <div className="skeleton" style={{ width: '60%', height: '12px' }} />
                </div>
              ))
            ) : (
              (showAllHistory ? historyItems : historyItems.slice(0, gridColumns)).map((item, idx) => (
                <div
                  key={`${item.track.id}-${item.last_listening_dttm || idx}`}
                  className="card"
                  onClick={() => handlePlayHistory(item, idx)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="card__cover">
                    {item.track.cover_url ? (
                      <img
                        src={item.track.cover_url}
                        alt={item.track.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                        }}
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
                          color: 'var(--text-muted)',
                        }}
                      >
                        🎵
                      </div>
                    )}
                    <button className="card__play-btn card__play-overlay" title="Воспроизвести">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  </div>
                  <div className="card__title" title={item.track.title}>
                    {item.track.title}
                  </div>
                  <div className="card__subtitle">
                    <ArtistLinks
                      artists={item.track.artists}
                      artistId={item.track.artist_id}
                      artistName={item.track.artist}
                    />
                  </div>
                  {item.last_listening_dttm && (
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        marginTop: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        opacity: 0.85,
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 6v6l4 2" />
                      </svg>
                      <span>{formatRelativeTime(item.last_listening_dttm)}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Рекомендуем послушать */}
      {(loading || recommendations.length > 0) && (
        <section className="mb-lg">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>Рекомендуем послушать</h3>
            {recommendations.length > gridColumns && (
              <button
                className="btn btn--ghost"
                style={{ fontSize: '13px', color: 'var(--accent)' }}
                onClick={() => setShowAllRecs((prev) => !prev)}
              >
                {showAllRecs ? 'Свернуть' : `Показать все (${recommendations.length}) →`}
              </button>
            )}
          </div>

          <div className="card-grid">
            {loading ? (
              Array.from({ length: gridColumns }).map((_, i) => (
                <div key={i} className="card">
                  <div className="card__cover">
                    <div className="skeleton" style={{ width: '100%', height: '100%' }} />
                  </div>
                  <div className="skeleton" style={{ width: '80%', height: '14px', marginBottom: '6px' }} />
                  <div className="skeleton" style={{ width: '60%', height: '12px' }} />
                </div>
              ))
            ) : (
              (showAllRecs ? recommendations : recommendations.slice(0, gridColumns)).map((item) => (
                <div
                  key={`${item.itemType}-${item.id}`}
                  className="card"
                  onClick={() => handleRecommendationClick(item)}
                  style={{ position: 'relative' }}
                >
                  <div
                    className="card__cover"
                    style={
                      item.itemType === 'Artist'
                        ? { borderRadius: '50%', overflow: 'hidden' }
                        : undefined
                    }
                  >
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          background:
                            item.itemType === 'FavoriteTracks'
                              ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.85), rgba(185, 28, 28, 0.95))'
                              : item.itemType === 'PersonalWave'
                              ? 'linear-gradient(135deg, rgba(112, 220, 85, 0.4), rgba(18, 50, 16, 0.9))'
                              : 'var(--bg-card-hover)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '28px',
                        }}
                      >
                        {item.itemType === 'Artist'
                          ? '👤'
                          : item.itemType === 'FavoriteTracks'
                          ? '❤️'
                          : item.itemType === 'PersonalWave'
                          ? '⚡'
                          : item.itemType === 'Release'
                          ? '💿'
                          : '🎶'}
                      </div>
                    )}

                    <button
                      className="card__play-btn card__play-overlay"
                      title={
                        item.itemType === 'Artist'
                          ? 'Перейти к исполнителю'
                          : 'Воспроизвести'
                      }
                      onClick={(e) => handlePlayRecommendation(e, item)}
                    >
                      {item.itemType === 'Artist' ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                  </div>

                  <div className="card__title" title={item.title}>
                    {item.title}
                  </div>

                  <div
                    className="card__subtitle"
                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    {item.explicit && (
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
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.subtitle ||
                        (item.itemType === 'Playlist'
                          ? 'Плейлист'
                          : item.itemType === 'Release'
                          ? 'Альбом'
                          : item.itemType === 'Artist'
                          ? 'Исполнитель'
                          : '')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Editorial Playlists & Charts */}

      {(loading || editorialPlaylists.length > 0) && (
        <section className="mb-lg">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>Популярные плейлисты Звука</h3>
            <button
              className="btn btn--ghost"
              style={{ fontSize: '13px', color: 'var(--accent)' }}
              onClick={() => navigate('/playlists')}
            >
              Смотреть все →
            </button>
          </div>

          <div className="card-grid">
            {loading ? (
              Array.from({ length: gridColumns }).map((_, i) => (
                <div key={i} className="card">
                  <div className="card__cover">
                    <div className="skeleton" style={{ width: '100%', height: '100%' }} />
                  </div>
                  <div className="skeleton" style={{ width: '80%', height: '14px', marginBottom: '6px' }} />
                  <div className="skeleton" style={{ width: '60%', height: '12px' }} />
                </div>
              ))
            ) : (
              editorialPlaylists.slice(0, gridColumns).map((pl) => (
                <div key={pl.id} className="card" onClick={() => navigate(`/playlist/${pl.id}`)}>
                  <div className="card__cover">
                    {pl.cover_url ? (
                      <img src={pl.cover_url} alt={pl.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', background: 'var(--bg-card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        🎶
                      </div>
                    )}
                    <button
                      className="card__play-btn card__play-overlay"
                      title="Воспроизвести"
                      onClick={(e) => handlePlayPlaylist(e, pl)}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  </div>
                  <div className="card__title">{pl.title}</div>
                  <div className="card__subtitle">{pl.description || `${pl.track_count || ''} треков`}</div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Liked / Recent Tracks */}
      {likedTracks.length > 0 && (
        <section className="mb-lg">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>Мои любимые треки</h3>
            <button
              className="btn btn--ghost"
              style={{ fontSize: '13px', color: 'var(--accent)' }}
              onClick={() => navigate('/favourites')}
            >
              Все любимые →
            </button>
          </div>

          <div className="card-grid">
            {likedTracks.slice(0, gridColumns).map((track, idx) => (
              <div key={track.id} className="card" onClick={() => handleTrackClick(track, likedTracks, idx)}>
                <div className="card__cover">
                  {track.cover_url ? (
                    <img src={track.cover_url} alt={track.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'var(--bg-card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      ❤️
                    </div>
                  )}
                  <button className="card__play-btn card__play-overlay" title="Воспроизвести">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </button>
                </div>
                <div className="card__title">{track.title}</div>
                <div className="card__subtitle">
                  <ArtistLinks
                    artists={track.artists}
                    artistId={track.artist_id}
                    artistName={track.artist}
                  />
                </div>
              </div>

            ))}
          </div>
        </section>
      )}
      </div>
    </div>
  );
}

function QuickCard({
  title,
  subtitle,
  gradient,
  icon,
  onClick,
}: {
  title: string;
  subtitle: string;
  gradient: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  const pad = 16;
  const iconRadius = 12;
  const outerRadius = iconRadius + pad; // 28px: outer r = inner r + padding

  return (
    <div
      className="card"
      onClick={onClick}
      style={{
        background: gradient,
        padding: `${pad}px`,
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        cursor: 'pointer',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
        borderRadius: `${outerRadius}px`,
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div
        style={{
          width: '46px',
          height: '46px',
          borderRadius: `${iconRadius}px`,
          background: 'rgba(255, 255, 255, 0.12)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}
