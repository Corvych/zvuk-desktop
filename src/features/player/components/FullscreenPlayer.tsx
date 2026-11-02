import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { usePlayerStore } from '../playerStore';
import { useFavouritesStore } from '../../favourites/favouritesStore';
import { formatTime } from '../../../lib/formatters';
import { extractMonetFromImage, extractMonetThemeFromPalette } from '../../../lib/monetPalette';
import { LikeButton } from '../../../components/LikeButton';
import { DislikeButton } from '../../../components/DislikeButton';
import { DislikeIcon } from '../../../components/DislikeIcon';
import { useDislikesStore } from '../../dislikes/dislikesStore';
import { ShareIcon } from '../../../components/ShareIcon';
import { ArtistLinks } from '../../../components/ArtistLinks';
import { showToast } from '../../../components/Toast';
import { getOrCreateAudio } from '../audioService';
import {
  fetchUnifiedLyrics,
  probeAllSources,
  getCachedUnifiedLyrics,
  getCachedProbeResults,
  type ResolvedLyrics,
  type SourceAvailability,
} from '../lyricsService';
import { useLyricsSettingsStore } from '../../settings/lyricsSettingsStore';
import { useVolumeWheel } from '../useVolumeWheel';
import { usePlaylistModalStore } from '../../playlists/playlistModalStore';
import { getCoverUrl } from '../../../api';
import { FluidBackdropVisualizer, type BackdropMode } from './FluidBackdropVisualizer';
import { useWindowFreezeStore, getIsWindowFrozen } from '../../../lib/windowFreezeStore';
import { getAudioQualityDetails } from '../../../lib/audioQuality';
import { CrystalIcon } from '../../../components/CrystalIcon';
import { parseLyrics } from '../lyricsParser';
import { InstrumentalBreakIndicator } from './InstrumentalBreakIndicator';
import {
  useFullscreenSettingsStore,
  detectScreenResolution,
  SCALE_OPTIONS,
} from '../fullscreenSettingsStore';

// ─── Dashed Tick Ruler Progress Bar ──────────────────────────────────────────
interface AudioRulerTrackProps {
  progress: number;
  duration: number;
  onSeek: (seconds: number) => void;
}

const AudioRulerTrack: React.FC<AudioRulerTrackProps> = ({ progress, duration, onSeek }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState<number | null>(null);

  const displayProgress = dragTime !== null ? dragTime : progress;
  const ratio = duration > 0 ? Math.min(1, Math.max(0, displayProgress / duration)) : 0;
  const remaining = Math.max(0, duration - displayProgress);

  const calculateTimeFromEvent = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const el = containerRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const pos = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      return pos * duration;
    },
    [duration]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    const newTime = calculateTimeFromEvent(e);
    setDragTime(newTime);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const newTime = calculateTimeFromEvent(e);
    setDragTime(newTime);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const finalTime = calculateTimeFromEvent(e);
    setIsDragging(false);
    setDragTime(null);
    onSeek(finalTime);
  };

  return (
    <div className="fullscreen-ruler">
      <div
        ref={containerRef}
        className="fullscreen-ruler__track-area"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title="Перемотка"
      >
        {/* Background inactive ticks */}
        <div className="fullscreen-ruler__ticks fullscreen-ruler__ticks--bg" />
        {/* Active filled ticks with mask / width clip */}
        <div
          className="fullscreen-ruler__ticks-fill"
          style={{ width: `${(ratio * 100).toFixed(2)}%` }}
        >
          <div className="fullscreen-ruler__ticks fullscreen-ruler__ticks--active" />
        </div>
      </div>

      <div className="fullscreen-ruler__timestamps">
        <span>{formatTime(displayProgress)}</span>
        <span>-{formatTime(remaining)}</span>
      </div>
    </div>
  );
};

// ─── Main Fullscreen Player Component ─────────────────────────────────────────
export function FullscreenPlayer() {
  const {
    currentTrack,
    isPlaying,
    progress,
    duration,
    volume,
    isMuted,
    shuffle,
    repeat,
    quality,
    queue,
    queueIndex,
    isFullscreenPlayerOpen,
    fullscreenTab,
    togglePlay,
    nextTrack,
    previousTrack,
    seekTo,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    setQuality,
    closeFullscreenPlayer,
    setFullscreenTab,
    playQueueTrack,
    streamInfo,
  } = usePlayerStore();

  const audioDetails = useMemo(() => getAudioQualityDetails(streamInfo, quality), [streamInfo, quality]);

  const isLiked = useFavouritesStore((s) => s.isLiked(currentTrack?.id));
  const toggleLikeTrack = useFavouritesStore((s) => s.toggleLikeTrack);
  const isDisliked = useDislikesStore((s) => s.isDisliked(currentTrack?.id));
  const toggleDislikeTrack = useDislikesStore((s) => s.toggleDislikeTrack);
  const currentArtistId = currentTrack?.artist_id || currentTrack?.artists?.[0]?.id;
  const isArtistDisliked = useDislikesStore((s) => s.isArtistDisliked(currentArtistId));
  const toggleDislikeArtist = useDislikesStore((s) => s.toggleDislikeArtist);

  // Lyrics state
  const {
    enableZvuk,
    enableBetterLyrics,
    enableNetease,
    enableLrclib,
    preferWordSync,
    priority,
    timingOffset,
    adjustTimingOffset,
    resetTimingOffset,
  } = useLyricsSettingsStore();

  // Synchronous cache-first state initialization
  const [lyricsInfo, setLyricsInfo] = useState<ResolvedLyrics | null>(() => {
    return currentTrack ? (getCachedUnifiedLyrics(currentTrack.id, null) ?? null) : null;
  });
  const [lyricsLoading, setLyricsLoading] = useState(() => {
    if (!currentTrack) return false;
    return getCachedUnifiedLyrics(currentTrack.id, null) === undefined;
  });
  const [sourcesAvailability, setSourcesAvailability] = useState<Record<string, SourceAvailability>>(() => {
    return currentTrack ? (getCachedProbeResults(currentTrack.id) ?? {}) : {};
  });
  const [preferredSource, setPreferredSource] = useState<'zvuk' | 'betterlyrics' | 'netease' | 'lrclib' | null>(null);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const sourceMenuRef = useRef<HTMLDivElement>(null);

  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isUserScrollingRef = useRef(false);
  const userScrollTimeoutRef = useRef<number | null>(null);
  const [showSyncButton, setShowSyncButton] = useState(false);

  // Sub-second precision for ultra-smooth 60fps karaoke line progress
  const [smoothTime, setSmoothTime] = useState(progress);

  // Check cache and reset preferredSource when track changes
  useEffect(() => {
    setPreferredSource(null);
    if (!currentTrack) {
      setLyricsInfo(null);
      setLyricsLoading(false);
      setSourcesAvailability({});
      return;
    }

    const cachedProbes = getCachedProbeResults(currentTrack.id);
    if (cachedProbes) {
      setSourcesAvailability(cachedProbes);
    } else {
      setSourcesAvailability({});
    }

    const cachedLyrics = getCachedUnifiedLyrics(currentTrack.id, null);
    if (cachedLyrics !== undefined) {
      setLyricsInfo(cachedLyrics);
      setLyricsLoading(false);
    } else {
      setLyricsInfo(null);
      setLyricsLoading(true);
    }
  }, [currentTrack?.id]);

  // Probe all available sources for current track in background
  useEffect(() => {
    if (!currentTrack || !isFullscreenPlayerOpen) return;
    let isCancelled = false;

    // If already probed and cached, populate immediately without re-probing
    const cachedProbes = getCachedProbeResults(currentTrack.id);
    if (cachedProbes) {
      setSourcesAvailability(cachedProbes);
      return;
    }

    probeAllSources(currentTrack, (source, info) => {
      if (!isCancelled) {
        setSourcesAvailability((prev) => ({ ...prev, [source]: info }));
      }
    }).then((results) => {
      if (!isCancelled) {
        setSourcesAvailability(results);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [currentTrack?.id, isFullscreenPlayerOpen]);

  // Close source dropdown on click outside
  useEffect(() => {
    if (!sourceMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sourceMenuRef.current && !sourceMenuRef.current.contains(e.target as Node)) {
        setSourceMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sourceMenuOpen]);

  useEffect(() => {
    if (fullscreenTab !== 'lyrics' || !isPlaying) {
      setSmoothTime(progress);
      return;
    }
    let animId: number;
    let isRunning = true;

    const tick = () => {
      if (getIsWindowFrozen() || document.hidden) {
        isRunning = false;
        return;
      }
      const audio = getOrCreateAudio();
      if (audio && !audio.paused) {
        setSmoothTime(audio.currentTime);
      }

      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);

    const unsub = useWindowFreezeStore.subscribe((state, prev) => {
      if (!state.isFrozen && prev.isFrozen) {
        if (!isRunning) {
          isRunning = true;
          animId = requestAnimationFrame(tick);
        }
      }
    });

    return () => {
      unsub();
      cancelAnimationFrame(animId);
    };
  }, [fullscreenTab, isPlaying]);

  // More menu & sleep timer
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [isZenMode, setIsZenMode] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [isVisualizerMenuOpen, setIsVisualizerMenuOpen] = useState(false);
  const visualizerMenuRef = useRef<HTMLDivElement>(null);

  // Fullscreen responsive scale state
  const scale = useFullscreenSettingsStore((s) => s.scale);
  const setScale = useFullscreenSettingsStore((s) => s.setScale);
  const zoomIn = useFullscreenSettingsStore((s) => s.zoomIn);
  const zoomOut = useFullscreenSettingsStore((s) => s.zoomOut);
  const resetZoom = useFullscreenSettingsStore((s) => s.resetZoom);

  const [isScaleMenuOpen, setIsScaleMenuOpen] = useState(false);
  const scaleMenuRef = useRef<HTMLDivElement>(null);

  // Viewport dimensions for real-time resolution detection in UI
  const [windowDimensions, setWindowDimensions] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1920,
    height: typeof window !== 'undefined' ? window.innerHeight : 1080,
  }));

  useEffect(() => {
    const handleResize = () => {
      setWindowDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const detectedScreen = useMemo(
    () => detectScreenResolution(windowDimensions.width, windowDimensions.height),
    [windowDimensions.width, windowDimensions.height]
  );

  const [coverGlowRgb, setCoverGlowRgb] = useState<string>('80, 80, 95');
  const [coverSecondaryRgb, setCoverSecondaryRgb] = useState<string>('120, 60, 140');
  const [coverTertiaryRgb, setCoverTertiaryRgb] = useState<string>('50, 100, 160');
  const [coverGradient, setCoverGradient] = useState<string>('linear-gradient(135deg, rgb(80, 80, 95) 0%, rgb(120, 60, 140) 50%, rgb(50, 100, 160) 100%)');

  const [backdropMode, setBackdropMode] = useState<BackdropMode>(() => {
    const saved = localStorage.getItem('zvuk_fullscreen_backdrop_mode');
    if (saved === 'fluid' || saved === 'lava' || saved === 'off') {
      return saved;
    }
    const legacy = localStorage.getItem('zvuk_fullscreen_dynamic_backdrop');
    if (legacy === 'false') return 'off';
    return 'fluid';
  });

  const selectBackdropMode = useCallback((mode: BackdropMode) => {
    setBackdropMode(mode);
    localStorage.setItem('zvuk_fullscreen_backdrop_mode', mode);
    setIsVisualizerMenuOpen(false);
  }, []);

  const cycleBackdropMode = useCallback(() => {
    setBackdropMode((prev) => {
      const order: BackdropMode[] = ['fluid', 'lava', 'off'];
      const next = order[(order.indexOf(prev) + 1) % order.length];
      localStorage.setItem('zvuk_fullscreen_backdrop_mode', next);
      return next;
    });
  }, []);

  const backdropLabels: Record<BackdropMode, { full: string; short: string }> = {
    fluid: { full: 'Жидкий шёлк', short: 'ШЁЛК' },
    lava: { full: 'Лава-лампа', short: 'ЛАВА' },
    off: { full: 'Статический фон', short: 'СТАТИКА' },
  };

  const volumeControlRef = useVolumeWheel(isFullscreenPlayerOpen);

  // Close more menu, visualizer menu & scale menu when clicking outside
  useEffect(() => {
    if (!isMoreMenuOpen && !isVisualizerMenuOpen && !isScaleMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (isMoreMenuOpen && moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
      if (isVisualizerMenuOpen && visualizerMenuRef.current && !visualizerMenuRef.current.contains(e.target as Node)) {
        setIsVisualizerMenuOpen(false);
      }
      if (isScaleMenuOpen && scaleMenuRef.current && !scaleMenuRef.current.contains(e.target as Node)) {
        setIsScaleMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMoreMenuOpen, isVisualizerMenuOpen, isScaleMenuOpen]);

  // Extract Monet / ambient cover color
  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.palette) {
      const theme = extractMonetThemeFromPalette(currentTrack.palette);
      setCoverGlowRgb(theme.glowRgb);
      if (theme.secondaryRgb) setCoverSecondaryRgb(theme.secondaryRgb);
      if (theme.tertiaryRgb) setCoverTertiaryRgb(theme.tertiaryRgb);
      if (theme.gradient) setCoverGradient(theme.gradient);
    } else if (currentTrack.cover_url) {
      extractMonetFromImage(currentTrack.cover_url).then((theme) => {
        setCoverGlowRgb(theme.glowRgb);
        if (theme.secondaryRgb) setCoverSecondaryRgb(theme.secondaryRgb);
        if (theme.tertiaryRgb) setCoverTertiaryRgb(theme.tertiaryRgb);
        if (theme.gradient) setCoverGradient(theme.gradient);
      });
    }
  }, [currentTrack]);

  // Fetch unified lyrics (Zvuk + Better Lyrics + NetEase + LRCLIB)
  useEffect(() => {
    if (!currentTrack || !isFullscreenPlayerOpen) return;
    let isCancelled = false;

    // Check cache first: if already cached, use immediately and don't show loading spinner!
    const cached = getCachedUnifiedLyrics(currentTrack.id, preferredSource);
    if (cached !== undefined) {
      setLyricsInfo(cached);
      setLyricsLoading(false);
      return;
    }

    setLyricsLoading(true);
    fetchUnifiedLyrics(currentTrack, preferredSource ?? undefined)
      .then((data) => {
        if (!isCancelled) {
          setLyricsInfo(data);
          setLyricsLoading(false);
        }
      })
      .catch((err) => {
        console.error('[FullscreenPlayer] Failed to load unified lyrics:', err);
        if (!isCancelled) {
          setLyricsInfo(null);
          setLyricsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    currentTrack?.id,
    isFullscreenPlayerOpen,
    preferredSource,
    enableZvuk,
    enableBetterLyrics,
    enableNetease,
    enableLrclib,
    preferWordSync,
    priority,
  ]);

  // Available sources and provider options for HUD
  const allProviderOptions: {
    id: 'betterlyrics' | 'zvuk' | 'netease' | 'lrclib';
    name: string;
    desc: string;
  }[] = [
      { id: 'betterlyrics', name: 'Better Lyrics', desc: 'Словарная караоке-синхронизация (Apple Music / TTML)' },
      { id: 'zvuk', name: 'Звук Официальный', desc: 'Официальные студийные тексты' },
      { id: 'netease', name: 'NetEase Music', desc: 'Enhanced LRC / слоговая синхронизация' },
      { id: 'lrclib', name: 'LRCLIB', desc: 'Открытая база текстов и таймингов' },
    ];

  const availableSourcesWithText = useMemo(() => {
    return Object.values(sourcesAvailability).filter((s) => s.status === 'available').length;
  }, [sourcesAvailability]);

  const isAnySourceProbing = useMemo(() => {
    return Object.values(sourcesAvailability).some((s) => s.status === 'loading');
  }, [sourcesAvailability]);

  const getProviderStatus = (id: string) => {
    const probe = sourcesAvailability[id];
    if (!probe) return { text: '...', class: 'loading' };
    if (probe.status === 'loading') return { text: 'Поиск...', class: 'loading' };
    if (probe.status === 'available') {
      if (probe.hasWordSync) return { text: 'Karaoke', class: 'wordsync' };
      if (probe.isSynced) return { text: 'LRC', class: 'lrc' };
      return { text: 'TXT', class: 'txt' };
    }
    return { text: 'Нет текста', class: 'empty' };
  };

  // Parse lyrics
  const parsedLyrics = useMemo(() => {
    if (!lyricsInfo?.lyrics) return [];
    return parseLyrics(lyricsInfo.lyrics, !!lyricsInfo.is_synced);
  }, [lyricsInfo]);

  // Effective smooth time with user timing offset applied
  const effectiveSmoothTime = Math.max(0, smoothTime + timingOffset);

  // Find active synced lyric index using effectiveSmoothTime
  const activeLyricIndex = useMemo(() => {
    if (!lyricsInfo?.is_synced || parsedLyrics.length === 0) return -1;
    let activeIdx = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
      const lineTime = parsedLyrics[i].time;
      if (lineTime !== undefined && lineTime <= effectiveSmoothTime) {
        activeIdx = i;
      } else if (lineTime !== undefined && lineTime > effectiveSmoothTime) {
        break;
      }
    }
    return activeIdx;
  }, [lyricsInfo?.is_synced, parsedLyrics, effectiveSmoothTime]);

  const [syncButtonDirection, setSyncButtonDirection] = useState<'up' | 'down'>('up');

  // Helper to center any specific line by index
  const centerLine = useCallback((index: number, smooth = true) => {
    const container = lyricsContainerRef.current;
    if (!container || index < 0) return;
    const el = lineRefs.current[index];
    if (!el) return;

    const containerHeight = container.clientHeight;
    const elTop = el.offsetTop;
    const elHeight = el.clientHeight;
    const targetScroll = elTop - containerHeight / 2 + elHeight / 2;

    container.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  // Center currently active line
  const scrollToActiveLine = useCallback((smooth = true) => {
    if (activeLyricIndex >= 0) {
      centerLine(activeLyricIndex, smooth);
      setShowSyncButton(false);
    }
  }, [activeLyricIndex, centerLine]);

  // Check whether active line is currently in the visible area of the scroll container
  const checkActiveLineVisibility = useCallback(() => {
    const container = lyricsContainerRef.current;
    if (!container || activeLyricIndex < 0) {
      setShowSyncButton(false);
      return;
    }
    const activeEl = lineRefs.current[activeLyricIndex];
    if (!activeEl) {
      setShowSyncButton(false);
      return;
    }

    const containerHeight = container.clientHeight;
    const scrollTop = container.scrollTop;
    const elTop = activeEl.offsetTop - scrollTop;
    const elBottom = elTop + activeEl.clientHeight;

    // Viewport threshold with safe margin for top/bottom fade gradient masks
    const topSafe = containerHeight * 0.15;
    const bottomSafe = containerHeight * 0.85;

    if (elBottom < topSafe) {
      // Active line is scrolled away above
      setShowSyncButton(true);
      setSyncButtonDirection('up');
    } else if (elTop > bottomSafe) {
      // Active line is scrolled away below
      setShowSyncButton(true);
      setSyncButtonDirection('down');
    } else {
      // Active line is in view, hide the return button
      setShowSyncButton(false);
    }
  }, [activeLyricIndex]);

  // Handle user manual scroll: pause auto-scroll completely so user can freely read lyrics
  const handleScroll = useCallback(() => {
    isUserScrollingRef.current = true;
    checkActiveLineVisibility();

    if (userScrollTimeoutRef.current) {
      window.clearTimeout(userScrollTimeoutRef.current);
    }
    // Generous idle timer: only resume auto-scroll if user stopped scrolling AND is already looking at active line
    userScrollTimeoutRef.current = window.setTimeout(() => {
      const container = lyricsContainerRef.current;
      if (container && activeLyricIndex >= 0) {
        const activeEl = lineRefs.current[activeLyricIndex];
        if (activeEl) {
          const elTop = activeEl.offsetTop - container.scrollTop;
          const elBottom = elTop + activeEl.clientHeight;
          // Only release manual scroll if active line is centered/in view
          if (elBottom >= container.clientHeight * 0.25 && elTop <= container.clientHeight * 0.75) {
            isUserScrollingRef.current = false;
          }
        }
      }
    }, 12000);
  }, [activeLyricIndex, checkActiveLineVisibility]);

  // Auto-scroll on active lyric line change (only when user is not manually scrolling)
  useEffect(() => {
    if (fullscreenTab === 'lyrics' && activeLyricIndex >= 0) {
      if (!isUserScrollingRef.current) {
        scrollToActiveLine(true);
      } else {
        // While user is manually browsing, only update return button visibility
        checkActiveLineVisibility();
      }
    }
  }, [activeLyricIndex, fullscreenTab, scrollToActiveLine, checkActiveLineVisibility]);

  // Immediate centering when opening lyrics tab
  useEffect(() => {
    if (fullscreenTab === 'lyrics' && activeLyricIndex >= 0) {
      isUserScrollingRef.current = false;
      setShowSyncButton(false);
      const timer = window.setTimeout(() => {
        centerLine(activeLyricIndex, false);
      }, 60);
      return () => window.clearTimeout(timer);
    }
  }, [fullscreenTab, activeLyricIndex, centerLine]);

  // Keyboard controls (Escape to close submenus or exit fullscreen player)
  useEffect(() => {
    if (!isFullscreenPlayerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc' || e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();

        if (isScaleMenuOpen) {
          setIsScaleMenuOpen(false);
          return;
        }
        if (isVisualizerMenuOpen) {
          setIsVisualizerMenuOpen(false);
          return;
        }
        if (isMoreMenuOpen) {
          setIsMoreMenuOpen(false);
          return;
        }
        if (qualityMenuOpen) {
          setQualityMenuOpen(false);
          return;
        }
        closeFullscreenPlayer();
        return;
      }

      // Zoom hotkeys: Ctrl + Plus / Ctrl + Minus / Ctrl + 0
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') {
          e.preventDefault();
          zoomIn();
          return;
        }
        if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
          e.preventDefault();
          zoomOut();
          return;
        }
        if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
          e.preventDefault();
          resetZoom();
          return;
        }
      }

      if (
        e.key === 'v' || e.key === 'V' || e.key === 'м' || e.key === 'М' ||
        e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И'
      ) {
        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
        e.preventDefault();
        cycleBackdropMode();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isFullscreenPlayerOpen,
    isScaleMenuOpen,
    isVisualizerMenuOpen,
    isMoreMenuOpen,
    qualityMenuOpen,
    closeFullscreenPlayer,
    cycleBackdropMode,
    zoomIn,
    zoomOut,
    resetZoom,
  ]);

  if (!isFullscreenPlayerOpen || !currentTrack) return null;

  const upcomingQueue = queue.slice(queueIndex + 1);

  const effectiveScale = scale === 'auto' ? detectedScreen.baseScale : scale;

  return (
    <div
      className={`fullscreen-overlay ${isZenMode ? 'fullscreen-overlay--zen' : ''}`}
      data-scale={scale === 'auto' ? 'auto' : 'custom'}
      style={
        {
          '--cover-glow-rgb': coverGlowRgb,
          '--cover-secondary-rgb': coverSecondaryRgb,
          '--cover-tertiary-rgb': coverTertiaryRgb,
          '--cover-gradient': coverGradient,
          '--fs-user-scale': effectiveScale,
          '--fs-scale': effectiveScale,
        } as React.CSSProperties
      }
    >
      {/* Living fluid dynamic audio-reactive backdrop */}
      <FluidBackdropVisualizer
        glowRgb={coverGlowRgb}
        secondaryRgb={coverSecondaryRgb}
        tertiaryRgb={coverTertiaryRgb}
        isPlaying={isPlaying}
        mode={backdropMode}
      />
      <div className="fullscreen-overlay__vignette" />

      {/* Top Header */}
      <header className="fullscreen-overlay__header">
        <div className="fullscreen-overlay__header-spacer" />

        {/* Bracketed Tabs: [ ОБЛОЖКА / СЛОВА / ОЧЕРЕДЬ ] */}
        <nav className="fullscreen-tabs" aria-label="Режимы полноэкранного плеера">
          <span className="fullscreen-tabs__bracket">[</span>
          <button
            type="button"
            className={`fullscreen-tabs__btn ${fullscreenTab === 'track' ? 'fullscreen-tabs__btn--active' : ''}`}
            onClick={() => setFullscreenTab('track')}
          >
            ОБЛОЖКА
          </button>
          <span className="fullscreen-tabs__sep">/</span>
          <button
            type="button"
            className={`fullscreen-tabs__btn ${fullscreenTab === 'lyrics' ? 'fullscreen-tabs__btn--active' : ''}`}
            onClick={() => setFullscreenTab('lyrics')}
          >
            СЛОВА
          </button>
          <span className="fullscreen-tabs__sep">/</span>
          <button
            type="button"
            className={`fullscreen-tabs__btn ${fullscreenTab === 'queue' ? 'fullscreen-tabs__btn--active' : ''}`}
            onClick={() => setFullscreenTab('queue')}
          >
            ОЧЕРЕДЬ
          </button>
          <span className="fullscreen-tabs__bracket">]</span>
        </nav>

        {/* Close Button */}
        <button
          type="button"
          className="fullscreen-overlay__close-btn"
          onClick={closeFullscreenPlayer}
          title="Закрыть (Esc)"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      {/* Main Content Area */}
      <main className={`fullscreen-overlay__content fullscreen-overlay__content--${fullscreenTab}`}>
        {/* Left / Main Player Column */}
        <div className="fullscreen-player-card">
          {/* Album Cover Art */}
          <div className="fullscreen-player-card__artwork-wrapper">
            {currentTrack.cover_url ? (
              <img
                src={getCoverUrl(currentTrack.cover_url, 'large')}
                alt={currentTrack.title}
                className={`fullscreen-player-card__artwork ${!isPlaying ? 'fullscreen-player-card__artwork--paused' : ''}`}
                onClick={togglePlay}
                title={isPlaying ? 'Пауза (Space)' : 'Воспроизведение (Space)'}
              />
            ) : (
              <div className={`fullscreen-player-card__artwork fullscreen-player-card__artwork--placeholder ${!isPlaying ? 'fullscreen-player-card__artwork--paused' : ''}`}>
                🎵
              </div>
            )}
          </div>

          {/* Track Info Row */}
          <div className="fullscreen-player-card__info-row">
            <div className="fullscreen-player-card__meta">
              <h2 className="fullscreen-player-card__title" title={currentTrack.title}>
                {currentTrack.title}
              </h2>
              <div className="fullscreen-player-card__artist">
                <ArtistLinks
                  artists={currentTrack.artists}
                  artistId={currentTrack.artist_id}
                  artistName={currentTrack.artist}
                />
              </div>
            </div>

            <div className="fullscreen-player-card__actions">
              {/* More options button */}
              <div style={{ position: 'relative' }} ref={moreMenuRef}>
                <button
                  type="button"
                  className="fullscreen-icon-btn"
                  onClick={() => setIsMoreMenuOpen((p) => !p)}
                  title="Дополнительно"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="19" cy="12" r="2" />
                  </svg>
                </button>

                {isMoreMenuOpen && (
                  <div className="fullscreen-dropdown-menu">
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        navigator.clipboard.writeText(`https://zvuk.com/track/${currentTrack.id}`);
                        showToast('Ссылка на трек скопирована', 'success');
                      }}
                    >
                      <ShareIcon size={16} />
                      Поделиться треком
                    </button>
                    {currentTrack.album_id && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          navigator.clipboard.writeText(`https://zvuk.com/release/${currentTrack.album_id}`);
                          showToast('Ссылка на альбом скопирована', 'success');
                        }}
                      >
                        <ShareIcon size={16} />
                        Поделиться альбомом
                      </button>
                    )}
                    {(currentTrack.artist_id || currentTrack.artists?.[0]?.id) && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          const aId = currentTrack.artist_id ?? currentTrack.artists?.[0]?.id;
                          navigator.clipboard.writeText(`https://zvuk.com/artist/${aId}`);
                          showToast('Ссылка на артиста скопирована', 'success');
                        }}
                      >
                        <ShareIcon size={16} />
                        Поделиться артистом
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        usePlaylistModalStore.getState().openAddToPlaylist(currentTrack);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Добавить в плейлист
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        navigator.clipboard.writeText(`${currentTrack.artist} - ${currentTrack.title}`);
                        showToast('Название трека скопировано', 'info');
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      Скопировать название
                    </button>
                    {currentTrack.album_id && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          closeFullscreenPlayer();
                          window.location.hash = `/album/${currentTrack.album_id}`;
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        Перейти к альбому
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        toggleDislikeTrack(currentTrack.id);
                      }}
                    >
                      <DislikeIcon size={16} active={isDisliked} />
                      {isDisliked ? 'Снять скрытие трека' : 'Не рекомендовать трек'}
                    </button>
                    {currentArtistId && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          toggleDislikeArtist(currentArtistId, currentTrack.artist);
                        }}
                      >
                        <DislikeIcon size={16} active={isArtistDisliked} />
                        {isArtistDisliked ? 'Разблокировать артиста' : 'Не рекомендовать артиста'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Like Button */}
              <LikeButton
                isLiked={isLiked}
                onToggle={() => toggleLikeTrack(currentTrack.id)}
                size={22}
                title={isLiked ? 'Удалить из любимых (L)' : 'Добавить в любимое (L)'}
              />

              {/* Dislike Button */}
              <DislikeButton
                isDisliked={isDisliked}
                onToggle={() => toggleDislikeTrack(currentTrack.id)}
                size={22}
                title={isDisliked ? 'Снять отметку «Не нравится» (D)' : 'Не нравится / Скрыть (D)'}
              />
            </div>

            <div
              className="fullscreen-player-card__quality-row"
              title={`Качество звука: ${audioDetails.fullSummary}`}
            >
              <span className="fullscreen-player-card__quality-meta">
                {audioDetails.codec} • {audioDetails.codec === "FLAC"
                  ? `${audioDetails.bitDepthText} / ${audioDetails.sampleRateText} • ${audioDetails.bitrateText}`
                  : `${audioDetails.bitrateText} • ${audioDetails.sampleRateText}`}
              </span>
            </div>
          </div>

          {/* Dashed Tick Ruler Progress Bar */}
          <AudioRulerTrack
            progress={progress}
            duration={duration}
            onSeek={seekTo}
          />

          {/* Playback Controls Row */}
          <div className="fullscreen-controls">
            {/* Volume Control */}
            <div
              ref={volumeControlRef}
              className="fullscreen-controls__volume"
              title={`Громкость: ${Math.round((isMuted ? 0 : volume) * 100)}% (прокрутка колёсиком мыши)`}
            >
              <button
                type="button"
                className="fullscreen-icon-btn"
                onClick={toggleMute}
                title={isMuted ? 'Включить звук' : 'Выключить звук (колёсико для громкости)'}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {isMuted || volume === 0 ? (
                    <>
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <line x1="23" y1="9" x2="17" y2="15" />
                      <line x1="17" y1="9" x2="23" y2="15" />
                    </>
                  ) : volume < 0.5 ? (
                    <>
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </>
                  ) : (
                    <>
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </>
                  )}
                </svg>
              </button>
              <input
                type="range"
                className="fullscreen-volume-slider"
                min="0"
                max="1"
                step="0.01"
                value={isMuted ? 0 : volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                onPointerUp={(e) => (e.target as HTMLElement).blur()}
                onPointerLeave={(e) => (e.target as HTMLElement).blur()}
                style={{
                  background: `linear-gradient(to right, #ffffff 0%, #ffffff ${Math.round((isMuted ? 0 : volume) * 100)}%, rgba(255, 255, 255, 0.18) ${Math.round((isMuted ? 0 : volume) * 100)}%, rgba(255, 255, 255, 0.18) 100%)`,
                }}
                title={`Громкость: ${Math.round((isMuted ? 0 : volume) * 100)}% (прокрутка колёсиком мыши)`}
              />
            </div>

            {/* Core Playback Buttons */}
            <div className="fullscreen-controls__main">
              {/* Repeat Button */}
              <button
                type="button"
                className={`fullscreen-icon-btn ${repeat !== 'off' ? 'fullscreen-icon-btn--active' : ''}`}
                onClick={cycleRepeat}
                title={`Повтор: ${repeat === 'off' ? 'выкл' : repeat === 'all' ? 'всех' : 'одного'}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                {repeat === 'one' && <span className="fullscreen-repeat-one-badge">1</span>}
              </button>

              {/* Previous Track */}
              <button
                type="button"
                className="fullscreen-icon-btn"
                onClick={previousTrack}
                title="Предыдущий трек"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                </svg>
              </button>

              {/* Play / Pause */}
              <button
                type="button"
                className="fullscreen-play-btn"
                onClick={togglePlay}
                title={isPlaying ? 'Пауза (Space)' : 'Воспроизведение (Space)'}
              >
                {isPlaying ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1.5" />
                    <rect x="14" y="4" width="4" height="16" rx="1.5" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* Next Track */}
              <button
                type="button"
                className="fullscreen-icon-btn"
                onClick={() => nextTrack()}
                title="Следующий трек"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                </svg>
              </button>

              {/* Shuffle */}
              <button
                type="button"
                className={`fullscreen-icon-btn ${shuffle ? 'fullscreen-icon-btn--active' : ''}`}
                onClick={toggleShuffle}
                title={`Случайный порядок: ${shuffle ? 'вкл' : 'выкл'}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 3 21 3 21 8" />
                  <line x1="4" y1="20" x2="21" y2="3" />
                  <polyline points="21 16 21 21 16 21" />
                  <line x1="15" y1="15" x2="21" y2="21" />
                  <line x1="4" y1="4" x2="9" y2="9" />
                </svg>
              </button>
            </div>

            {/* Quality Badge */}
            <div className="fullscreen-controls__quality">
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className={`fullscreen-quality-badge ${audioDetails.isHiRes
                      ? 'fullscreen-quality-badge--hires'
                      : audioDetails.badgeLabel === 'HiFi'
                        ? 'fullscreen-quality-badge--hifi'
                        : ''
                    }`}
                  onClick={() => setQualityMenuOpen((p) => !p)}
                  title={audioDetails.fullSummary}
                >
                  <span className="fullscreen-quality-badge__label">{audioDetails.badgeLabel}{audioDetails.badgeLabel === "HiFi" && <CrystalIcon size={10} className="quality-badge__crystal" />}</span>
                </button>

                {qualityMenuOpen && (
                  <div className="fullscreen-dropdown-menu fullscreen-dropdown-menu--right">
                    <div className="fullscreen-dropdown-menu__header">
                      <div className="fullscreen-dropdown-menu__title">Текущий поток</div>
                      <div className="fullscreen-dropdown-menu__current-details">
                        <span className={`quality-badge quality-badge--${audioDetails.isHiRes ? "hires" : audioDetails.badgeLabel === "HiFi" ? "hifi" : audioDetails.badgeLabel === "HQ" ? "hq" : "sq"}`}>
                          {audioDetails.badgeLabel}{audioDetails.badgeLabel === "HiFi" && <CrystalIcon size={10} className="quality-badge__crystal" />}
                        </span>
                        <span>{audioDetails.codec}</span>
                        <span>•</span>
                        <span>{audioDetails.channelsText}</span>
                      </div>
                      <div className="fullscreen-dropdown-menu__meta">
                        {audioDetails.codec === 'FLAC'
                          ? `${audioDetails.bitDepthText} • ${audioDetails.sampleRateText} • ${audioDetails.bitrateText}`
                          : `${audioDetails.bitrateText} • ${audioDetails.sampleRateText}`}
                      </div>
                    </div>
                    <div className="fullscreen-dropdown-menu__divider" />
                    <button
                      type="button"
                      className={quality === 'flac' ? 'fullscreen-dropdown-menu__active' : ''}
                      onClick={() => {
                        setQuality('flac');
                        setQualityMenuOpen(false);
                      }}
                    >
                      HiFi <CrystalIcon size={10} className="quality-badge__crystal" /> • FLAC Lossless
                    </button>
                    <button
                      type="button"
                      className={quality === 'high' ? 'fullscreen-dropdown-menu__active' : ''}
                      onClick={() => {
                        setQuality('high');
                        setQualityMenuOpen(false);
                      }}
                    >
                      HQ • MP3 320 кбит/с
                    </button>
                    <button
                      type="button"
                      className={quality === 'mid' ? 'fullscreen-dropdown-menu__active' : ''}
                      onClick={() => {
                        setQuality('mid');
                        setQualityMenuOpen(false);
                      }}
                    >
                      SQ • MP3 128 кбит/с
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Lyrics View */}
        {fullscreenTab === 'lyrics' && (
          <div className="fullscreen-lyrics-column">
            {/* Lyrics Control HUD: Source Selector & Timing Offset Pill (Always accessible, outside scroll container) */}
            <div className="fullscreen-lyrics-hud">
              {/* Source Selector Dropdown */}
              <div className="fullscreen-lyrics-source-selector" ref={sourceMenuRef}>
                <button
                  type="button"
                  className={`fullscreen-lyrics-source-tag fullscreen-lyrics-source-tag--interactive ${sourceMenuOpen ? 'fullscreen-lyrics-source-tag--open' : ''
                    }`}
                  onClick={() => setSourceMenuOpen((prev) => !prev)}
                  title="Выбрать источник текста песни"
                >
                  <span className="fullscreen-lyrics-source-tag__name">
                    {lyricsInfo ? lyricsInfo.sourceLabel : 'Поиск источника...'}
                  </span>
                  {lyricsInfo && (
                    <span
                      className={`fullscreen-lyrics-source-tag__type ${lyricsInfo.has_word_sync || lyricsInfo.is_synced ? 'fullscreen-lyrics-source-tag__type--synced' : ''
                        }`}
                    >
                      {lyricsInfo.has_word_sync ? 'Karaoke' : lyricsInfo.is_synced ? 'LRC' : 'TXT'}
                    </span>
                  )}
                  {availableSourcesWithText > 0 && (
                    <span
                      className="fullscreen-lyrics-source-tag__count"
                      title={`Доступно источников: ${availableSourcesWithText}`}
                    >
                      {availableSourcesWithText}
                    </span>
                  )}
                  <svg
                    className={`fullscreen-lyrics-source-tag__chevron ${sourceMenuOpen ? 'fullscreen-lyrics-source-tag__chevron--open' : ''
                      }`}
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {sourceMenuOpen && (
                  <div className="fullscreen-lyrics-source-menu">
                    <div className="fullscreen-lyrics-source-menu__header">
                      <div className="fullscreen-lyrics-source-menu__header-titles">
                        <span className="fullscreen-lyrics-source-menu__title">Источник текста</span>
                        <span className="fullscreen-lyrics-source-menu__subtitle">
                          {availableSourcesWithText > 0
                            ? `Найдено в ${availableSourcesWithText} из 4 провайдеров`
                            : isAnySourceProbing
                              ? 'Проверка доступности...'
                              : 'Поиск по провайдерам'}
                        </span>
                      </div>
                      {preferredSource && (
                        <button
                          type="button"
                          className="fullscreen-lyrics-source-menu__reset-btn"
                          onClick={() => {
                            setPreferredSource(null);
                            setSourceMenuOpen(false);
                          }}
                          title="Вернуть автоматический выбор лучшего источника"
                        >
                          Авто
                        </button>
                      )}
                    </div>

                    <div className="fullscreen-lyrics-source-menu__list">
                      {allProviderOptions.map((opt) => {
                        const probe = sourcesAvailability[opt.id];
                        const isAvailable = probe?.status === 'available';
                        const isCurrent = lyricsInfo?.source === opt.id;
                        const isManualSelected = preferredSource === opt.id;
                        const statusBadge = getProviderStatus(opt.id);

                        return (
                          <button
                            key={opt.id}
                            type="button"
                            className={`fullscreen-lyrics-source-menu__item ${isCurrent ? 'fullscreen-lyrics-source-menu__item--active' : ''
                              } ${!isAvailable && probe?.status !== 'loading' ? 'fullscreen-lyrics-source-menu__item--unavailable' : ''}`}
                            onClick={() => {
                              setPreferredSource(opt.id);
                              setSourceMenuOpen(false);
                            }}
                          >
                            <div className="fullscreen-lyrics-source-menu__item-info">
                              <div className="fullscreen-lyrics-source-menu__item-row">
                                <span className="fullscreen-lyrics-source-menu__item-name">{opt.name}</span>
                                <span
                                  className={`fullscreen-lyrics-source-menu__item-badge fullscreen-lyrics-source-menu__item-badge--${statusBadge.class}`}
                                >
                                  {statusBadge.text}
                                </span>
                                {isCurrent && !isManualSelected && (
                                  <span className="fullscreen-lyrics-source-menu__item-curr" title="Выбран автоматически">
                                    (авто)
                                  </span>
                                )}
                              </div>
                              <span className="fullscreen-lyrics-source-menu__item-desc">{opt.desc}</span>
                            </div>
                            {isCurrent && (
                              <span className="fullscreen-lyrics-source-menu__item-check">✓</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Timing Offset Stepper Pill */}
              <div
                className="fullscreen-lyrics-offset-control"
                title="Коррекция таймингов: сдвиг текста относительно музыки"
              >
                <button
                  type="button"
                  className="fullscreen-lyrics-offset-btn"
                  onClick={() => adjustTimingOffset(-0.2)}
                  title="Сдвинуть текст раньше на 0.2 сек"
                >
                  −0.2s
                </button>
                <button
                  type="button"
                  className={`fullscreen-lyrics-offset-val ${timingOffset !== 0 ? 'fullscreen-lyrics-offset-val--active' : ''
                    }`}
                  onClick={resetTimingOffset}
                  title="Сбросить сдвиг таймингов"
                >
                  {timingOffset === 0
                    ? '±0.0s'
                    : `${timingOffset > 0 ? '+' : ''}${timingOffset.toFixed(1)}s`}
                </button>
                <button
                  type="button"
                  className="fullscreen-lyrics-offset-btn"
                  onClick={() => adjustTimingOffset(0.2)}
                  title="Сдвинуть текст позже на 0.2 сек"
                >
                  +0.2s
                </button>
              </div>
            </div>

            {/* Scrolling Lyrics Pane */}
            <div
              className="fullscreen-lyrics-pane"
              ref={lyricsContainerRef}
              onScroll={handleScroll}
            >
              {/* Audio-reactive ambient aura behind singing focus area */}
              <div className="fullscreen-lyrics-pane__ambient" aria-hidden="true" />

              {lyricsLoading ? (
                <div className="fullscreen-lyrics-pane__loading">
                  <div className="spinner" />
                  <span>Загрузка текста...</span>
                </div>
              ) : parsedLyrics.length > 0 ? (
                <>
                  <div className="fullscreen-lyrics-pane__lines">
                    {parsedLyrics.map((line, idx) => {
                      const isActive = idx === activeLyricIndex;
                      const isPast = activeLyricIndex >= 0 && idx < activeLyricIndex;
                      const isFuture = activeLyricIndex >= 0 && idx > activeLyricIndex;
                      const isSynced = line.time !== undefined;
                      const isLinePast = line.isInstrumental
                        ? effectiveSmoothTime >= (line.endTime ?? (line.time ?? 0) + 4)
                        : isPast;

                      // Distance-based blur & focus depth (Apple Music style)
                      const distance = activeLyricIndex >= 0 ? Math.abs(idx - activeLyricIndex) : 0;
                      const blurAmount = isActive ? 0 : Math.min(2.2, distance * 0.4);
                      const opacityAmount = isActive
                        ? 1
                        : isPast
                          ? Math.max(0.35, 0.75 - distance * 0.08)
                          : Math.max(0.18, 0.5 - distance * 0.08);

                      return (
                        <div
                          key={idx}
                          ref={(el) => {
                            lineRefs.current[idx] = el;
                          }}
                          className={`fullscreen-lyric-line ${isActive
                            ? 'fullscreen-lyric-line--active'
                            : isPast
                              ? 'fullscreen-lyric-line--past'
                              : isFuture
                                ? 'fullscreen-lyric-line--future'
                                : ''
                            } ${isSynced ? 'fullscreen-lyric-line--clickable' : ''} ${
                              line.isInstrumental ? 'fullscreen-lyric-line--instrumental' : ''
                            } ${
                              line.isInstrumental && isLinePast ? 'fullscreen-lyric-line--instrumental-collapsed' : ''
                            }`}
                          style={{
                            filter: isSynced && !line.isInstrumental ? `blur(${blurAmount}px)` : 'none',
                            opacity: line.isInstrumental ? (isActive ? 1 : isLinePast ? 0 : 0.6) : isSynced ? opacityAmount : 0.85,
                          } as React.CSSProperties}
                          onClick={() => {
                            if (line.time !== undefined) {
                              const targetAudioTime = Math.max(0, line.time - timingOffset);
                              seekTo(targetAudioTime);
                              setSmoothTime(targetAudioTime);
                              isUserScrollingRef.current = false;
                              setShowSyncButton(false);
                              centerLine(idx, true);
                            }
                          }}
                        >
                          {line.isInstrumental ? (
                            <InstrumentalBreakIndicator
                              time={line.time ?? 0}
                              endTime={line.endTime ?? (line.time ?? 0) + 4}
                              currentTime={effectiveSmoothTime}
                              isActive={isActive}
                              size="large"
                            />
                          ) : line.hasEnhancedTimings && line.words.length > 0 ? (
                            <span className="fullscreen-lyric-line__words">
                              {line.words.map((word, wIdx) => {
                                let isWordPast = false;
                                let isWordActive = false;
                                let wordFill = 0;

                                if (isPast) {
                                  isWordPast = true;
                                } else if (isFuture) {
                                  isWordPast = false;
                                  isWordActive = false;
                                } else {
                                  isWordPast = effectiveSmoothTime >= word.endTime;
                                  isWordActive =
                                    effectiveSmoothTime >= word.time && effectiveSmoothTime < word.endTime;
                                  if (isWordActive) {
                                    const wordDuration = Math.max(0.06, word.endTime - word.time);
                                    wordFill = Math.min(
                                      100,
                                      Math.max(
                                        0,
                                        ((effectiveSmoothTime - word.time) / wordDuration) * 100
                                      )
                                    );
                                  }
                                }

                                return (
                                  <span
                                    key={wIdx}
                                    className={`fullscreen-lyric-word ${isWordActive
                                      ? 'fullscreen-lyric-word--active'
                                      : isWordPast
                                        ? 'fullscreen-lyric-word--past'
                                        : 'fullscreen-lyric-word--future'
                                      } ${!word.hasSpaceAfter ? 'fullscreen-lyric-word--no-space' : ''}`}
                                    style={
                                      isWordActive
                                        ? ({ '--word-fill': `${wordFill.toFixed(1)}%` } as React.CSSProperties)
                                        : undefined
                                    }
                                  >
                                    <span className="fullscreen-lyric-word__inner">{word.text}</span>
                                  </span>
                                );
                              })}
                            </span>
                          ) : (
                            <span className="fullscreen-lyric-line__text">
                              {line.text || '\u00A0'}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="fullscreen-lyrics-pane__empty">
                  <p>Текст песни пока недоступен для этого трека</p>
                </div>
              )}
            </div>

            {/* Floating Return to Current Line button - pinned outside the scroll container */}
            {showSyncButton && activeLyricIndex >= 0 && (
              <button
                type="button"
                className="fullscreen-lyrics-sync-btn"
                onClick={() => {
                  isUserScrollingRef.current = false;
                  scrollToActiveLine(true);
                }}
                title="Вернуться к текущей строчке"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {syncButtonDirection === 'down' ? (
                    <polyline points="6 9 12 15 18 9" />
                  ) : (
                    <polyline points="18 15 12 9 6 15" />
                  )}
                </svg>
                <span>К текущей строчке</span>
              </button>
            )}
          </div>
        )}

        {/* Right Column: Queue View */}
        {fullscreenTab === 'queue' && (
          <div className="fullscreen-queue-pane">
            {/* Currently Playing Track */}
            <div className="fullscreen-queue-section">
              <div className="fullscreen-queue-section__title">СЕЙЧАС ИГРАЕТ</div>
              <div className="fullscreen-queue-item fullscreen-queue-item--current">
                <div className="fullscreen-queue-item__thumb">
                  {currentTrack.cover_url ? (
                    <img src={currentTrack.cover_url} alt={currentTrack.title} />
                  ) : (
                    <span>🎵</span>
                  )}
                </div>
                <div className="fullscreen-queue-item__meta">
                  <div className="fullscreen-queue-item__title">{currentTrack.title}{currentTrack.has_flac && <span className="track-badge-hifi" title="HiFi Audio (Lossless)"><CrystalIcon size={11} /></span>}</div>
                  <div className="fullscreen-queue-item__artist">{currentTrack.artist}</div>
                </div>
                <div className="fullscreen-queue-item__playing-badge">
                  {isPlaying ? '▶' : '⏸'}
                </div>
              </div>
            </div>

            {/* Upcoming Queue Tracks */}
            <div className="fullscreen-queue-section">
              <div className="fullscreen-queue-section__title">
                ДАЛЕЕ В ОЧЕРЕДИ {upcomingQueue.length > 0 && `(${upcomingQueue.length})`}
              </div>

              {upcomingQueue.length > 0 ? (
                <div className="fullscreen-queue-list">
                  {upcomingQueue.map((track, i) => {
                    const actualIdx = queueIndex + 1 + i;
                    return (
                      <div
                        key={`${track.id}-${actualIdx}`}
                        className="fullscreen-queue-item"
                        onClick={() => playQueueTrack(actualIdx)}
                      >
                        <div className="fullscreen-queue-item__thumb">
                          {track.cover_url ? (
                            <img src={track.cover_url} alt={track.title} />
                          ) : (
                            <span>🎵</span>
                          )}
                        </div>
                        <div className="fullscreen-queue-item__meta">
                          <div className="fullscreen-queue-item__title">{track.title}{track.has_flac && <span className="track-badge-hifi" title="HiFi Audio (Lossless)"><CrystalIcon size={11} /></span>}</div>
                          <div className="fullscreen-queue-item__artist">{track.artist}</div>
                        </div>
                        <div className="fullscreen-queue-item__duration">
                          {formatTime(track.duration)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="fullscreen-queue-pane__empty">
                  <span>Очередь воспроизведения пуста</span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Left Corner: Zen / Cinema mode toggle icon & Visualizer toggle */}
      <footer className="fullscreen-overlay__footer">
        <button
          type="button"
          className="fullscreen-icon-btn fullscreen-zen-toggle"
          onClick={() => setIsZenMode((p) => !p)}
          title={isZenMode ? 'Показать интерфейс' : 'Режим без отвлечений (Zen)'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>

        <div className="fullscreen-visualizer-picker" ref={visualizerMenuRef}>
          <button
            type="button"
            className={`fullscreen-visualizer-toggle ${backdropMode !== 'off' ? 'fullscreen-visualizer-toggle--active' : ''}`}
            onClick={() => setIsVisualizerMenuOpen((v) => !v)}
            title={`Режим фона: ${backdropLabels[backdropMode].full} (Клик для выбора, B для быстрой смены)`}
            aria-haspopup="menu"
            aria-expanded={isVisualizerMenuOpen}
          >
            {backdropMode === 'lava' ? (
              <svg className="fullscreen-visualizer-toggle__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 2c-4 4-7 8.5-7 12a7 7 0 0 0 14 0c0-3.5-3-8-7-12z" />
                <circle cx="12" cy="14" r="2.5" />
              </svg>
            ) : backdropMode === 'fluid' ? (
              <svg className="fullscreen-visualizer-toggle__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 8c4-4 8.5-4.5 12.5-0.5s5.5 4 7.5-0.5" />
                <path d="M2 13.5c4-4.5 8.5-5 12.5-1s5.5 3.5 7.5-1" />
                <path d="M3.5 19c3.5-3.5 7.5-4 11-1s5 2 7-0.8" opacity="0.55" />
              </svg>
            ) : (
              <svg className="fullscreen-visualizer-toggle__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <line x1="5" y1="5" x2="19" y2="19" />
              </svg>
            )}
            <span className="fullscreen-visualizer-toggle__label">
              {backdropLabels[backdropMode].short}
            </span>
            <svg
              className="fullscreen-visualizer-toggle__chevron"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                opacity: 0.6,
                transform: isVisualizerMenuOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {isVisualizerMenuOpen && (
            <div className="fullscreen-visualizer-menu" role="menu">
              <div className="fullscreen-visualizer-menu__header">
                <span>ФОНОВЫЙ ВИЗУАЛИЗАТОР</span>
                <span className="fullscreen-visualizer-menu__hint">HOTKEY: V</span>
              </div>
              <div className="fullscreen-visualizer-menu__list">
                <button
                  type="button"
                  className={`fullscreen-visualizer-menu__item ${backdropMode === 'fluid' ? 'fullscreen-visualizer-menu__item--active' : ''}`}
                  onClick={() => selectBackdropMode('fluid')}
                >
                  <div className="fullscreen-visualizer-menu__item-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 8c4-4 8.5-4.5 12.5-0.5s5.5 4 7.5-0.5" />
                      <path d="M2 13.5c4-4.5 8.5-5 12.5-1s5.5 3.5 7.5-1" />
                      <path d="M3.5 19c3.5-3.5 7.5-4 11-1s5 2 7-0.8" opacity="0.55" />
                    </svg>
                  </div>
                  <div className="fullscreen-visualizer-menu__item-content">
                    <div className="fullscreen-visualizer-menu__item-title">Шёлк</div>
                    <div className="fullscreen-visualizer-menu__item-desc">Струящиеся волны ткани и градиент</div>
                  </div>
                  {backdropMode === 'fluid' && (
                    <div className="fullscreen-visualizer-menu__item-check">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  className={`fullscreen-visualizer-menu__item ${backdropMode === 'lava' ? 'fullscreen-visualizer-menu__item--active' : ''}`}
                  onClick={() => selectBackdropMode('lava')}
                >
                  <div className="fullscreen-visualizer-menu__item-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M12 2c-4 4-7 8.5-7 12a7 7 0 0 0 14 0c0-3.5-3-8-7-12z" />
                      <circle cx="12" cy="14" r="2.5" />
                    </svg>
                  </div>
                  <div className="fullscreen-visualizer-menu__item-content">
                    <div className="fullscreen-visualizer-menu__item-title">Лава-лампа</div>
                    <div className="fullscreen-visualizer-menu__item-desc">Плавающие капли воска и метаболлы</div>
                  </div>
                  {backdropMode === 'lava' && (
                    <div className="fullscreen-visualizer-menu__item-check">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  className={`fullscreen-visualizer-menu__item ${backdropMode === 'off' ? 'fullscreen-visualizer-menu__item--active' : ''}`}
                  onClick={() => selectBackdropMode('off')}
                >
                  <div className="fullscreen-visualizer-menu__item-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9" />
                      <line x1="5" y1="5" x2="19" y2="19" />
                    </svg>
                  </div>
                  <div className="fullscreen-visualizer-menu__item-content">
                    <div className="fullscreen-visualizer-menu__item-title">Статика</div>
                    <div className="fullscreen-visualizer-menu__item-desc">Выключить анимацию фона</div>
                  </div>
                  {backdropMode === 'off' && (
                    <div className="fullscreen-visualizer-menu__item-check">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Scale / Screen Resolution Selector */}
        <div className="fullscreen-scale-picker" ref={scaleMenuRef}>
          <button
            type="button"
            className={`fullscreen-scale-toggle ${scale !== 'auto' ? 'fullscreen-scale-toggle--active' : ''}`}
            onClick={() => setIsScaleMenuOpen((s) => !s)}
            title={`Масштаб интерфейса: ${scale === 'auto' ? `Авто (${detectedScreen.percentageText})` : `${Math.round((scale as number) * 100)}%`} (Клик для выбора, Ctrl +/- для масштабирования)`}
            aria-haspopup="menu"
            aria-expanded={isScaleMenuOpen}
          >
            <svg
              className="fullscreen-scale-toggle__icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
              <polyline points="7 9 10 9 10 12" />
              <polyline points="17 11 14 11 14 8" />
            </svg>
            <span className="fullscreen-scale-toggle__label">
              {scale === 'auto' ? `Авто (${detectedScreen.percentageText})` : `${Math.round((scale as number) * 100)}%`}
            </span>
            <svg
              className="fullscreen-scale-toggle__chevron"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                opacity: 0.6,
                transform: isScaleMenuOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {isScaleMenuOpen && (
            <div className="fullscreen-scale-menu" role="menu">
              <div className="fullscreen-scale-menu__header">
                <span>Масштаб под разрешение</span>
                <span className="fullscreen-scale-menu__hint">Ctrl +/-</span>
              </div>
              <div className="fullscreen-scale-menu__list">
                {SCALE_OPTIONS.map((opt) => {
                  const isActive = scale === opt.value;
                  const isAuto = opt.value === 'auto';
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      className={`fullscreen-scale-menu__item ${isActive ? 'fullscreen-scale-menu__item--active' : ''}`}
                      onClick={() => {
                        setScale(opt.value);
                        setIsScaleMenuOpen(false);
                      }}
                    >
                      <div className="fullscreen-scale-menu__item-badge">
                        {isAuto ? 'AUTO' : opt.label}
                      </div>
                      <div className="fullscreen-scale-menu__item-content">
                        <div className="fullscreen-scale-menu__item-title">
                          {isAuto ? `Автоматически (${detectedScreen.category})` : opt.label}
                        </div>
                        <div className="fullscreen-scale-menu__item-desc">
                          {isAuto
                            ? `Определено: ${detectedScreen.percentageText} (${windowDimensions.width}×${windowDimensions.height})`
                            : opt.desc}
                        </div>
                      </div>
                      {isActive && (
                        <div className="fullscreen-scale-menu__item-check">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
