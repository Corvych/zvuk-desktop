import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getLikedTracks, getLikedAlbums, getPersonalWave, getTracksByIds, type Track, type Album } from '../../../api';
import { usePlayerStore } from '../../player/playerStore';
import { useFavouritesStore } from '../favouritesStore';
import { formatTime, pluralizeTracks } from '../../../lib/formatters';
import { ArtistLinks } from '../../../components/ArtistLinks';
import { extractMonetFromImage, extractMonetThemeFromPalette, type MonetTheme } from '../../../lib/monetPalette';
import { useAudioReactive } from '../../player/useAudioReactive';
import { LikeButton } from '../../../components/LikeButton';
import { CrystalIcon } from '../../../components/CrystalIcon';
import { usePlaylistModalStore } from '../../playlists/playlistModalStore';
import { showToast } from '../../../components/Toast';

type Tab = 'tracks' | 'albums';

const PAGE_SIZE = 50;

function formatTrackCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M треков`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K треков`;
  }
  return pluralizeTracks(count);
}

export function FavouritesPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // Keep audio reactive CSS variables active for backdrop & flow glow
  useAudioReactive();

  const [activeTab, setActiveTab] = useState<Tab>('tracks');
  const [hoveredTrackIndex, setHoveredTrackIndex] = useState<number | null>(null);
  const [waveLoading, setWaveLoading] = useState(false);
  const [flowLoading, setFlowLoading] = useState(false);
  const [favoriteFlowTracks, setFavoriteFlowTracks] = useState<Track[]>([]);
  const flowRequestRef = useRef<Promise<Track[]> | null>(null);
  const [flowTheme, setFlowTheme] = useState<MonetTheme | null>(null);
  const [backdropTheme, setBackdropTheme] = useState<MonetTheme>(() =>
    extractMonetThemeFromPalette('#a88cf8 #7e6cf0 #d2b6ff')
  );

  const isLiked = useFavouritesStore((s) => s.isLiked);
  const toggleLikeTrack = useFavouritesStore((s) => s.toggleLikeTrack);
  const likedTrackIds = useFavouritesStore((s) => s.likedTrackIds);
  const prevLikedTrackIdsRef = useRef<Set<number>>(new Set());

  // ── Tracks state ──────────────────────────────────────────────────────────
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [tracksTotal, setTracksTotal] = useState<number | null>(null);
  const [, setTracksOffset] = useState(0);
  const [tracksHasNext, setTracksHasNext] = useState(true);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksInitialized, setTracksInitialized] = useState(false);

  // ── Albums state ──────────────────────────────────────────────────────────
  const [likedAlbums, setLikedAlbums] = useState<Album[]>([]);
  const [albumsTotal, setAlbumsTotal] = useState<number | null>(null);
  const [, setAlbumsOffset] = useState(0);
  const [, setAlbumsHasNext] = useState(true);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsInitialized, setAlbumsInitialized] = useState(false);

  // ── Sentinel refs (for IntersectionObserver) ──────────────────────────────
  const tracksSentinelRef = useRef<HTMLDivElement | null>(null);
  const albumsSentinelRef = useRef<HTMLDivElement | null>(null);

  const tracksStateRef = useRef({ loading: false, hasNext: true, offset: 0 });
  const albumsStateRef = useRef({ loading: false, hasNext: true, offset: 0 });

  const {
    setQueue,
    currentTrack,
    isPlaying,
    togglePlay,
    startWave,
    setWaveMood,
    isWaveMode,
    waveMood,
    startTrackRadio,
  } = usePlayerStore();

  const isFavoriteWaveActive = isWaveMode && waveMood?.discovery === 'favorite';
  const isFavoriteWavePlaying = isFavoriteWaveActive && isPlaying;
  const isLikedTracksPlaying =
    isPlaying && !isWaveMode && likedTracks.some((t) => t.id === currentTrack?.id);

  // ── Load next page of tracks ──────────────────────────────────────────────
  const loadMoreTracks = useCallback(async (offset: number) => {
    if (tracksStateRef.current.loading) return;
    tracksStateRef.current.loading = true;
    setTracksLoading(true);
    try {
      const res = await getLikedTracks(offset, PAGE_SIZE);
      if (res?.items) {
        setLikedTracks((prev) => {
          if (offset === 0) return res.items;
          const existingIds = new Set(prev.map((t) => t.id));
          const unique = res.items.filter((t) => !existingIds.has(t.id));
          return [...prev, ...unique];
        });
        if (typeof res.total === 'number') {
          setTracksTotal(res.total);
        }
        const nextOffset = offset + PAGE_SIZE;
        setTracksOffset(nextOffset);
        setTracksHasNext(res.has_next);
        tracksStateRef.current.hasNext = res.has_next;
        tracksStateRef.current.offset = nextOffset;

        // If player is playing from favourites, append new tracks to its queue
        const { queueContext, appendToQueue } = usePlayerStore.getState();
        if (queueContext?.type === 'favourites') {
          appendToQueue(res.items);
        }
      }
    } catch (err) {
      console.error('[Favourites] Error loading liked tracks:', err);
    } finally {
      tracksStateRef.current.loading = false;
      setTracksLoading(false);
      setTracksInitialized(true);
      // Seed the "previous" snapshot so that the first run of the like-sync
      // effect doesn't treat all existing liked IDs as newly added.
      prevLikedTrackIdsRef.current = new Set(
        useFavouritesStore.getState().likedTrackIds
      );
    }
  }, []);

  // ── Load next page of albums ──────────────────────────────────────────────
  const loadMoreAlbums = useCallback(async (offset: number) => {
    if (albumsStateRef.current.loading) return;
    albumsStateRef.current.loading = true;
    setAlbumsLoading(true);
    try {
      const res = await getLikedAlbums(offset, PAGE_SIZE);
      if (res?.items) {
        setLikedAlbums((prev) => {
          if (offset === 0) return res.items;
          const existingIds = new Set(prev.map((a) => a.id));
          const unique = res.items.filter((a) => !existingIds.has(a.id));
          return [...prev, ...unique];
        });
        if (typeof res.total === 'number') {
          setAlbumsTotal(res.total);
        }
        const nextOffset = offset + PAGE_SIZE;
        setAlbumsOffset(nextOffset);
        setAlbumsHasNext(res.has_next);
        albumsStateRef.current.hasNext = res.has_next;
        albumsStateRef.current.offset = nextOffset;
      }
    } catch (err) {
      console.error('[Favourites] Error loading liked albums:', err);
    } finally {
      albumsStateRef.current.loading = false;
      setAlbumsLoading(false);
      setAlbumsInitialized(true);
    }
  }, []);

  // ── Initial load when tab becomes active ─────────────────────────────────
  useEffect(() => {
    if (activeTab === 'tracks' && !tracksInitialized) {
      loadMoreTracks(0);
    }
  }, [activeTab, tracksInitialized, loadMoreTracks]);

  useEffect(() => {
    if (activeTab === 'albums' && !albumsInitialized) {
      loadMoreAlbums(0);
    }
  }, [activeTab, albumsInitialized, loadMoreAlbums]);

  // ── IntersectionObserver for tracks sentinel ──────────────────────────────
  useEffect(() => {
    const el = tracksSentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          tracksStateRef.current.hasNext &&
          !tracksStateRef.current.loading
        ) {
          loadMoreTracks(tracksStateRef.current.offset);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [likedTracks.length, loadMoreTracks]);

  // ── IntersectionObserver for albums sentinel ──────────────────────────────
  useEffect(() => {
    const el = albumsSentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          albumsStateRef.current.hasNext &&
          !albumsStateRef.current.loading
        ) {
          loadMoreAlbums(albumsStateRef.current.offset);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [likedAlbums.length, loadMoreAlbums]);

  // Synchronize likedTracks if player loaded more tracks in background
  const queue = usePlayerStore((s) => s.queue);
  const queueContext = usePlayerStore((s) => s.queueContext);

  useEffect(() => {
    if (queueContext?.type === 'favourites' && queue.length > likedTracks.length) {
      setLikedTracks((prev) => {
        const existingIds = new Set(prev.map((t) => String(t.id)));
        const newTracks = queue.filter((t) => !existingIds.has(String(t.id)));
        if (newTracks.length === 0) return prev;
        const next = [...prev, ...newTracks];
        if (typeof queueContext.offset === 'number' && queueContext.offset > tracksStateRef.current.offset) {
          tracksStateRef.current.offset = queueContext.offset;
          setTracksOffset(queueContext.offset);
        }
        return next;
      });
    }
  }, [queue, queueContext, likedTracks.length]);

  // ── React to like/unlike changes from the store ───────────────────────────
  useEffect(() => {
    if (!tracksInitialized) return;

    const prev = prevLikedTrackIdsRef.current;
    const curr = likedTrackIds;

    // Find newly liked tracks (added to curr but not in prev)
    const addedIds: number[] = [];
    curr.forEach((id) => {
      if (!prev.has(id)) addedIds.push(id);
    });

    // Find newly unliked tracks (removed from curr)
    const removedIds: number[] = [];
    prev.forEach((id) => {
      if (!curr.has(id)) removedIds.push(id);
    });

    if (removedIds.length > 0) {
      setLikedTracks((prevTracks) => prevTracks.filter((t) => !removedIds.includes(Number(t.id))));
      setTracksTotal((prevTotal) => (prevTotal !== null ? Math.max(0, prevTotal - removedIds.length) : null));
    }

    if (addedIds.length > 0) {
      // Load full track objects for newly liked tracks and prepend them to the list
      getTracksByIds(addedIds)
        .then((tracks) => {
          if (tracks && tracks.length > 0) {
            setLikedTracks((prevTracks) => {
              const existingIds = new Set(prevTracks.map((t) => Number(t.id)));
              const newTracks = tracks.filter((t) => !existingIds.has(Number(t.id)));
              if (newTracks.length === 0) return prevTracks;
              return [...newTracks, ...prevTracks];
            });
          }
        })
        .catch((err) => {
          console.error('[FavouritesPage] Failed to load newly liked tracks:', err);
        });
      // Update counter optimistically
      setTracksTotal((prevTotal) => (prevTotal !== null ? prevTotal + addedIds.length : null));
    }

    prevLikedTrackIdsRef.current = new Set(curr);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [likedTrackIds]);

  const handleTrackClick = (track: Track, idx: number) => {
    if (currentTrack?.id === track.id) {
      togglePlay();
    } else {
      const currentOffset = tracksStateRef.current.offset;
      const hasNext = tracksStateRef.current.hasNext || (tracksTotal ? currentOffset < tracksTotal : false);
      setQueue(likedTracks, idx, {
        type: 'favourites',
        offset: currentOffset,
        hasNext,
        total: tracksTotal ?? undefined,
      });
    }
  };

  const handlePlayAll = () => {
    if (likedTracks.length === 0) return;
    if (isLikedTracksPlaying) {
      togglePlay();
      return;
    }
    const currentOffset = tracksStateRef.current.offset;
    const hasNext = tracksStateRef.current.hasNext || (tracksTotal ? currentOffset < tracksTotal : false);
    setQueue(likedTracks, 0, {
      type: 'favourites',
      offset: currentOffset,
      hasNext,
      total: tracksTotal ?? undefined,
    });
  };

  const handleShufflePlay = () => {
    if (likedTracks.length === 0) return;
    const shuffled = [...likedTracks].sort(() => Math.random() - 0.5);
    const currentOffset = tracksStateRef.current.offset;
    const hasNext = tracksStateRef.current.hasNext || (tracksTotal ? currentOffset < tracksTotal : false);
    setQueue(shuffled, 0, {
      type: 'favourites',
      offset: currentOffset,
      hasNext,
      total: tracksTotal ?? undefined,
    });
  };

  const loadFavoriteFlow = useCallback(() => {
    setFlowLoading(true);
    const promise = getPersonalWave(null, 25, null, 'AMAZME', 'FAVTRACKS')
      .then((tracks) => {
        if (tracks && tracks.length > 0) {
          setFavoriteFlowTracks(tracks);
        }
        return tracks || [];
      })
      .catch((err) => {
        console.error('[Favourites] Error fetching favorite flow tracks:', err);
        return [];
      })
      .finally(() => {
        setFlowLoading(false);
      });

    flowRequestRef.current = promise;
    return promise;
  }, []);

  // Fetch a fresh favorite wave flow on every visit/entry to the Favourites page
  useEffect(() => {
    loadFavoriteFlow();
  }, [location.key, loadFavoriteFlow]);

  const handleStartFavoriteWave = async () => {
    if (isFavoriteWavePlaying) {
      togglePlay();
      return;
    }
    if (isFavoriteWaveActive) {
      togglePlay();
      return;
    }

    setWaveMood({
      activeRgb: backdropTheme?.glowRgb || flowTheme?.glowRgb || '152, 175, 244',
      dominantEmotions: [],
      pad: { x: 0, y: 0 },
      discovery: 'favorite',
      popularity: null,
      language: null,
    });

    if (favoriteFlowTracks.length > 0) {
      startWave(favoriteFlowTracks);
      return;
    }

    try {
      setWaveLoading(true);
      let tracks = flowRequestRef.current ? await flowRequestRef.current : null;
      if (!tracks || tracks.length === 0) {
        tracks = await getPersonalWave(null, 25, null, 'AMAZME', 'FAVTRACKS');
        if (tracks && tracks.length > 0) {
          setFavoriteFlowTracks(tracks);
        }
      }
      if (tracks && tracks.length > 0) {
        startWave(tracks);
      } else if (likedTracks.length > 0) {
        const shuffled = [...likedTracks].sort(() => Math.random() - 0.5);
        startWave(shuffled);
      }
    } catch (err) {
      console.error('[Favourites] Failed to start favorite wave:', err);
      if (likedTracks.length > 0) {
        const shuffled = [...likedTracks].sort(() => Math.random() - 0.5);
        startWave(shuffled);
      }
    } finally {
      setWaveLoading(false);
    }
  };

  // Stack of 3 covers for the middle flow card (prioritizing favorite flow tracks)
  const flowCovers = useMemo(() => {
    const sourceTracks = favoriteFlowTracks.length > 0 ? favoriteFlowTracks : likedTracks;
    const covers: string[] = [];
    for (const t of sourceTracks) {
      if (t.cover_url && !covers.includes(t.cover_url)) {
        covers.push(t.cover_url);
        if (covers.length >= 3) break;
      }
    }
    return covers;
  }, [favoriteFlowTracks, likedTracks]);

  const flowSubtitle = useMemo(() => {
    const sourceTracks = favoriteFlowTracks.length > 0 ? favoriteFlowTracks : likedTracks;
    const artists = Array.from(
      new Set(sourceTracks.slice(0, 5).map((t) => t.artist).filter(Boolean))
    ).slice(0, 2);
    return artists.length > 0
      ? `${artists.join(', ')} и другие похожие артисты`
      : 'Ваша любимая музыка и похожие треки';
  }, [favoriteFlowTracks, likedTracks]);

  // Extract Monet theme from Favourites cover artwork for frameless hero backdrop
  useEffect(() => {
    extractMonetFromImage('/favourites_album_cover.jpg').then(setBackdropTheme);
  }, []);

  // Synchronize backdrop palette with root document for sidebar & titlebar glow bleed
  useEffect(() => {
    if (!backdropTheme) return;
    const root = document.documentElement;
    root.style.setProperty('--artist-glow-rgb', backdropTheme.glowRgb);
    root.style.setProperty('--artist-secondary-rgb', backdropTheme.secondaryRgb);
    root.style.setProperty('--artist-tertiary-rgb', backdropTheme.tertiaryRgb);

    return () => {
      root.style.removeProperty('--artist-glow-rgb');
      root.style.removeProperty('--artist-secondary-rgb');
      root.style.removeProperty('--artist-tertiary-rgb');
    };
  }, [backdropTheme]);

  // Extract color theme from the cover of the first track in favorite flow (or liked tracks)
  useEffect(() => {
    const flowTrack = favoriteFlowTracks[0];
    const sourceTrack = flowTrack || likedTracks[0];
    if (!sourceTrack) return;
    extractMonetFromImage(sourceTrack.cover_url, sourceTrack.palette).then(setFlowTheme);
  }, [favoriteFlowTracks, likedTracks]);

  const isInitialLoading =
    activeTab === 'tracks'
      ? !tracksInitialized && tracksLoading
      : !albumsInitialized && albumsLoading;

  return (
    <div
      className="detail-page artist-page-container page-enter page-enter-active"
      style={{
        '--artist-glow-rgb': backdropTheme.glowRgb,
        '--artist-secondary-rgb': backdropTheme.secondaryRgb,
        '--artist-tertiary-rgb': backdropTheme.tertiaryRgb,
        '--artist-gradient': backdropTheme.gradient,
        '--artist-accent-color': backdropTheme.accentColor,
        '--accent': backdropTheme.accentColor,
        '--accent-light': backdropTheme.accentColor,
        '--accent-muted': `rgba(${backdropTheme.glowRgb}, 0.15)`,
        '--accent-glow': `rgba(${backdropTheme.glowRgb}, 0.45)`,
      } as React.CSSProperties}
    >
      {/* ─── Favourites Backdrop Artwork (Frameless Right-Flank Background Bleed with Vignette) ─── */}
      <div className="artist-backdrop favorites-backdrop" aria-hidden="true">
        <div
          className={`artist-backdrop__glow ${(isLikedTracksPlaying || isFavoriteWavePlaying) ? 'artist-backdrop__glow--reactive' : ''}`}
        >
          <div className="artist-backdrop__glow-outer" />
          <div className="artist-backdrop__glow-chromatic">
            <img
              src="/favourites_album_cover.jpg"
              alt=""
              className="artist-backdrop__glow-chromatic-img favorites-backdrop__chromatic-img"
            />
          </div>
          <div className="artist-backdrop__glow-rim" />
          <div className="artist-backdrop__glow-inner" />
        </div>

        <div className="artist-backdrop__photo-wrap">
          <img
            src="/favourites_album_cover.jpg"
            alt=""
            className="artist-backdrop__img favorites-backdrop__img"
          />
          <div className="artist-backdrop__vignette" />
        </div>
      </div>

      {/* ─── Hero Section (Mirrors Artist Detail Header) ─────────────────────── */}
      <div className="artist-hero-grid favorites-hero-grid--artist">
        {/* Left Column: Info & Actions */}
        <div className="artist-hero__left">
          <div>
            <div className="artist-hero__badge">Плейлист</div>
            <h1 className="artist-hero__title">Любимое</h1>

            <div className="artist-hero__meta">
              <span className="artist-hero__followers">
                {tracksTotal !== null && tracksTotal > 0
                  ? formatTrackCount(tracksTotal)
                  : '0 треков'}
              </span>
            </div>

            <div className="artist-hero__bio">
              <p className="artist-hero__bio-text artist-hero__bio-text--expanded">
                Включай, когда нужно доказать, что у тебя отличный музыкальный вкус.
              </p>
            </div>
          </div>

          <div className="artist-hero__actions">
            <button
              className="artist-hero__play-btn"
              onClick={handlePlayAll}
              disabled={likedTracks.length === 0}
              title={isLikedTracksPlaying ? 'Приостановить' : 'Слушать любимые треки'}
            >
              {isLikedTracksPlaying ? (
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
              disabled={likedTracks.length === 0}
              title="Перемешать"
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
      </div>

      {/* ─── "Поток по любимому" Banner ─────────────────────────────────────── */}
      <div
        className={`artist-flow-banner ${isFavoriteWavePlaying ? 'artist-flow-banner--playing' : ''}`}
        style={
          flowTheme
            ? ({
                '--artist-glow-rgb': flowTheme.glowRgb,
                '--artist-secondary-rgb': flowTheme.secondaryRgb,
                '--artist-accent-color': flowTheme.accentColor,
              } as React.CSSProperties)
            : undefined
        }
        onClick={handleStartFavoriteWave}
        title={isFavoriteWavePlaying ? 'Приостановить поток' : 'Запустить поток по любимому'}
      >
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
              style={{ backgroundImage: `url(${flowCovers[0] || '/favourites_album_cover.jpg'})` }}
            >
              {(waveLoading || (flowLoading && favoriteFlowTracks.length === 0)) && (
                <div className="artist-flow-banner__spinner" />
              )}
            </div>
          </div>

          <div className="artist-flow-banner__info">
            <div className="artist-flow-banner__title">Поток по любимому</div>
            <div className="artist-flow-banner__subtitle">{flowSubtitle}</div>
          </div>

          <div className="artist-flow-banner__action">
            {isFavoriteWavePlaying ? (
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

      {/* ─── Switcher Tabs (Tracks / Albums) ─────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
          <button
            className={`tabs__tab ${activeTab === 'tracks' ? 'tabs__tab--active' : ''}`}
            onClick={() => setActiveTab('tracks')}
          >
            Треки {tracksTotal !== null ? `(${tracksTotal})` : ''}
          </button>
          <button
            className={`tabs__tab ${activeTab === 'albums' ? 'tabs__tab--active' : ''}`}
            onClick={() => setActiveTab('albums')}
          >
            Альбомы {albumsTotal !== null ? `(${albumsTotal})` : ''}
          </button>
        </div>
      </div>

      {/* ─── Main Content ───────────────────────────────────────────────────── */}
      {isInitialLoading ? (
        <div className="track-list">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="track-item">
              <span className="track-item__number">{i + 1}</span>
              <div className="track-item__info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    className="skeleton"
                    style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-sm)', flexShrink: 0 }}
                  />
                  <div>
                    <div className="skeleton" style={{ width: '160px', height: '14px', marginBottom: '4px' }} />
                    <div className="skeleton" style={{ width: '100px', height: '12px' }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : activeTab === 'tracks' ? (
        likedTracks.length > 0 ? (
          <>
            <div className="favorites-table">
              {/* Header row */}
              <div className="favorites-table__head">
                <div className="favorites-table__col-num">#</div>
                <div className="favorites-table__col-title">Название</div>
                <div className="favorites-table__col-album">Альбом</div>
                <div className="favorites-table__col-time">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
              </div>

              {/* Tracks List */}
              {likedTracks.map((track, idx) => {
                const isCurrent = currentTrack?.id === track.id;
                const isHovered = hoveredTrackIndex === idx;
                const trackLiked = isLiked(track.id);

                return (
                  <div
                    key={`${track.id}-${idx}`}
                    className={`favorites-table__row ${isCurrent ? 'favorites-table__row--active' : ''}`}
                    onMouseEnter={() => setHoveredTrackIndex(idx)}
                    onMouseLeave={() => setHoveredTrackIndex(null)}
                    onClick={() => handleTrackClick(track, idx)}
                  >
                    <div className="favorites-table__col-num">
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
                        <span>{idx + 1}</span>
                      )}
                    </div>

                    <div className="favorites-table__col-title" style={{ display: 'flex', alignItems: 'center' }}>
                      {track.cover_url ? (
                        <img
                          src={track.cover_url}
                          alt={track.title}
                          className="favorites-table__cover"
                        />
                      ) : (
                        <div
                          className="favorites-table__cover"
                          style={{
                            background: 'var(--bg-card-hover)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '18px',
                          }}
                        >
                          🎵
                        </div>
                      )}

                      <div className="favorites-table__info">
                        <div className="favorites-table__track-title">
                          <span className={isCurrent ? 'text-accent' : ''}>
                            {track.title}
                          </span>
                          {track.is_explicit && (
                            <span className="track-badge-e" title="Explicit">E</span>
                          )}
                          {track.has_flac && (
                            <span className="track-badge-hifi" title="HiFi Audio (Lossless)"><CrystalIcon size={13} /></span>
                          )}
                        </div>
                        <div className="favorites-table__track-artists">
                          <ArtistLinks
                            artists={track.artists}
                            artistId={track.artist_id}
                            artistName={track.artist}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="favorites-table__col-album" title={track.album || ''}>
                      {track.album_id ? (
                        <span
                          className="artist-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/album/${track.album_id}`);
                          }}
                        >
                          {track.album || '—'}
                        </span>
                      ) : (
                        track.album || '—'
                      )}
                    </div>

                    <div className="favorites-table__col-time">
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
                      <LikeButton
                        isLiked={trackLiked}
                        onToggle={() => toggleLikeTrack(track.id)}
                        size={15}
                      />
                      <span>{formatTime(track.duration)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Infinite scroll sentinel */}
            <div ref={tracksSentinelRef} style={{ height: '1px' }} />

            {tracksLoading && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    border: '2px solid var(--border)',
                    borderTopColor: 'var(--accent)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
              </div>
            )}
            {!tracksHasNext && likedTracks.length > PAGE_SIZE && (
              <p style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)', padding: '24px 0' }}>
                Все треки загружены · {likedTracks.length}
              </p>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', marginTop: '40px' }}>
            У вас пока нет любимых треков
          </p>
        )
      ) : likedAlbums.length > 0 ? (
        <>
          <div className="card-grid">
            {likedAlbums.map((album) => (
              <div
                key={album.id}
                className="card"
                onClick={() => navigate(`/album/${album.id}`)}
              >
                <div className="card__cover">
                  {album.cover_url ? (
                    <img
                      src={album.cover_url}
                      alt={album.title}
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
                </div>

                <div className="card__title" title={album.title}>
                  {album.title}
                </div>
                <div className="card__subtitle">{album.artist}</div>
              </div>
            ))}
          </div>

          <div ref={albumsSentinelRef} style={{ height: '1px' }} />
        </>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', marginTop: '40px' }}>
          У вас пока нет сохранённых альбомов
        </p>
      )}
    </div>
  );
}
