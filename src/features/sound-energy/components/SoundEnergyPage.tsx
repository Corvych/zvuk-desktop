import { useState, useEffect } from 'react';
import { getPersonalWave, type PersonalWaveOptions, type Track } from '../../../api';
import { usePlayerStore } from '../../player/playerStore';

export function SoundEnergyPage() {
  const { currentTrack, isPlaying, togglePlay, startWave, isWaveMode, setWaveOptions } = usePlayerStore();
  const [flowTracks, setFlowTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);

  const [tuner, setTuner] = useState({
    energy: 0,
    discovery: 0,
    mood: 0,
    popularity: 0,
  });

  const getTunerOptions = (currentTuner = tuner): PersonalWaveOptions => {
    const normEnergy = Math.max(0, Math.min(1, (currentTuner.energy + 1) / 2));
    const normMood = Math.max(0, Math.min(1, (currentTuner.mood + 1) / 2));

    let popular: number | null = null;
    if (currentTuner.popularity <= -0.33) {
      popular = 0; // Самое левое положение (Редкое)
    } else if (currentTuner.popularity >= 0.33) {
      popular = 1; // Самое правое положение (Трендовое)
    } else {
      popular = null; // По середине (По умолчанию)
    }

    return {
      popular,
      mood: `energy:${normEnergy.toFixed(1)},fun:${normMood.toFixed(1)}`,
    };
  };

  useEffect(() => {
    async function initFlow() {
      try {
        setLoading(true);
        const options = getTunerOptions();
        const tracks = await getPersonalWave(null, 2, options);
        if (tracks && tracks.length > 0) {
          setFlowTracks(tracks);
        }
      } catch (err) {
        console.error('[SoundEnergy] Failed to load flow stream:', err);
      } finally {
        setLoading(false);
      }
    }

    initFlow();
  }, []);

  const handleStartFlow = async () => {
    if (isWaveMode && isPlaying && currentTrack) {
      togglePlay();
      return;
    }

    const options = getTunerOptions();
    if (flowTracks.length > 0) {
      startWave(flowTracks, options);
    } else {
      try {
        setLoading(true);
        const tracks = await getPersonalWave(null, 2, options);
        if (tracks && tracks.length > 0) {
          setFlowTracks(tracks);
          startWave(tracks, options);
        }
      } catch (err) {
        console.error('[SoundEnergy] Failed to start wave:', err);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleTunerChange = async (axis: keyof typeof tuner, value: number) => {
    const updated = { ...tuner, [axis]: value };
    setTuner(updated);

    const options = getTunerOptions(updated);
    setWaveOptions(options);

    if (isWaveMode) {
      try {
        const tunedTracks = await getPersonalWave(null, 2, options);
        if (tunedTracks && tunedTracks.length > 0) {
          setFlowTracks(tunedTracks);
          startWave(tunedTracks, options);
        }
      } catch (err) {
        console.error('[SoundEnergy] Failed to tune flow:', err);
      }
    }
  };

  const axes = [
    { key: 'energy' as const, leftLabel: 'Спокойное', rightLabel: 'Энергичное' },
    { key: 'discovery' as const, leftLabel: 'Знакомое', rightLabel: 'Новое' },
    { key: 'mood' as const, leftLabel: 'Грустное', rightLabel: 'Весёлое' },
    { key: 'popularity' as const, leftLabel: 'Редкое', rightLabel: 'Трендовое' },
  ];

  return (
    <div className="page-enter page-enter-active">
      {/* Hero Section */}
      <div
        style={{
          position: 'relative',
          borderRadius: 'var(--radius-xl)',
          overflow: 'hidden',
          padding: '48px 40px',
          marginBottom: '32px',
          background: `
            radial-gradient(ellipse at 30% 20%, rgba(112, 220, 85, 0.25) 0%, transparent 50%),
            radial-gradient(ellipse at 70% 80%, rgba(94, 194, 68, 0.15) 0%, transparent 50%),
            var(--bg-secondary)
          `,
          border: '1px solid rgba(112, 220, 85, 0.22)',
        }}
      >
        <div style={{ maxWidth: '500px' }}>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2.5rem',
              fontWeight: 800,
              background: 'linear-gradient(135deg, #f5fff2, #70dc55, #4ea838)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              marginBottom: '12px',
            }}
          >
            Сила Звука
          </h1>
          <p style={{ fontSize: '16px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.6 }}>
            Персональный поток музыки, подстроенный под ваше настроение.
            Настройте тюнер и слушайте бесконечно.
          </p>
          <button
            className="btn btn--primary"
            style={{ fontSize: '16px', padding: '14px 32px' }}
            disabled={loading}
            onClick={handleStartFlow}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              {isPlaying && currentTrack ? (
                <>
                  <rect x="5" y="4" width="3.5" height="12" rx="0.5" fill="currentColor"/>
                  <rect x="11.5" y="4" width="3.5" height="12" rx="0.5" fill="currentColor"/>
                </>
              ) : (
                <path d="M6 4L16 10L6 16V4Z" fill="currentColor"/>
              )}
            </svg>
            {loading ? 'Загрузка...' : isWaveMode && isPlaying && currentTrack ? 'Пауза' : 'Слушать поток'}
          </button>
        </div>

        {/* Audio visualiser animation */}
        <div
          style={{
            position: 'absolute',
            right: '40px',
            bottom: '20px',
            display: 'flex',
            alignItems: 'flex-end',
            gap: '4px',
            opacity: isPlaying ? 0.8 : 0.2,
            transition: 'opacity 0.5s',
          }}
        >
          {Array.from({ length: 16 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: '4px',
                height: `${20 + Math.sin(i * 0.8) * 30 + (isPlaying ? Math.random() * 20 : 0)}px`,
                background: 'linear-gradient(to top, var(--accent), var(--accent-light))',
                borderRadius: '2px',
                transition: 'height 0.3s ease',
              }}
            />
          ))}
        </div>
      </div>

      {/* Tuner */}
      <div className="tuner">
        <h3 style={{ marginBottom: '4px' }}>Настройте поток</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
          Перемещайте ползунки, чтобы изменить характер рекомендаций
        </p>

        {axes.map(({ key, leftLabel, rightLabel }) => (
          <div key={key} className="tuner__axis">
            <span className="tuner__label">{leftLabel}</span>
            <input
              type="range"
              className="tuner__slider"
              min="-1"
              max="1"
              step={key === 'popularity' ? '1' : '0.01'}
              value={tuner[key]}
              onChange={(e) => handleTunerChange(key, parseFloat(e.target.value))}
            />
            <span className="tuner__value">{rightLabel}</span>
          </div>
        ))}
      </div>

      {/* Currently Playing Card */}
      {currentTrack && (
        <div
          style={{
            marginTop: '32px',
            padding: '20px',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface)',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            {currentTrack.cover_url ? (
              <img src={currentTrack.cover_url} alt={currentTrack.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                🎵
              </div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>{currentTrack.title}</div>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '2px' }}>{currentTrack.artist}</div>
          </div>
          <span className="hifi-badge">HiFi</span>
        </div>
      )}
    </div>
  );
}
