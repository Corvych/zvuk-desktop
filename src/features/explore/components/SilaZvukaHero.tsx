import { useState, useRef, useEffect } from 'react';
import { usePlayerStore } from '../../player/playerStore';
import { getPersonalWave, getArtistRadio, getTrackRadio, type PersonalWaveOptions } from '../../../api';
import { useAudioReactive } from '../../player/useAudioReactive';
import { WaveTunerModal, type WaveTunerState } from './WaveTunerModal';
import { computeWaveMood } from '../utils/waveMood';
import { extractMonetThemeFromPalette, extractMonetFromImage, type MonetTheme } from '../../../lib/monetPalette';

function StreamStageBars({ isPlaying, color }: { isPlaying: boolean; color: string }) {
  return (
    <span className="stream-stage__bars" aria-hidden="true">
      <span
        className={`stream-stage__bar ${isPlaying ? 'is-playing' : ''}`}
        style={{ background: color }}
      />
      <span
        className={`stream-stage__bar ${isPlaying ? 'is-playing' : ''}`}
        style={{ background: color }}
      />
      <span
        className={`stream-stage__bar ${isPlaying ? 'is-playing' : ''}`}
        style={{ background: color }}
      />
    </span>
  );
}

export function SilaZvukaHero() {
  const {
    currentTrack,
    isPlaying,
    isWaveMode,
    waveType,
    waveArtist,
    waveTrack,
    waveMood,
    setWaveMood,
    togglePlay,
    startWave,
    startArtistWave,
    startTrackWave,
    setWaveOptions,
    nextTrack,
  } = usePlayerStore();

  const [loading, setLoading] = useState(false);
  const [showTuner, setShowTuner] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [monetTheme, setMonetTheme] = useState<MonetTheme | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isFavoriteFlow =
    isWaveMode &&
    waveType === 'personal' &&
    waveMood?.discovery === 'favorite' &&
    waveMood.dominantEmotions.length === 0;

  useEffect(() => {
    if (waveType === 'artist' && waveArtist) {
      if (waveArtist.palette) {
        setMonetTheme(extractMonetThemeFromPalette(waveArtist.palette));
      } else if (waveArtist.imageUrl) {
        extractMonetFromImage(waveArtist.imageUrl).then(setMonetTheme);
      } else {
        setMonetTheme(null);
      }
    } else if (waveType === 'track' && waveTrack) {
      if (waveTrack.palette) {
        setMonetTheme(extractMonetThemeFromPalette(waveTrack.palette));
      } else if (waveTrack.imageUrl) {
        extractMonetFromImage(waveTrack.imageUrl).then(setMonetTheme);
      } else {
        setMonetTheme(null);
      }
    } else if (isFavoriteFlow) {
      extractMonetFromImage('/favourites_album_cover.jpg').then(setMonetTheme);
    } else {
      setMonetTheme(null);
    }
  }, [waveType, waveArtist, waveTrack, isFavoriteFlow]);

  // Close more menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  const handleStartWave = async (customOptions?: PersonalWaveOptions) => {
    if (isWaveMode && currentTrack) {
      togglePlay();
      return;
    }

    if (waveType === 'artist' && waveArtist) {
      try {
        setLoading(true);
        const res = await getArtistRadio(waveArtist.id, 0, 25);
        if (res?.tracks && res.tracks.length > 0) {
          startArtistWave(waveArtist, res.tracks);
        }
      } catch (err) {
        console.error('[SilaZvukaHero] Failed to resume artist wave:', err);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (waveType === 'track' && waveTrack) {
      try {
        setLoading(true);
        const res = await getTrackRadio(waveTrack.id, 0, 25);
        if (res?.tracks && res.tracks.length > 0) {
          startTrackWave(waveTrack, res.tracks);
        }
      } catch (err) {
        console.error('[SilaZvukaHero] Failed to resume track wave:', err);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);
      const opts = customOptions || null;
      const waveTypeParam = waveMood?.discovery === 'favorite' ? 'FAVTRACKS' : null;
      const tracks = await getPersonalWave(null, 15, opts || undefined, 'AMAZME', waveTypeParam);
      if (tracks && tracks.length > 0) {
        startWave(tracks, opts);
      }
    } catch (err) {
      console.error('[SilaZvukaHero] Failed to start wave:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyWaveTuner = async (state: WaveTunerState) => {
    // Map 2D pad coordinates to mood and energy
    // Y: 1 is энергичное, -1 is спокойное -> energy
    // X: 1 is весёлое, -1 is грустное -> mood/valence
    const energy = Math.max(0, Math.min(1, (state.pad.y + 1) / 2));
    const valence = Math.max(0, Math.min(1, (state.pad.x + 1) / 2));

    const mood = computeWaveMood(state);
    setWaveMood(mood);

    let popularVal: number | null = null;
    if (state.popularity === 'popular') popularVal = 1;
    if (state.popularity === 'rare') popularVal = 0;

    const options: PersonalWaveOptions = {
      popular: popularVal,
      mood: `energy:${energy.toFixed(2)},fun:${valence.toFixed(2)}`,
    };

    setWaveOptions(options);

    const waveType = state.discovery === 'favorite' ? 'FAVTRACKS' : null;

    if (isWaveMode) {
      try {
        const tunedTracks = await getPersonalWave(null, 15, options, 'AMAZME', waveType);
        if (tunedTracks && tunedTracks.length > 0) {
          startWave(tunedTracks, options);
        }
      } catch (err) {
        console.error('[SilaZvukaHero] Failed to tune flow:', err);
      }
    }
  };

  const handleResetWave = async () => {
    setWaveMood(null);
    const defaultOptions: PersonalWaveOptions = {
      popular: null,
      mood: 'energy:0.5,fun:0.5',
    };
    setWaveOptions(defaultOptions);

    if (isWaveMode) {
      try {
        setLoading(true);
        const tracks = await getPersonalWave(null, 15, defaultOptions, 'AMAZME', null);
        if (tracks && tracks.length > 0) {
          startWave(tracks, defaultOptions);
        }
      } catch (err) {
        console.error('[SilaZvukaHero] Failed to reset flow:', err);
      } finally {
        setLoading(false);
      }
    }
  };

  const stageRef = useRef<HTMLDivElement>(null);
  useAudioReactive(stageRef);

  const isCurrentlyInWave = isWaveMode && !!currentTrack;

  return (
    <div
      ref={stageRef}
      className={`stream-stage ${isPlaying ? 'stream-stage--playing' : ''}`}
      style={{
        '--wave-mood-rgb': monetTheme ? monetTheme.glowRgb : undefined,
      } as React.CSSProperties}
    >
      {/* Dynamic Typography:
          1. If in artist wave mode: "В стиле [артист]"
          2. If custom wave mood: "Ваша [настроение] Сила Звука"
          3. Default: "Мой персональный поток"
      */}
      {waveType === 'artist' && waveArtist ? (
        <div className="stream-stage__title-box">
          <h1 className="stream-stage__line">В стиле</h1>
          <h1
            className="stream-stage__line stream-stage__line--accent"
            style={{
              color: monetTheme ? monetTheme.accentColor : '#70dc55',
              textShadow: monetTheme
                ? `0 0 32px rgba(${monetTheme.glowRgb}, 0.65), 0 0 12px rgba(${monetTheme.glowRgb}, 0.35)`
                : `0 0 24px rgba(112, 220, 85, 0.4)`,
              transition: 'color 0.4s ease-out, text-shadow 0.4s ease-out',
            }}
          >
            {waveArtist.name}
          </h1>

          {/* Live track preview badge if streaming */}
          {isCurrentlyInWave && (
            <div
              className="stream-stage__track-info"
              style={{
                borderColor: monetTheme ? `rgba(${monetTheme.glowRgb}, 0.35)` : undefined,
                boxShadow: monetTheme ? `0 4px 20px rgba(${monetTheme.glowRgb}, 0.15)` : undefined,
                transition: 'border-color 0.4s ease-out, box-shadow 0.4s ease-out',
              }}
            >
              <StreamStageBars
                isPlaying={isPlaying}
                color={monetTheme ? monetTheme.accentColor : '#70dc55'}
              />
              <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{currentTrack?.title}</span>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>•</span>
              <span
                style={{
                  color: monetTheme ? monetTheme.accentColor : '#70dc55',
                  transition: 'color 0.4s ease-out',
                }}
              >
                {currentTrack?.artist}
              </span>
            </div>
          )}
        </div>
      ) : waveType === 'track' && waveTrack ? (
        <div className="stream-stage__title-box">
          <h1 className="stream-stage__line">В стиле трека</h1>
          <h1
            className="stream-stage__line stream-stage__line--accent"
            style={{
              color: monetTheme ? monetTheme.accentColor : '#70dc55',
              textShadow: monetTheme
                ? `0 0 32px rgba(${monetTheme.glowRgb}, 0.65), 0 0 12px rgba(${monetTheme.glowRgb}, 0.35)`
                : `0 0 24px rgba(112, 220, 85, 0.4)`,
              transition: 'color 0.4s ease-out, text-shadow 0.4s ease-out',
            }}
          >
            {waveTrack.title}
          </h1>
          {waveTrack.artist && (
            <div style={{ fontSize: '15px', color: 'rgba(255,255,255,0.7)', marginTop: '2px', fontWeight: 500 }}>
              {waveTrack.artist}
            </div>
          )}

          {/* Live track preview badge if streaming */}
          {isCurrentlyInWave && (
            <div
              className="stream-stage__track-info"
              style={{
                borderColor: monetTheme ? `rgba(${monetTheme.glowRgb}, 0.35)` : undefined,
                boxShadow: monetTheme ? `0 4px 20px rgba(${monetTheme.glowRgb}, 0.15)` : undefined,
                transition: 'border-color 0.4s ease-out, box-shadow 0.4s ease-out',
              }}
            >
              <StreamStageBars
                isPlaying={isPlaying}
                color={monetTheme ? monetTheme.accentColor : '#70dc55'}
              />
              <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{currentTrack?.title}</span>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>•</span>
              <span
                style={{
                  color: monetTheme ? monetTheme.accentColor : '#70dc55',
                  transition: 'color 0.4s ease-out',
                }}
              >
                {currentTrack?.artist}
              </span>
            </div>
          )}
        </div>
      ) : isFavoriteFlow ? (
        <div className="stream-stage__title-box">
          <h1 className="stream-stage__line">Поток</h1>
          <h1
            className="stream-stage__line stream-stage__line--accent"
            style={{
              color: monetTheme ? monetTheme.accentColor : '#ef4444',
              textShadow: monetTheme
                ? `0 0 32px rgba(${monetTheme.glowRgb}, 0.65), 0 0 12px rgba(${monetTheme.glowRgb}, 0.35)`
                : '0 0 24px rgba(239, 68, 68, 0.4)',
              transition: 'color 0.4s ease-out, text-shadow 0.4s ease-out',
            }}
          >
            по любимому
          </h1>

          {/* Live track preview badge if streaming */}
          {isCurrentlyInWave && (
            <div
              className="stream-stage__track-info"
              style={{
                borderColor: monetTheme ? `rgba(${monetTheme.glowRgb}, 0.35)` : undefined,
                boxShadow: monetTheme ? `0 4px 20px rgba(${monetTheme.glowRgb}, 0.15)` : undefined,
                transition: 'border-color 0.4s ease-out, box-shadow 0.4s ease-out',
              }}
            >
              <StreamStageBars
                isPlaying={isPlaying}
                color={monetTheme ? monetTheme.accentColor : '#ef4444'}
              />
              <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{currentTrack?.title}</span>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>•</span>
              <span
                style={{
                  color: monetTheme ? monetTheme.accentColor : '#ef4444',
                  transition: 'color 0.4s ease-out',
                }}
              >
                {currentTrack?.artist}
              </span>
            </div>
          )}
        </div>
      ) : waveMood && waveMood.dominantEmotions.length > 0 ? (
        <div
          className="stream-stage__title-box"
          onClick={() => setShowTuner(true)}
          style={{ cursor: 'pointer' }}
          title="Настроить волну"
        >
          <h1 className="stream-stage__line">Ваша</h1>
          {waveMood.dominantEmotions.map((emo) => (
            <h1
              key={emo.id}
              className="stream-stage__line stream-stage__line--emotion"
              style={{
                color: `rgb(${waveMood.activeRgb})`,
                textShadow: `0 0 28px rgba(${waveMood.activeRgb}, 0.55)`,
              }}
            >
              {emo.label}
            </h1>
          ))}
          <h1 className="stream-stage__line">Сила Звука</h1>

          {/* Live track preview badge if streaming */}
          {isCurrentlyInWave && (
            <div className="stream-stage__track-info">
              <StreamStageBars
                isPlaying={isPlaying}
                color="rgb(var(--wave-mood-rgb, 112, 220, 85))"
              />
              <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{currentTrack?.title}</span>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>•</span>
              <span style={{ color: `rgb(var(--wave-mood-rgb, 112, 220, 85))` }}>{currentTrack?.artist}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="stream-stage__title-box">
          <h1 className="stream-stage__line">Мой</h1>
          <h1 className="stream-stage__line stream-stage__line--accent">персональный</h1>
          <h1 className="stream-stage__line">поток</h1>

          {/* Live track preview badge if streaming */}
          {isCurrentlyInWave && (
            <div className="stream-stage__track-info">
              <StreamStageBars
                isPlaying={isPlaying}
                color="#70dc55"
              />
              <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{currentTrack?.title}</span>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>•</span>
              <span style={{ color: '#70dc55' }}>{currentTrack?.artist}</span>
            </div>
          )}
        </div>
      )}

      {/* Bottom Controls Bar */}
      <div className="stream-stage__footer">
        <div className="stream-stage__left-btns">
          {waveType === 'artist' || waveType === 'track' || isFavoriteFlow ? (
            <button
              type="button"
              className="stream-stage__reset-btn"
              onClick={handleResetWave}
              title="Вернуться к персональному потоку"
              style={{
                borderColor: monetTheme ? `rgba(${monetTheme.glowRgb}, 0.45)` : undefined,
                color: monetTheme ? monetTheme.accentColor : undefined,
                transition: 'all 0.3s ease-out',
              }}
            >
              Мой поток
            </button>
          ) : waveMood ? (
            <>
              {/* Pill button: "Сбросить" */}
              <button
                type="button"
                className="stream-stage__reset-btn"
                onClick={handleResetWave}
              >
                Сбросить
              </button>

              {/* Pin button */}
              <button
                type="button"
                className={`stream-stage__circle-btn ${isPinned ? 'stream-stage__circle-btn--active' : ''}`}
                onClick={() => setIsPinned(!isPinned)}
                title={isPinned ? 'Открепить волну' : 'Закрепить волну'}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill={isPinned ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="17" x2="12" y2="22"></line>
                  <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
                </svg>
              </button>
            </>
          ) : (
            /* Pill button: "Настроить" */
            <button
              type="button"
              className={`stream-stage__tune-btn ${showTuner ? 'stream-stage__tune-btn--active' : ''}`}
              onClick={() => setShowTuner(!showTuner)}
            >
              Настроить
            </button>
          )}

          {/* Circle button: "•••" */}
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button
              type="button"
              className="stream-stage__circle-btn"
              onClick={() => setShowMenu(!showMenu)}
              title="Дополнительно"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {showMenu && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '56px',
                  left: 0,
                  minWidth: '230px',
                  whiteSpace: 'nowrap',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '6px',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  backdropFilter: 'blur(16px)',
                }}
              >
                <button
                  className="btn btn--ghost"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    justifyContent: 'flex-start',
                    fontSize: '13px',
                    padding: '8px 12px',
                    width: '100%',
                    color: 'var(--text-primary)',
                  }}
                  onClick={() => {
                    setShowMenu(false);
                    setShowTuner(true);
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.85 }}>
                    <line x1="4" y1="21" x2="4" y2="14" />
                    <line x1="4" y1="10" x2="4" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12" y2="3" />
                    <line x1="20" y1="21" x2="20" y2="16" />
                    <line x1="20" y1="12" x2="20" y2="3" />
                    <line x1="1" y1="14" x2="7" y2="14" />
                    <line x1="9" y1="8" x2="15" y2="8" />
                    <line x1="17" y1="16" x2="23" y2="16" />
                  </svg>
                  <span>Настроить волну</span>
                </button>
                {isCurrentlyInWave && (
                  <button
                    className="btn btn--ghost"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      justifyContent: 'flex-start',
                      fontSize: '13px',
                      padding: '8px 12px',
                      width: '100%',
                      color: 'var(--text-primary)',
                    }}
                    onClick={() => {
                      setShowMenu(false);
                      nextTrack(true);
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.85 }}>
                      <path d="M4 3L10 8L4 13" fill="currentColor" />
                      <path d="M12 3V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <span>Следующий трек</span>
                  </button>
                )}
                <button
                  className="btn btn--ghost"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    justifyContent: 'flex-start',
                    fontSize: '13px',
                    padding: '8px 12px',
                    width: '100%',
                    color: 'var(--text-primary)',
                  }}
                  onClick={() => {
                    setShowMenu(false);
                    handleStartWave();
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.85 }}>
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  <span>Перезапустить поток</span>
                </button>
                {(waveType === 'artist' || waveType === 'track') && (
                  <button
                    className="btn btn--ghost"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      justifyContent: 'flex-start',
                      fontSize: '13px',
                      padding: '8px 12px',
                      width: '100%',
                      color: 'var(--text-primary)',
                    }}
                    onClick={() => {
                      setShowMenu(false);
                      handleResetWave();
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.85 }}>
                      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
                      <path d="M20 3v4" />
                      <path d="M22 5h-4" />
                      <path d="M4 17v2" />
                      <path d="M5 18H3" />
                    </svg>
                    <span>Обычный персональный поток</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Big White Circular Play/Pause Button */}
        <button
          type="button"
          className="stream-stage__play-btn"
          disabled={loading}
          onClick={() => handleStartWave()}
          title={isPlaying && isCurrentlyInWave ? 'Пауза' : 'Слушать персональный поток'}
        >
          {loading ? (
            <div
              style={{
                width: '24px',
                height: '24px',
                border: '2.5px solid rgba(0,0,0,0.2)',
                borderTopColor: '#000000',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          ) : isPlaying && isCurrentlyInWave ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '3px' }}>
              <path d="M8 5V19L19 12L8 5Z" />
            </svg>
          )}
        </button>
      </div>

      {/* Official Zvuk Wave Tuner Modal */}
      <WaveTunerModal
        isOpen={showTuner}
        onClose={() => setShowTuner(false)}
        onApply={handleApplyWaveTuner}
        initialState={
          waveMood
            ? {
                pad: waveMood.pad,
                discovery: waveMood.discovery,
                popularity: waveMood.popularity,
                language: waveMood.language,
              }
            : null
        }
      />
    </div>
  );
}
