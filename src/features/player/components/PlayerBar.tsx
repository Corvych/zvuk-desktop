import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore, type AudioQuality } from '../playerStore';
import { useFavouritesStore } from '../../favourites/favouritesStore';

import { formatTime } from '../../../lib/formatters';
import { showToast } from '../../../components/Toast';
import { ArtistLinks } from '../../../components/ArtistLinks';
import { LikeButton } from '../../../components/LikeButton';


const QUALITY_LIST: { id: AudioQuality; badge: string; label: string; desc: string }[] = [
  { id: 'flac', badge: 'HiFi', label: 'HiFi', desc: 'Без потерь • FLAC ~1411 кбит/с' },
  { id: 'high', badge: 'HQ', label: 'HQ', desc: 'Высокое • MP3 320 кбит/с' },
  { id: 'mid', badge: 'SQ', label: 'SQ', desc: 'Стандартное • MP3 192 кбит/с' },
];

export function PlayerBar() {
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
    setQuality,
    togglePlay,
    nextTrack,
    previousTrack,
    seekTo,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    openFullscreenPlayer,
  } = usePlayerStore();

  const navigate = useNavigate();
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const qualityMenuRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    if (!showQualityMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (qualityMenuRef.current && !qualityMenuRef.current.contains(e.target as Node)) {
        setShowQualityMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowQualityMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showQualityMenu]);

  const isLiked = useFavouritesStore((s) => s.isLiked(currentTrack?.id));
  const toggleLikeTrack = useFavouritesStore((s) => s.toggleLikeTrack);

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    seekTo(percent * duration);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  return (
    <div className="player-bar player-area">
      {/* Left: Track Info */}
      <div className="player-bar__track">
        {currentTrack ? (
          <>
            <div
              className="player-bar__cover"
              style={{ cursor: 'pointer' }}
              onClick={() => openFullscreenPlayer('track')}
              title="Открыть полноэкранный плеер"
            >
              {currentTrack.cover_url && (
                <img src={currentTrack.cover_url} alt={currentTrack.title} />
              )}
            </div>
            <div className="player-bar__info">
              <div
                className="player-bar__title"
                style={{ cursor: currentTrack.album_id ? 'pointer' : 'default' }}
                onClick={() => currentTrack.album_id && navigate(`/album/${currentTrack.album_id}`)}
                title={currentTrack.title}
              >
                {currentTrack.title}
              </div>
              <div className="player-bar__artist">
                <ArtistLinks
                  artists={currentTrack.artists}
                  artistId={currentTrack.artist_id}
                  artistName={currentTrack.artist}
                />
              </div>
            </div>


            <LikeButton
              isLiked={!!isLiked}
              onToggle={() => currentTrack && toggleLikeTrack(currentTrack.id)}
              title={isLiked ? 'Удалить из любимых (L)' : 'Добавить в любимое (L)'}
              size={18}
            />
          </>
        ) : (
          <div className="player-bar__info">
            <div className="player-bar__title" style={{ color: 'var(--text-muted)' }}>
              Ничего не играет
            </div>
          </div>
        )}
      </div>

      {/* Center: Controls */}
      <div className="player-bar__controls">
        <div className="player-bar__buttons">
          <button
            className={`player-bar__btn ${shuffle ? 'player-bar__btn--active' : ''}`}
            onClick={toggleShuffle}
            title="Перемешать"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4H6L10 12H14M2 12H6L10 4H14M12 3L14 4L12 5M12 11L14 12L12 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <button className="player-bar__btn" onClick={previousTrack} title="Предыдущий">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 3L6 8L12 13" fill="currentColor"/>
              <path d="M4 3V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>

          <button
            className="player-bar__btn player-bar__btn--play"
            onClick={togglePlay}
            title={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            {isPlaying ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="4" y="3" width="3" height="10" rx="0.5" fill="currentColor"/>
                <rect x="9" y="3" width="3" height="10" rx="0.5" fill="currentColor"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M5 3L13 8L5 13V3Z" fill="currentColor"/>
              </svg>
            )}
          </button>

          <button className="player-bar__btn" onClick={nextTrack} title="Следующий">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 3L10 8L4 13" fill="currentColor"/>
              <path d="M12 3V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>

          <button
            className={`player-bar__btn ${repeat !== 'off' ? 'player-bar__btn--active' : ''}`}
            onClick={cycleRepeat}
            title={repeat === 'one' ? 'Повторять трек' : repeat === 'all' ? 'Повторять все' : 'Повтор выкл'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 6C2 4.34 3.34 3 5 3H11C12.66 3 14 4.34 14 6V7M14 10C14 11.66 12.66 13 11 13H5C3.34 13 2 11.66 2 10V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <path d="M12 5L14 7L16 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 11L2 9L0 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              {repeat === 'one' && <text x="7" y="10" fontSize="7" fill="currentColor" fontWeight="bold">1</text>}
            </svg>
          </button>
        </div>

        {/* Progress Bar */}
        <div className="progress-bar">
          <span className="progress-bar__time">{formatTime(progress)}</span>
          <div className="progress-bar__track" onClick={handleProgressClick}>
            <div className="progress-bar__fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="progress-bar__time">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right: Volume & Extras */}
      <div className="player-bar__right">
        {/* Quality Switcher */}
        <div className="player-quality-container" ref={qualityMenuRef}>
          <button
            type="button"
            className={`quality-badge-btn quality-badge-btn--${
              quality === 'flac' ? 'hifi' : quality === 'high' ? 'hq' : 'sq'
            } ${showQualityMenu ? 'quality-badge-btn--active' : ''}`}
            onClick={() => setShowQualityMenu((prev) => !prev)}
            title={`Качество звука: ${
              quality === 'flac' ? 'HiFi (Без потерь)' : quality === 'high' ? 'HQ (Высокое)' : 'SQ (Стандартное)'
            }`}
            aria-label="Выбор качества звука"
          >
            {quality === 'flac' ? 'HiFi' : quality === 'high' ? 'HQ' : 'SQ'}
          </button>

          {showQualityMenu && (
            <div className="quality-menu">
              <div className="quality-menu__header">Качество звука</div>
              <div className="quality-menu__list">
                {QUALITY_LIST.map((item) => {
                  const isSelected = quality === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`quality-menu__item ${isSelected ? 'quality-menu__item--active' : ''}`}
                      onClick={() => {
                        if (quality !== item.id) {
                          setQuality(item.id);
                          showToast(`Качество ${item.badge} применится со следующего трека`, 'info');
                        }
                        setShowQualityMenu(false);
                      }}
                    >
                      <span
                        className={`quality-badge quality-badge--${
                          item.id === 'flac' ? 'hifi' : item.id === 'high' ? 'hq' : 'sq'
                        }`}
                      >
                        {item.badge}
                      </span>
                      <div className="quality-menu__info">
                        <div className="quality-menu__label">{item.label}</div>
                        <div className="quality-menu__desc">{item.desc}</div>
                      </div>
                      {isSelected && (
                        <svg
                          className="quality-menu__check"
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
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="volume-control">
          <button className="player-bar__btn" onClick={toggleMute} title="Громкость">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {isMuted || volume === 0 ? (
                <>
                  <path d="M2 6H4L8 3V13L4 10H2V6Z" fill="currentColor"/>
                  <path d="M11 6L14 9M14 6L11 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </>
              ) : volume < 0.5 ? (
                <>
                  <path d="M2 6H4L8 3V13L4 10H2V6Z" fill="currentColor"/>
                  <path d="M11 5.5C11.8 6.5 11.8 9.5 11 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </>
              ) : (
                <>
                  <path d="M2 6H4L8 3V13L4 10H2V6Z" fill="currentColor"/>
                  <path d="M11 4C12.5 5.5 12.5 10.5 11 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  <path d="M13 2.5C15 4.5 15 11.5 13 13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </>
              )}
            </svg>
          </button>
          <input
            type="range"
            className="volume-control__slider"
            min="0"
            max="1"
            step="0.01"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
          />
        </div>

        {/* Lyrics, Queue, Fullscreen Buttons */}
        <button
          className="player-bar__btn"
          onClick={() => openFullscreenPlayer('lyrics')}
          title="Текст песни"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>

        <button
          className="player-bar__btn"
          onClick={() => openFullscreenPlayer('queue')}
          title="Очередь воспроизведения"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </button>

        <button
          className="player-bar__btn"
          onClick={() => openFullscreenPlayer('track')}
          title="Полноэкранный плеер (F)"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </div>
    </div>
  );
}
