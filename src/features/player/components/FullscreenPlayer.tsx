import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { usePlayerStore } from '../playerStore';
import { useFavouritesStore } from '../../favourites/favouritesStore';
import { formatTime } from '../../../lib/formatters';
import { extractMonetFromImage, extractMonetThemeFromPalette } from '../../../lib/monetPalette';
import { LikeButton } from '../../../components/LikeButton';
import { ArtistLinks } from '../../../components/ArtistLinks';
import { showToast } from '../../../components/Toast';
import { getOrCreateAudio, getAnalyser } from '../audioService';
import { fetchUnifiedLyrics, type ResolvedLyrics } from '../lyricsService';
import { useLyricsSettingsStore } from '../../settings/lyricsSettingsStore';

interface LyricLine {
  time?: number; // seconds
  text: string;
}

function parseLyrics(rawLyrics: string, isSynced: boolean): LyricLine[] {
  if (!rawLyrics) return [];
  const lines = rawLyrics.split('\n');
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      result.push({ text: '' });
      continue;
    }

    const matches = [...trimmed.matchAll(timeRegex)];
    if (matches.length > 0) {
      const cleanText = trimmed.replace(timeRegex, '').trim();
      for (const match of matches) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
        const totalSeconds = min * 60 + sec + ms / 1000;
        result.push({ time: totalSeconds, text: cleanText });
      }
    } else {
      result.push({ text: trimmed });
    }
  }

  if (isSynced && result.some((r) => r.time !== undefined)) {
    return result.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  }
  return result;
}

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
    setTrack,
  } = usePlayerStore();

  const isLiked = useFavouritesStore((s) => s.isLiked(currentTrack?.id));
  const toggleLikeTrack = useFavouritesStore((s) => s.toggleLikeTrack);

  // Lyrics state
  const { enableZvuk, enableLrclib, priority } = useLyricsSettingsStore();
  const [lyricsInfo, setLyricsInfo] = useState<ResolvedLyrics | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isUserScrollingRef = useRef(false);
  const userScrollTimeoutRef = useRef<number | null>(null);
  const [showSyncButton, setShowSyncButton] = useState(false);

  // Sub-second precision for ultra-smooth 60fps karaoke line progress & audio-reactivity
  const [smoothTime, setSmoothTime] = useState(progress);
  const [audioVocalEnergy, setAudioVocalEnergy] = useState(0);

  useEffect(() => {
    if (fullscreenTab !== 'lyrics' || !isPlaying) {
      setSmoothTime(progress);
      setAudioVocalEnergy(0);
      return;
    }
    let animId: number;
    const freqData = new Uint8Array(32);
    let smoothedVocal = 0;

    const tick = () => {
      const audio = getOrCreateAudio();
      if (audio && !audio.paused) {
        setSmoothTime(audio.currentTime);
      }

      // Sample vocal frequency band (mid frequencies bins 4-10)
      const analyser = getAnalyser();
      if (analyser) {
        analyser.getByteFrequencyData(freqData);
        let vocalSum = 0;
        for (let i = 4; i <= 10; i++) {
          vocalSum += freqData[i];
        }
        const rawVocal = vocalSum / (7 * 255);
        smoothedVocal += (rawVocal - smoothedVocal) * 0.28;
        setAudioVocalEnergy(smoothedVocal);
      }

      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [fullscreenTab, isPlaying, progress]);

  // More menu & sleep timer
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [coverGlowRgb, setCoverGlowRgb] = useState<string>('80, 80, 95');

  // Extract Monet / ambient cover color
  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.palette) {
      const theme = extractMonetThemeFromPalette(currentTrack.palette);
      setCoverGlowRgb(theme.glowRgb);
    } else if (currentTrack.cover_url) {
      extractMonetFromImage(currentTrack.cover_url).then((theme) => {
        setCoverGlowRgb(theme.glowRgb);
      });
    }
  }, [currentTrack]);

  // Fetch unified lyrics (Zvuk + LRCLIB with configurable priority)
  useEffect(() => {
    if (!currentTrack || !isFullscreenPlayerOpen) return;
    let isCancelled = false;

    setLyricsLoading(true);
    fetchUnifiedLyrics(currentTrack)
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
  }, [currentTrack?.id, isFullscreenPlayerOpen, enableZvuk, enableLrclib, priority]);

  // Parse lyrics
  const parsedLyrics = useMemo(() => {
    if (!lyricsInfo?.lyrics) return [];
    return parseLyrics(lyricsInfo.lyrics, !!lyricsInfo.is_synced);
  }, [lyricsInfo]);

  // Find active synced lyric index using smoothTime
  const activeLyricIndex = useMemo(() => {
    if (!lyricsInfo?.is_synced || parsedLyrics.length === 0) return -1;
    let activeIdx = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
      const lineTime = parsedLyrics[i].time;
      if (lineTime !== undefined && lineTime <= smoothTime) {
        activeIdx = i;
      } else if (lineTime !== undefined && lineTime > smoothTime) {
        break;
      }
    }
    return activeIdx;
  }, [lyricsInfo?.is_synced, parsedLyrics, smoothTime]);

  // Active line progress percentage (0.0 to 1.0) with audio-reactive vocal modulation
  const activeLineProgress = useMemo(() => {
    if (activeLyricIndex < 0 || activeLyricIndex >= parsedLyrics.length) return 0;
    const currentLineTime = parsedLyrics[activeLyricIndex].time;
    if (currentLineTime === undefined) return 0;

    const nextLineTime =
      activeLyricIndex < parsedLyrics.length - 1 && parsedLyrics[activeLyricIndex + 1].time !== undefined
        ? parsedLyrics[activeLyricIndex + 1].time!
        : currentLineTime + 4;

    const lineDuration = Math.max(0.6, nextLineTime - currentLineTime);
    const nominalFraction = Math.min(1, Math.max(0, (smoothTime - currentLineTime) / lineDuration));

    // Audio-reactive modulation:
    // When the singer vocalizes with higher intensity, progress dynamically leaps forward (up to +4%),
    // giving an organic sensation of singing in real time rather than mechanical linear pacing.
    const vocalPush = (audioVocalEnergy - 0.28) * 0.04;
    return Math.min(1, Math.max(0, nominalFraction + vocalPush));
  }, [activeLyricIndex, parsedLyrics, smoothTime, audioVocalEnergy]);

  // Center active line in lyrics container
  const scrollToActiveLine = useCallback((smooth = true) => {
    const container = lyricsContainerRef.current;
    if (!container || activeLyricIndex < 0) return;
    const activeEl = lineRefs.current[activeLyricIndex];
    if (!activeEl) return;

    const containerHeight = container.clientHeight;
    const elTop = activeEl.offsetTop;
    const elHeight = activeEl.clientHeight;
    const targetScroll = elTop - containerHeight / 2 + elHeight / 2;

    container.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: smooth ? 'smooth' : 'auto',
    });
    setShowSyncButton(false);
  }, [activeLyricIndex]);

  // Handle user manual scroll: pause auto-scroll for 4.5s and offer quick re-sync
  const handleUserScroll = useCallback(() => {
    isUserScrollingRef.current = true;
    setShowSyncButton(true);

    if (userScrollTimeoutRef.current) {
      window.clearTimeout(userScrollTimeoutRef.current);
    }

    userScrollTimeoutRef.current = window.setTimeout(() => {
      isUserScrollingRef.current = false;
      setShowSyncButton(false);
      scrollToActiveLine(true);
    }, 4500);
  }, [scrollToActiveLine]);

  // Auto-scroll on active lyric line change
  useEffect(() => {
    if (fullscreenTab === 'lyrics' && activeLyricIndex >= 0 && !isUserScrollingRef.current) {
      scrollToActiveLine(true);
    }
  }, [activeLyricIndex, fullscreenTab, scrollToActiveLine]);

  // Immediate centering when opening lyrics tab
  useEffect(() => {
    if (fullscreenTab === 'lyrics' && activeLyricIndex >= 0) {
      isUserScrollingRef.current = false;
      setShowSyncButton(false);
      const timer = window.setTimeout(() => {
        scrollToActiveLine(false);
      }, 80);
      return () => window.clearTimeout(timer);
    }
  }, [fullscreenTab]);

  // Keyboard controls
  useEffect(() => {
    if (!isFullscreenPlayerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept typing in inputs
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closeFullscreenPlayer();
      } else if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(Math.min(duration, progress + 5));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo(Math.max(0, progress - 5));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume(Math.min(1, volume + 0.05));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume(Math.max(0, volume - 0.05));
      } else if (e.key === 'KeyL' || e.key === 'l' || e.key === 'д' || e.key === 'Д') {
        if (currentTrack) toggleLikeTrack(currentTrack.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isFullscreenPlayerOpen,
    currentTrack,
    duration,
    progress,
    volume,
    togglePlay,
    seekTo,
    setVolume,
    toggleLikeTrack,
    closeFullscreenPlayer,
  ]);

  if (!isFullscreenPlayerOpen || !currentTrack) return null;

  const upcomingQueue = queue.slice(queueIndex + 1);

  return (
    <div
      className={`fullscreen-overlay ${isZenMode ? 'fullscreen-overlay--zen' : ''}`}
      style={
        {
          '--cover-glow-rgb': coverGlowRgb,
        } as React.CSSProperties
      }
    >
      {/* Dynamic ambient backdrop */}
      <div className="fullscreen-overlay__ambient" />
      <div className="fullscreen-overlay__vignette" />

      {/* Top Header */}
      <header className="fullscreen-overlay__header">
        <div className="fullscreen-overlay__header-spacer" />

        {/* Bracketed Tabs: [ О ТРЕКЕ / СЛОВА / ОЧЕРЕДЬ ] */}
        <nav className="fullscreen-tabs" aria-label="Режимы полноэкранного плеера">
          <span className="fullscreen-tabs__bracket">[</span>
          <button
            type="button"
            className={`fullscreen-tabs__btn ${fullscreenTab === 'track' ? 'fullscreen-tabs__btn--active' : ''}`}
            onClick={() => setFullscreenTab('track')}
          >
            О ТРЕКЕ
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
                src={currentTrack.cover_url}
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
              <div style={{ position: 'relative' }}>
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
                        navigator.clipboard.writeText(`${currentTrack.artist} - ${currentTrack.title}`);
                        showToast('Название трека скопировано', 'info');
                      }}
                    >
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
                        Перейти к альбому
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
            <div className="fullscreen-controls__volume">
              <button
                type="button"
                className="fullscreen-icon-btn"
                onClick={toggleMute}
                title={isMuted ? 'Включить звук' : 'Выключить звук'}
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
                title={`Громкость: ${Math.round(volume * 100)}%`}
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
                  className={`fullscreen-quality-badge ${quality === 'flac' ? 'fullscreen-quality-badge--hifi' : ''}`}
                  onClick={() => setQualityMenuOpen((p) => !p)}
                  title="Качество звука"
                >
                  {quality === 'flac' ? 'HiFi' : quality === 'high' ? 'HQ' : 'SQ'}
                </button>

                {qualityMenuOpen && (
                  <div className="fullscreen-dropdown-menu fullscreen-dropdown-menu--right">
                    <button
                      type="button"
                      className={quality === 'flac' ? 'fullscreen-dropdown-menu__active' : ''}
                      onClick={() => {
                        setQuality('flac');
                        setQualityMenuOpen(false);
                      }}
                    >
                      HiFi • FLAC ~1411 кбит/с
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
                      SQ • MP3 192 кбит/с
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Lyrics View */}
        {fullscreenTab === 'lyrics' && (
          <div
            className="fullscreen-lyrics-pane"
            ref={lyricsContainerRef}
            onWheel={handleUserScroll}
            onTouchMove={handleUserScroll}
          >
            {/* Audio-reactive ambient aura behind singing focus area */}
            <div className="fullscreen-lyrics-pane__ambient" aria-hidden="true" />

            {/* Source indicator badge */}
            {lyricsInfo && !lyricsLoading && (
              <div className="fullscreen-lyrics-source-tag" title={`Источник текста: ${lyricsInfo.sourceLabel} (${lyricsInfo.is_synced ? 'караоке / тайминги' : 'статичный текст'})`}>
                <span className="fullscreen-lyrics-source-tag__name">{lyricsInfo.sourceLabel}</span>
                <span className={`fullscreen-lyrics-source-tag__type ${lyricsInfo.is_synced ? 'fullscreen-lyrics-source-tag__type--synced' : ''}`}>
                  {lyricsInfo.is_synced ? 'LRC' : 'TXT'}
                </span>
              </div>
            )}

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
                        className={`fullscreen-lyric-line ${
                          isActive
                            ? 'fullscreen-lyric-line--active'
                            : isPast
                            ? 'fullscreen-lyric-line--past'
                            : isFuture
                            ? 'fullscreen-lyric-line--future'
                            : ''
                        } ${isSynced ? 'fullscreen-lyric-line--clickable' : ''}`}
                        style={{
                          '--line-fill': isActive ? `${(activeLineProgress * 100).toFixed(1)}%` : isPast ? '100%' : '0%',
                          filter: isSynced ? `blur(${blurAmount}px)` : 'none',
                          opacity: isSynced ? opacityAmount : 0.85,
                        } as React.CSSProperties}
                        onClick={() => {
                          if (line.time !== undefined) {
                            isUserScrollingRef.current = false;
                            setShowSyncButton(false);
                            seekTo(line.time);
                            window.setTimeout(() => scrollToActiveLine(true), 50);
                          }
                        }}
                      >
                        <span className="fullscreen-lyric-line__text">
                          {line.text || '\u00A0'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Floating Return to Current Line button */}
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
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                    <span>К текущей строчке</span>
                  </button>
                )}
              </>
            ) : (
              <div className="fullscreen-lyrics-pane__empty">
                <p>Текст песни пока недоступен для этого трека</p>
              </div>
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
                  <div className="fullscreen-queue-item__title">{currentTrack.title}</div>
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
                        onClick={() => setTrack(track)}
                      >
                        <div className="fullscreen-queue-item__thumb">
                          {track.cover_url ? (
                            <img src={track.cover_url} alt={track.title} />
                          ) : (
                            <span>🎵</span>
                          )}
                        </div>
                        <div className="fullscreen-queue-item__meta">
                          <div className="fullscreen-queue-item__title">{track.title}</div>
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

      {/* Bottom Left Corner: Zen / Cinema mode toggle icon */}
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
      </footer>
    </div>
  );
}
