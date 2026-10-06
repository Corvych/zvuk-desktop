import { useState, useEffect } from 'react';
import { useAuthStore } from '../../auth/authStore';
import { usePlayerStore, type AudioQuality } from '../../player/playerStore';
import { showToast } from '../../../components/Toast';
import { useLyricsSettingsStore } from '../lyricsSettingsStore';
import { useAppearanceSettingsStore } from '../appearanceSettingsStore';
import { getCacheLimitMb, setCacheLimitMb } from '../../../api';

const QUALITY_OPTIONS: { label: string; description: string; value: AudioQuality }[] = [
  { label: 'HiFi (FLAC)', description: 'Без потерь, ~1411 кбит/с', value: 'flac' },
  { label: 'HQ (Высокое)', description: 'MP3 320 кбит/с', value: 'high' },
  { label: 'SQ (Среднее)', description: 'MP3 192 кбит/с', value: 'mid' },
];

const CACHE_LIMIT_OPTIONS: { label: string; description: string; value: number }[] = [
  { label: '250 МБ', description: 'Экономный — минимум нагрузки на память (~1–2 трека)', value: 250 },
  { label: '500 МБ', description: 'Оптимальный (Рекомендуется) — стабильный буфер для Hi-Fi FLAC', value: 500 },
  { label: '1024 МБ (1 ГБ)', description: 'Расширенный — запас для альбомов и непрерывных сессий (~10 треков)', value: 1024 },
  { label: '2048 МБ (2 ГБ)', description: 'Максимальный — большой буфер для тяжелых плейлистов', value: 2048 },
];

function formatExpirationDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

export function SettingsPage() {
  const { user, logout } = useAuthStore();
  const { quality, setQuality } = usePlayerStore();
  const {
    enableZvuk,
    enableLrclib,
    priority: lyricsPriority,
    setEnableZvuk,
    setEnableLrclib,
    setPriority: setLyricsPriority,
  } = useLyricsSettingsStore();

  const { enableVisualEffects, setEnableVisualEffects } = useAppearanceSettingsStore();

  const [cacheLimit, setCacheLimit] = useState<number>(500);

  useEffect(() => {
    getCacheLimitMb()
      .then((val) => {
        if (val) setCacheLimit(val);
      })
      .catch((err) => console.warn('[Settings] Failed to fetch cache limit:', err));
  }, []);

  const handleCacheLimitChange = async (val: number) => {
    try {
      await setCacheLimitMb(val);
      setCacheLimit(val);
      showToast(`Лимит кэша установлен на ${val} МБ. Перезапустите приложение для применения`, 'info');
    } catch {
      showToast('Не удалось сохранить лимит кэша', 'error');
    }
  };

  const formattedExpiration = formatExpirationDate(user?.subscription?.expiration_date);

  return (
    <div className="page-enter page-enter-active">
      <div className="page-header">
        <h1 className="page-header__title">Настройки</h1>
      </div>

      {/* Account Section */}
      <section
        style={{
          padding: '20px',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '16px',
        }}
      >
        <h4 style={{ marginBottom: '14px' }}>Аккаунт</h4>
        {user ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.username || 'User'}
                    style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '18px',
                      color: 'white',
                    }}
                  >
                    {(user.username || 'U')[0].toUpperCase()}
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: 600, fontSize: '16px' }}>{user.username ?? user.email ?? 'Пользователь'}</div>
                  {user.email && (
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {user.email}
                    </div>
                  )}
                </div>
              </div>
              <button className="btn btn--secondary" onClick={logout}>
                Выйти
              </button>
            </div>

            {/* Subscription Card */}
            <div
              style={{
                marginTop: '16px',
                padding: '14px 16px',
                borderRadius: 'var(--radius-md)',
                background: user.subscription?.is_prime
                  ? 'linear-gradient(135deg, rgba(33, 160, 56, 0.14) 0%, rgba(23, 128, 43, 0.04) 100%)'
                  : 'var(--bg-card)',
                border: user.subscription?.is_prime
                  ? '1px solid rgba(33, 160, 56, 0.35)'
                  : '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    background: user.subscription?.is_prime ? 'var(--accent)' : 'var(--bg-secondary)',
                    color: user.subscription?.is_prime ? 'white' : 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '18px',
                    flexShrink: 0,
                  }}
                >
                  {user.subscription?.is_prime ? (
                    <img
                      src="/sberprime-flag.svg"
                      alt="СберПрайм"
                      style={{ width: '20px', height: '20px', filter: 'brightness(0) invert(1)' }}
                    />
                  ) : (
                    '♫'
                  )}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                      {user.subscription?.is_prime
                        ? 'Подписка СберПрайм'
                        : user.subscription?.is_active
                          ? (user.subscription.plan || 'Подписка активна')
                          : 'Базовый доступ'}
                    </span>
                    {user.subscription?.is_prime && (
                      <span
                        style={{
                          background: '#21A038',
                          color: 'white',
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '100px',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <img
                          src="/sberprime-flag.svg"
                          alt=""
                          style={{ width: '9px', height: '9px', filter: 'brightness(0) invert(1)' }}
                        />
                        Прайм
                      </span>
                    )}
                    {user.subscription?.is_hifi && (
                      <span className="hifi-badge" style={{ display: 'inline-flex' }}>HiFi</span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                    {formattedExpiration ? (
                      <>
                        Действует до{' '}
                        <strong style={{ color: 'var(--text-primary)' }}>
                          {formattedExpiration}
                        </strong>
                      </>
                    ) : user.subscription?.is_prime ? (
                      'Подписка СберПрайм активна'
                    ) : (
                      'Без активной подписки СберПрайм'
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>Не авторизован</p>
        )}
      </section>

      {/* Audio Quality Section */}
      <section
        style={{
          padding: '20px',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '16px',
        }}
      >
        <h4 style={{ marginBottom: '4px' }}>Качество звука</h4>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
          Применяется со следующего трека.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {QUALITY_OPTIONS.map((opt) => (
            <QualityOption
              key={opt.value}
              label={opt.label}
              description={opt.description}
              value={opt.value}
              isSelected={quality === opt.value}
              onSelect={(q) => {
                if (quality !== q) {
                  setQuality(q);
                  const badge = q === 'flac' ? 'HiFi' : q === 'high' ? 'HQ' : 'SQ';
                  showToast(`Качество ${badge} применится со следующего трека`, 'info');
                }
              }}
            />
          ))}
        </div>
      </section>

      {/* Cache & Memory Section */}
      <section
        style={{
          padding: '20px',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <h4 style={{ margin: 0 }}>Кэш и оперативная память</h4>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '100px',
              background: 'rgba(33, 160, 56, 0.15)',
              color: 'var(--accent)',
              border: '1px solid rgba(33, 160, 56, 0.3)',
            }}
          >
            {cacheLimit >= 1024 ? `${(cacheLimit / 1024).toFixed(cacheLimit % 1024 === 0 ? 0 : 1)} ГБ` : `${cacheLimit} МБ`}
          </span>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
          Ограничивает максимальный объем ОЗУ и кэша WebView2 под аудиотреки для предотвращения утечек памяти.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {CACHE_LIMIT_OPTIONS.map((opt) => (
            <CacheOption
              key={opt.value}
              label={opt.label}
              description={opt.description}
              value={opt.value}
              isSelected={cacheLimit === opt.value}
              onSelect={handleCacheLimitChange}
            />
          ))}
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '12px', marginBottom: 0 }}>
          💡 Изменение сохраняется в конфигурации приложения и применяется движком WebView2 при перезапуске.
        </p>
      </section>

      {/* GPU & Performance Section */}
      <section
        style={{
          padding: '20px',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <h4 style={{ margin: 0 }}>Производительность и видеокарта (GPU)</h4>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Графика</span>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Управление фоновыми анимациями и аудио-реактивными эффектами в плеере.
        </p>

        <ToggleRow
          label="Северное сияние и аудио-реактивность"
          description="WebGL процедурный фон Авроры и динамическая пульсация под бас. Отключите для максимальной разгрузки GPU и экономии батареи"
          checked={enableVisualEffects}
          badge={enableVisualEffects ? 'Включено' : 'Эко-режим'}
          onChange={(val) => {
            setEnableVisualEffects(val);
            showToast(val ? 'Визуальные эффекты включены' : 'Эко-режим включен (нагрузка на GPU снята)', 'info');
          }}
        />
      </section>

      {/* Lyrics Sources Section */}
      <section
        style={{
          padding: '20px',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <h4 style={{ margin: 0 }}>Источники текстов песен</h4>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Караоке и LRC</span>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Настройте доступные базы текстов и порядок их поиска для караоке в полноэкранном плеере.
        </p>

        {/* Source Toggles */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px' }}>
          <ToggleRow
            label="Каталог Звук"
            description="Официальные синхронизированные и статичные тексты сервиса Звук"
            checked={enableZvuk}
            badge="Официальный"
            onChange={(val) => {
              if (!val && !enableLrclib) {
                showToast('Хотя бы один источник текстов должен оставаться активным', 'warning');
                return;
              }
              setEnableZvuk(val);
              showToast(val ? 'Источник Звук включен' : 'Источник Звук отключен', 'info');
            }}
          />

          <ToggleRow
            label="База LRCLIB"
            description="Глобальная открытая библиотека синхронизированных караоке-текстов (.lrc)"
            checked={enableLrclib}
            badge="LRCLIB"
            onChange={(val) => {
              if (!val && !enableZvuk) {
                showToast('Хотя бы один источник текстов должен оставаться активным', 'warning');
                return;
              }
              setEnableLrclib(val);
              showToast(val ? 'Источник LRCLIB включен' : 'Источник LRCLIB отключен', 'info');
            }}
          />
        </div>

        {/* Priority Selection */}
        {enableZvuk && enableLrclib && (
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Приоритет поиска:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <PriorityOption
                label="Сначала Звук"
                description="Использовать каталог Звук; при отсутствии караоке автоматически искать в базе LRCLIB"
                isSelected={lyricsPriority === 'zvuk'}
                onSelect={() => {
                  setLyricsPriority('zvuk');
                  showToast('Установлен приоритет: Звук → LRCLIB', 'info');
                }}
              />
              <PriorityOption
                label="Сначала LRCLIB"
                description="Использовать караоке из базы LRCLIB; при отсутствии обращаться к каталогу Звук"
                isSelected={lyricsPriority === 'lrclib'}
                onSelect={() => {
                  setLyricsPriority('lrclib');
                  showToast('Установлен приоритет: LRCLIB → Звук', 'info');
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Keyboard Shortcuts Section */}
      <section
        style={{
          padding: '20px',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '16px',
        }}
      >
        <h4 style={{ marginBottom: '14px' }}>Горячие клавиши</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
          {[
            { key: 'Пробел', label: 'Воспроизведение / пауза' },
            { key: 'L', label: 'Добавить в любимое (лайк)' },
            { key: '← / →', label: 'Перемотка на 5 сек' },
            { key: 'Shift + ← / →', label: 'Предыдущий / след. трек' },
            { key: '↑ / ↓', label: 'Громкость +5% / −5%' },
            { key: 'M', label: 'Выключить / включить звук' },
            { key: 'S', label: 'Случайный порядок' },
            { key: 'R', label: 'Режим повтора' },
          ].map((item) => (
            <div
              key={item.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                fontSize: '13px',
              }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
              <kbd
                style={{
                  fontFamily: 'inherit',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  padding: '2px 8px',
                  background: 'var(--bg-surface)',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.key}
              </kbd>
            </div>
          ))}
        </div>
      </section>

      {/* About */}
      <section
        style={{
          padding: '20px',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <h4 style={{ marginBottom: '8px' }}>О приложении</h4>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Zvuk Desktop v{__APP_VERSION__}
          <br />
          Неофициальный десктоп-клиент для сервиса Звук
        </p>
      </section>
    </div>
  );
}

function QualityOption({
  label,
  description,
  value,
  isSelected,
  onSelect,
}: {
  label: string;
  description: string;
  value: AudioQuality;
  isSelected: boolean;
  onSelect: (q: AudioQuality) => void;
}) {
  return (
    <div
      role="radio"
      aria-checked={isSelected}
      tabIndex={0}
      onClick={() => onSelect(value)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(value)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: isSelected ? 'var(--accent-muted)' : 'transparent',
        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'all 0.15s',
        userSelect: 'none',
      }}
    >
      <div>
        <div style={{ fontSize: '14px', fontWeight: 500, color: isSelected ? 'var(--accent-light)' : 'var(--text-primary)' }}>
          {label}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{description}</div>
      </div>
      <div
        style={{
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'border-color 0.15s',
        }}
      >
        {isSelected && (
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }} />
        )}
      </div>
    </div>
  );
}

function CacheOption({
  label,
  description,
  value,
  isSelected,
  onSelect,
}: {
  label: string;
  description: string;
  value: number;
  isSelected: boolean;
  onSelect: (val: number) => void;
}) {
  return (
    <div
      role="radio"
      aria-checked={isSelected}
      tabIndex={0}
      onClick={() => onSelect(value)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(value)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: isSelected ? 'var(--accent-muted)' : 'transparent',
        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'all 0.15s',
        userSelect: 'none',
      }}
    >
      <div>
        <div style={{ fontSize: '14px', fontWeight: 500, color: isSelected ? 'var(--accent-light)' : 'var(--text-primary)' }}>
          {label}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{description}</div>
      </div>
      <div
        style={{
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'border-color 0.15s',
        }}
      >
        {isSelected && (
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }} />
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  badge,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (val: boolean) => void;
  badge?: string;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 14px',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'all 0.15s ease',
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
          {badge && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: '6px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'var(--text-secondary)',
                letterSpacing: '0.02em',
              }}
            >
              {badge}
            </span>
          )}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{description}</div>
      </div>
      <div
        style={{
          width: '40px',
          height: '22px',
          borderRadius: '12px',
          background: checked ? 'var(--accent)' : 'rgba(255, 255, 255, 0.15)',
          position: 'relative',
          transition: 'background 0.2s ease',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '3px',
            left: checked ? '21px' : '3px',
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            background: '#FFFFFF',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
            transition: 'left 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </div>
    </div>
  );
}

function PriorityOption({
  label,
  description,
  isSelected,
  onSelect,
}: {
  label: string;
  description: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      role="radio"
      aria-checked={isSelected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: isSelected ? 'var(--accent-muted)' : 'var(--bg-card)',
        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        userSelect: 'none',
      }}
    >
      <div>
        <div style={{ fontSize: '14px', fontWeight: 500, color: isSelected ? 'var(--accent-light)' : 'var(--text-primary)' }}>
          {label}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{description}</div>
      </div>
      <div
        style={{
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'border-color 0.15s',
        }}
      >
        {isSelected && (
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }} />
        )}
      </div>
    </div>
  );
}

