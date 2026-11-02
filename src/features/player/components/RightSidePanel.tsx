import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { usePlayerStore } from '../playerStore';
import { useFavouritesStore } from '../../favourites/favouritesStore';
import { useDislikesStore } from '../../dislikes/dislikesStore';
import { formatTime } from '../../../lib/formatters';
import { CrystalIcon } from '../../../components/CrystalIcon';
import { LikeButton } from '../../../components/LikeButton';
import { DislikeButton } from '../../../components/DislikeButton';
import { parseLyrics, type LyricLine } from '../lyricsParser';
import { InstrumentalBreakIndicator } from './InstrumentalBreakIndicator';
import { getOrCreateAudio } from '../audioService';
import {
  fetchUnifiedLyrics,
  probeAllSources,
  fetchLyricsBySource,
  getCachedUnifiedLyrics,
  getCachedProbeResults,
  type ResolvedLyrics,
  type SourceAvailability,
} from '../lyricsService';
import { useLyricsSettingsStore } from '../../settings/lyricsSettingsStore';
import { useWindowFreezeStore, getIsWindowFrozen } from '../../../lib/windowFreezeStore';

type LyricsSourceId = 'zvuk' | 'betterlyrics' | 'netease' | 'lrclib';

export function RightSidePanel() {
  const {
    currentTrack,
    isPlaying,
    progress,
    queue,
    queueIndex,
    queueContext,
    isFetchingMoreQueue,
    sidePanelTab,
    closeSidePanel,
    setSidePanelTab,
    openFullscreenPlayer,
    playQueueTrack,
    seekTo,
    loadMoreQueueTracks,
  } = usePlayerStore();

  const isLiked = useFavouritesStore((s) => s.isLiked(currentTrack?.id));
  const toggleLikeTrack = useFavouritesStore((s) => s.toggleLikeTrack);
  const isDisliked = useDislikesStore((s) => s.isDisliked(currentTrack?.id));
  const toggleDislikeTrack = useDislikesStore((s) => s.toggleDislikeTrack);

  // Lyrics settings
  const {
    enableZvuk,
    enableBetterLyrics,
    enableNetease,
    enableLrclib,
    timingOffset,
  } = useLyricsSettingsStore();

  // Sub-second precision for ultra-smooth 60fps karaoke word fill & line scrolling
  const [smoothTime, setSmoothTime] = useState(progress);

  useEffect(() => {
    if (sidePanelTab !== 'lyrics' || !isPlaying) {
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
  }, [sidePanelTab, isPlaying]);

  // Synchronize smoothTime immediately on seek/track change
  useEffect(() => {
    setSmoothTime(progress);
  }, [progress]);

  // Lyrics local state
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
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const sourceMenuRef = useRef<HTMLDivElement>(null);

  // Lyrics scroll state
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isUserScrollingRef = useRef(false);
  const userScrollTimeoutRef = useRef<number | null>(null);
  const [showSyncButton, setShowSyncButton] = useState(false);

  // Fetch or update lyrics whenever track changes
  useEffect(() => {
    if (!currentTrack) {
      setLyricsInfo(null);
      setLyricsLoading(false);
      return;
    }

    let isMounted = true;
    const cached = getCachedUnifiedLyrics(currentTrack.id, null);
    if (cached !== undefined) {
      setLyricsInfo(cached);
      setLyricsLoading(false);
    } else {
      setLyricsLoading(true);
      fetchUnifiedLyrics(currentTrack)
        .then((res) => {
          if (isMounted) {
            setLyricsInfo(res);
            setLyricsLoading(false);
          }
        })
        .catch(() => {
          if (isMounted) setLyricsLoading(false);
        });
    }

    probeAllSources(currentTrack)
      .then((probes) => {
        if (isMounted) setSourcesAvailability(probes);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [currentTrack]);

  // Click outside source dropdown
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

  // Parse lyrics lines
  const parsedLyrics = useMemo<LyricLine[]>(() => {
    if (!lyricsInfo || !lyricsInfo.lyrics) return [];
    return parseLyrics(lyricsInfo.lyrics, lyricsInfo.is_synced);
  }, [lyricsInfo]);

  // Effective audio playback time with user-configured offset
  const effectiveSmoothTime = Math.max(0, smoothTime + timingOffset);

  // Calculate active lyric index with sub-second precision
  const activeLyricIndex = useMemo(() => {
    if (!lyricsInfo?.is_synced || parsedLyrics.length === 0) return -1;

    let activeIdx = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
      const lineTime = parsedLyrics[i].time;
      if (lineTime !== undefined && lineTime <= effectiveSmoothTime + 0.12) {
        activeIdx = i;
      } else {
        break;
      }
    }
    return activeIdx;
  }, [parsedLyrics, effectiveSmoothTime, lyricsInfo?.is_synced]);

  // Precise helper to center any lyric line by index
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

  // Check whether active line is currently inside visible scroll area
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

    const topSafe = containerHeight * 0.18;
    const bottomSafe = containerHeight * 0.82;

    if (elBottom < topSafe || elTop > bottomSafe) {
      setShowSyncButton(true);
    } else {
      setShowSyncButton(false);
    }
  }, [activeLyricIndex]);

  // Auto-scroll on active lyric line change when user is not manually scrolling
  useEffect(() => {
    if (sidePanelTab === 'lyrics' && activeLyricIndex >= 0) {
      if (!isUserScrollingRef.current) {
        centerLine(activeLyricIndex, true);
        setShowSyncButton(false);
      } else {
        checkActiveLineVisibility();
      }
    }
  }, [activeLyricIndex, sidePanelTab, centerLine, checkActiveLineVisibility]);

  // Immediate centering when opening lyrics tab
  useEffect(() => {
    if (sidePanelTab === 'lyrics' && activeLyricIndex >= 0) {
      isUserScrollingRef.current = false;
      setShowSyncButton(false);
      const timer = window.setTimeout(() => {
        centerLine(activeLyricIndex, false);
      }, 60);
      return () => window.clearTimeout(timer);
    }
  }, [sidePanelTab, activeLyricIndex, centerLine]);

  const handleLyricsScroll = () => {
    isUserScrollingRef.current = true;
    checkActiveLineVisibility();

    if (userScrollTimeoutRef.current) {
      window.clearTimeout(userScrollTimeoutRef.current);
    }
    userScrollTimeoutRef.current = window.setTimeout(() => {
      const container = lyricsContainerRef.current;
      if (container && activeLyricIndex >= 0) {
        const activeEl = lineRefs.current[activeLyricIndex];
        if (activeEl) {
          const elTop = activeEl.offsetTop - container.scrollTop;
          const elBottom = elTop + activeEl.clientHeight;
          if (elBottom >= container.clientHeight * 0.25 && elTop <= container.clientHeight * 0.75) {
            isUserScrollingRef.current = false;
            setShowSyncButton(false);
          }
        }
      }
    }, 6000);
  };

  const handleSourceSelect = async (sourceId: LyricsSourceId) => {
    if (!currentTrack) return;
    setSourceMenuOpen(false);
    setLyricsLoading(true);
    try {
      const res = await fetchLyricsBySource(currentTrack, sourceId);
      setLyricsInfo(res);
    } catch (e) {
      console.warn('[RightSidePanel] Failed to switch lyrics source:', e);
    } finally {
      setLyricsLoading(false);
    }
  };

  if (!sidePanelTab) return null;

  const upcomingQueue = queue.slice(queueIndex + 1);

  return (
    <aside className="right-side-panel">
      {/* Top Header */}
      <div className="right-side-panel__header">
        <div className="right-side-panel__tabs">
          <button
            type="button"
            className={`right-side-panel__tab ${
              sidePanelTab === 'queue' ? 'right-side-panel__tab--active' : ''
            }`}
            onClick={() => setSidePanelTab('queue')}
          >
            <span>Очередь</span>
            {upcomingQueue.length > 0 && (
              <span className="right-side-panel__badge">{upcomingQueue.length}</span>
            )}
          </button>
          <button
            type="button"
            className={`right-side-panel__tab ${
              sidePanelTab === 'lyrics' ? 'right-side-panel__tab--active' : ''
            }`}
            onClick={() => setSidePanelTab('lyrics')}
          >
            <span>Текст песни</span>
            {lyricsInfo && (
              <span className="right-side-panel__badge right-side-panel__badge--accent">
                {lyricsInfo.has_word_sync ? 'Караоке' : lyricsInfo.is_synced ? 'LRC' : 'Текст'}
              </span>
            )}
          </button>
        </div>

        <div className="right-side-panel__actions">
          <button
            type="button"
            className="right-side-panel__action-btn"
            onClick={() => openFullscreenPlayer(sidePanelTab)}
            title="Развернуть во весь экран"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>

          <button
            type="button"
            className="right-side-panel__action-btn"
            onClick={closeSidePanel}
            title="Закрыть панель (Esc)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="right-side-panel__body">
        {/* TAB: QUEUE */}
        {sidePanelTab === 'queue' && (
          <div className="right-side-panel__queue-view">
            {/* Current Playing Track */}
            {currentTrack && (
              <div className="side-queue-section">
                <div className="side-queue-section__title">СЕЙЧАС ИГРАЕТ</div>
                <div className="side-queue-item side-queue-item--current">
                  <div className="side-queue-item__thumb">
                    {currentTrack.cover_url ? (
                      <img src={currentTrack.cover_url} alt={currentTrack.title} />
                    ) : (
                      <span>🎵</span>
                    )}
                  </div>
                  <div className="side-queue-item__meta">
                    <div className="side-queue-item__title" title={currentTrack.title}>
                      <span>{currentTrack.title}</span>
                      {currentTrack.has_flac && (
                        <span className="track-badge-hifi" title="HiFi Audio (Lossless)"><CrystalIcon size={11} /></span>
                      )}
                    </div>
                    <div className="side-queue-item__artist" title={currentTrack.artist}>
                      {currentTrack.artist}
                    </div>
                  </div>
                  <div className="side-queue-item__actions">
                    <LikeButton
                      isLiked={!!isLiked}
                      onToggle={() => toggleLikeTrack(currentTrack.id)}
                      size={16}
                    />
                    <DislikeButton
                      isDisliked={!!isDisliked}
                      onToggle={() => toggleDislikeTrack(currentTrack.id)}
                      size={16}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Upcoming Queue */}
            <div className="side-queue-section side-queue-section--upcoming">
              <div className="side-queue-section__header">
                <span className="side-queue-section__title">
                  ДАЛЕЕ В ОЧЕРЕДИ {upcomingQueue.length > 0 && `(${upcomingQueue.length})`}
                </span>
              </div>

              {upcomingQueue.length > 0 ? (
                <div className="side-queue-list">
                  {upcomingQueue.map((track, i) => {
                    const actualIdx = queueIndex + 1 + i;
                    return (
                      <div
                        key={`${track.id}-${actualIdx}`}
                        className="side-queue-item"
                        onClick={() => playQueueTrack(actualIdx)}
                      >
                        <span className="side-queue-item__index">{i + 1}</span>
                        <div className="side-queue-item__thumb">
                          {track.cover_url ? (
                            <img src={track.cover_url} alt={track.title} />
                          ) : (
                            <span>🎵</span>
                          )}
                        </div>
                        <div className="side-queue-item__meta">
                          <div className="side-queue-item__title" title={track.title}>
                            <span>{track.title}</span>
                            {track.has_flac && (
                              <span className="track-badge-hifi" title="HiFi Audio (Lossless)"><CrystalIcon size={11} /></span>
                            )}
                          </div>
                          <div className="side-queue-item__artist" title={track.artist}>
                            {track.artist}
                          </div>
                        </div>
                        <div className="side-queue-item__duration">
                          {formatTime(track.duration)}
                        </div>
                      </div>
                    );
                  })}

                  {queueContext?.hasNext && (
                    <button
                      type="button"
                      className="side-queue-load-more"
                      onClick={() => loadMoreQueueTracks()}
                      disabled={isFetchingMoreQueue}
                    >
                      {isFetchingMoreQueue ? 'Загрузка...' : 'Загрузить ещё треки'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="side-queue-empty">
                  <span>Очередь воспроизведения пуста</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: LYRICS */}
        {sidePanelTab === 'lyrics' && (
          <div className="right-side-panel__lyrics-view">
            {/* Top Source HUD */}
            <div className="side-lyrics-hud">
              <div className="side-lyrics-source-selector" ref={sourceMenuRef}>
                <button
                  type="button"
                  className={`side-lyrics-source-tag ${
                    sourceMenuOpen ? 'side-lyrics-source-tag--open' : ''
                  }`}
                  onClick={() => setSourceMenuOpen((p) => !p)}
                  title="Выбрать источник текста"
                >
                  <span className="side-lyrics-source-tag__name">
                    {lyricsInfo ? lyricsInfo.sourceLabel : 'Поиск текста...'}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {sourceMenuOpen && (
                  <div className="side-lyrics-source-menu">
                    <div className="side-lyrics-source-menu__title">ИСТОЧНИК ТЕКСТА</div>
                    {(
                      [
                        { id: 'betterlyrics', label: 'Apple Music / Better Lyrics', enabled: enableBetterLyrics },
                        { id: 'zvuk', label: 'Звук', enabled: enableZvuk },
                        { id: 'netease', label: 'NetEase Cloud', enabled: enableNetease },
                        { id: 'lrclib', label: 'LRCLIB (Community)', enabled: enableLrclib },
                      ] as const
                    ).map((src) => {
                      const avail = sourcesAvailability[src.id];
                      const isCurrent = lyricsInfo?.source === src.id;
                      return (
                        <button
                          key={src.id}
                          type="button"
                          className={`side-lyrics-source-item ${
                            isCurrent ? 'side-lyrics-source-item--current' : ''
                          }`}
                          onClick={() => handleSourceSelect(src.id)}
                        >
                          <span className="side-lyrics-source-item__name">{src.label}</span>
                          {avail && avail.status === 'available' && (
                            <span className="side-lyrics-source-item__badge">
                              {avail.hasWordSync ? 'Караоке' : avail.isSynced ? 'LRC' : 'Текст'}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Lyrics Scrollable Container */}
            <div
              ref={lyricsContainerRef}
              className="side-lyrics-container"
              onScroll={handleLyricsScroll}
            >
              {lyricsLoading ? (
                <div className="side-lyrics-status">
                  <div className="side-lyrics-spinner" />
                  <span>Загрузка текста песни...</span>
                </div>
              ) : parsedLyrics.length > 0 ? (
                <div className="side-lyrics-list">
                  {parsedLyrics.map((line, idx) => {
                    const isActive = idx === activeLyricIndex;
                    const isPassed = activeLyricIndex >= 0 && idx < activeLyricIndex;
                    const isLinePassed = line.isInstrumental
                      ? effectiveSmoothTime >= (line.endTime ?? (line.time ?? 0) + 4)
                      : isPassed;
                    return (
                      <div
                        key={idx}
                        ref={(el) => {
                          lineRefs.current[idx] = el;
                        }}
                        className={`side-lyric-line ${
                          isActive ? 'side-lyric-line--active' : ''
                        } ${isPassed ? 'side-lyric-line--passed' : ''} ${
                          line.isInstrumental ? 'side-lyric-line--instrumental' : ''
                        } ${
                          line.isInstrumental && isLinePassed ? 'side-lyric-line--instrumental-collapsed' : ''
                        }`}
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
                            size="medium"
                          />
                        ) : line.hasEnhancedTimings && line.words.length > 0 ? (
                          <span className="side-lyric-line__words">
                            {line.words.map((word, wIdx) => {
                              const isWordPast = effectiveSmoothTime >= word.endTime;
                              const isWordActive =
                                effectiveSmoothTime >= word.time && effectiveSmoothTime < word.endTime;
                              const wordDuration = Math.max(0.06, word.endTime - word.time);
                              const wordFill = isWordPast
                                ? 100
                                : isWordActive
                                ? Math.min(
                                    100,
                                    Math.max(
                                      0,
                                      ((effectiveSmoothTime - word.time) / wordDuration) * 100
                                    )
                                  )
                                : 0;

                              return (
                                <span
                                  key={wIdx}
                                  className={`side-lyric-word ${
                                    isWordActive
                                      ? 'side-lyric-word--active'
                                      : isWordPast
                                      ? 'side-lyric-word--past'
                                      : 'side-lyric-word--future'
                                  } ${!word.hasSpaceAfter ? 'side-lyric-word--no-space' : ''}`}
                                  style={{ '--word-fill': `${wordFill.toFixed(1)}%` } as React.CSSProperties}
                                >
                                  <span className="side-lyric-word__inner">{word.text}</span>
                                </span>
                              );
                            })}
                          </span>
                        ) : (
                          <span className="side-lyric-line__text">{line.text || '\u00A0'}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="side-lyrics-status">
                  <span>Текст для этого трека не найден</span>
                </div>
              )}
            </div>

            {/* Floating button to return to active line if user scrolled away */}
            {showSyncButton && activeLyricIndex >= 0 && (
              <button
                type="button"
                className="side-lyrics-return-btn"
                onClick={() => {
                  isUserScrollingRef.current = false;
                  setShowSyncButton(false);
                  centerLine(activeLyricIndex, true);
                }}
              >
                <span>К текущей строчке</span>
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
