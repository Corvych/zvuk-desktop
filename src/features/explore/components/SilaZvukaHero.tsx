import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../../player/playerStore';
import { getPersonalWave, getArtistRadio, type PersonalWaveOptions } from '../../../api';
import { useAudioReactive } from '../../player/useAudioReactive';
import { WaveTunerModal, type WaveTunerState } from './WaveTunerModal';
import { computeWaveMood } from '../utils/waveMood';
import { extractMonetThemeFromPalette, extractMonetFromImage, type MonetTheme } from '../../../lib/monetPalette';

export function SilaZvukaHero() {
  const navigate = useNavigate();
  const {
    currentTrack,
    isPlaying,
    isWaveMode,
    waveType,
    waveArtist,
    waveMood,
    setWaveMood,
    togglePlay,
    startWave,
    startArtistWave,
    setWaveOptions,
    nextTrack,
  } = usePlayerStore();

  const [loading, setLoading] = useState(false);
  const [showTuner, setShowTuner] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [monetTheme, setMonetTheme] = useState<MonetTheme | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (waveType === 'artist' && waveArtist) {
      if (waveArtist.palette) {
        setMonetTheme(extractMonetThemeFromPalette(waveArtist.palette));
      } else if (waveArtist.imageUrl) {
        extractMonetFromImage(waveArtist.imageUrl).then(setMonetTheme);
      } else {
        setMonetTheme(null);
      }
    } else {
      setMonetTheme(null);
    }
  }, [waveType, waveArtist]);

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
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'flex-end',
                  gap: '2.5px',
                  height: '14px',
                  paddingBottom: '1px',
                }}
              >
                {[1, 2, 3].map((bar) => (
                  <span
                    key={bar}
                    style={{
                      width: '3px',
                      height: isPlaying ? `var(--audio-bar-${bar}, 6px)` : '4px',
                      borderRadius: '2px',
                      background: monetTheme ? monetTheme.accentColor : '#70dc55',
                      transition: 'height 0.06s ease-out, background 0.4s ease-out',
                    }}
                  />
                ))}
              </span>
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
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'flex-end',
                  gap: '2.5px',
                  height: '14px',
                  paddingBottom: '1px',
                }}
              >
                {[1, 2, 3].map((bar) => (
                  <span
                    key={bar}
                    style={{
                      width: '3px',
                      height: isPlaying ? `var(--audio-bar-${bar}, 6px)` : '4px',
                      borderRadius: '2px',
                      background: `rgb(var(--wave-mood-rgb, 112, 220, 85))`,
                      transition: 'height 0.06s ease-out, background 0.3s ease-out',
                    }}
                  />
                ))}
              </span>
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
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'flex-end',
                  gap: '2.5px',
                  height: '14px',
                  paddingBottom: '1px',
                }}
              >
                {[1, 2, 3].map((bar) => (
                  <span
                    key={bar}
                    style={{
                      width: '3px',
                      height: isPlaying ? `var(--audio-bar-${bar}, 6px)` : '4px',
                      borderRadius: '2px',
                      background: '#70dc55',
                      transition: 'height 0.06s ease-out',
                    }}
                  />
                ))}
              </span>
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
          {waveType === 'artist' ? (
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
                  width: '210px',
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
                  🎚️ Настроить волну
                </button>
                <button
                  className="btn btn--ghost"
                  style={{
                    justifyContent: 'flex-start',
                    fontSize: '13px',
                    padding: '8px 12px',
                    width: '100%',
                    color: 'var(--text-primary)',
                  }}
                  onClick={() => {
                    setShowMenu(false);
                    navigate('/sound-energy');
                  }}
                >
                  🎧 Страница Силы Звука
                </button>
                {isCurrentlyInWave && (
                  <button
                    className="btn btn--ghost"
                    style={{
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
                    ⏭️ Следующий трек
                  </button>
                )}
                <button
                  className="btn btn--ghost"
                  style={{
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
                  🔄 Перезапустить поток
                </button>
                {waveType === 'artist' && (
                  <button
                    className="btn btn--ghost"
                    style={{
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
                    ✨ Обычный персональный поток
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
