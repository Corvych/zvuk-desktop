import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../auth/authStore';
import { usePlayerStore, type AudioQuality } from '../../player/playerStore';
import { showToast } from '../../../components/Toast';
import { useLyricsSettingsStore, type LyricsSource } from '../lyricsSettingsStore';
import { useAppearanceSettingsStore } from '../appearanceSettingsStore';
import { useDiscordSettingsStore } from '../discordSettingsStore';
import { useUpdateStore } from '../../updater/updateStore';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getCacheLimitMb, setCacheLimitMb } from '../../../api';

type SettingsTab = 'profile' | 'playback' | 'appearance' | 'integrations' | 'about';

const VALID_TABS: SettingsTab[] = ['profile', 'playback', 'appearance', 'integrations', 'about'];

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

const LYRICS_SOURCE_INFO: Record<
  LyricsSource,
  {
    title: string;
    badge: string;
    description: string;
  }
> = {
  betterlyrics: {
    title: 'Better Lyrics (LRC.RED)',
    badge: 'Word-Sync (TTML)',
    description: 'Глобальная база Apple Music & Better Lyrics с поддержкой пословной и слоговой синхронизации',
  },
  netease: {
    title: 'NetEase Cloud Music',
    badge: 'YRC Sync',
    description: 'Каталог с богатой поддержкой пословного караоке (YRC) для зарубежной, русской и азиатской музыки',
  },
  zvuk: {
    title: 'Каталог Звук',
    badge: 'Официальный',
    description: 'Официальные синхронизированные и построчные тексты сервиса Звук',
  },
  lrclib: {
    title: 'База LRCLIB',
    badge: 'LRCLIB',
    description: 'Глобальная открытая библиотека синхронизированных караоке-текстов (.lrc)',
  },
};

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
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTabParam = searchParams.get('tab') as SettingsTab;
  const activeTab: SettingsTab = VALID_TABS.includes(currentTabParam) ? currentTabParam : 'profile';

  const setActiveTab = (tab: SettingsTab) => {
    setSearchParams({ tab }, { replace: true });
  };

  const { user, logout } = useAuthStore();
  const { quality, setQuality } = usePlayerStore();
  const {
    enableZvuk,
    enableBetterLyrics,
    enableNetease,
    enableLrclib,
    preferWordSync,
    sourceOrder = ['betterlyrics', 'netease', 'zvuk', 'lrclib'],
    moveSource,
    setSourceEnabled,
    setPreferWordSync,
  } = useLyricsSettingsStore();

  const isSourceActive = (source: LyricsSource): boolean => {
    if (source === 'betterlyrics') return enableBetterLyrics;
    if (source === 'netease') return enableNetease;
    if (source === 'zvuk') return enableZvuk;
    if (source === 'lrclib') return enableLrclib;
    return false;
  };

  const handleToggleSource = (source: LyricsSource, nextVal: boolean) => {
    if (!nextVal) {
      const activeCount =
        (source !== 'betterlyrics' && enableBetterLyrics ? 1 : 0) +
        (source !== 'netease' && enableNetease ? 1 : 0) +
        (source !== 'zvuk' && enableZvuk ? 1 : 0) +
        (source !== 'lrclib' && enableLrclib ? 1 : 0);

      if (activeCount === 0) {
        showToast('Хотя бы один источник текстов должен оставаться активным', 'warning');
        return;
      }
    }

    setSourceEnabled(source, nextVal);
    showToast(
      nextVal
        ? `Источник ${LYRICS_SOURCE_INFO[source].title} включен`
        : `Источник ${LYRICS_SOURCE_INFO[source].title} отключен`,
      'info'
    );
  };

  const { enableVisualEffects, setEnableVisualEffects } = useAppearanceSettingsStore();

  const {
    enabled: discordEnabled,
    clientId: discordClientId,
    showButtons: discordShowButtons,
    showPause: discordShowPause,
    connected: discordConnected,
    setEnabled: setDiscordEnabled,
    setClientId: setDiscordClientId,
    setShowButtons: setDiscordShowButtons,
    setShowPause: setDiscordShowPause,
    resetClientId: resetDiscordClientId,
    checkStatus: checkDiscordStatus,
  } = useDiscordSettingsStore();

  const {
    currentVersion,
    updateInfo,
    hasUpdate,
    isChecking: isCheckingUpdates,
    checkForUpdates,
    openModal: openUpdateModal,
    lastChecked: lastUpdateChecked,
  } = useUpdateStore();

  const handleManualCheckUpdates = async () => {
    try {
      const found = await checkForUpdates(true);
      if (found) {
        showToast('Найдено новое обновление!', 'success');
      } else {
        showToast('У вас установлена последняя версия', 'success');
      }
    } catch {
      showToast('Не удалось проверить обновления', 'error');
    }
  };

  const [inputClientId, setInputClientId] = useState(discordClientId);

  useEffect(() => {
    setInputClientId(discordClientId);
  }, [discordClientId]);

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

  const TABS: { id: SettingsTab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    {
      id: 'profile',
      label: 'Профиль',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
      badge: user?.subscription?.is_prime ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: 'rgba(33, 160, 56, 0.2)',
            color: '#21A038',
            fontSize: '10px',
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: '6px',
            letterSpacing: '0.02em',
          }}
        >
          Прайм
        </span>
      ) : undefined,
    },
    {
      id: 'playback',
      label: 'Воспроизведение',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      ),
    },
    {
      id: 'appearance',
      label: 'Персонализация',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
        </svg>
      ),
    },
    {
      id: 'integrations',
      label: 'Интеграции',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
          <line x1="6" y1="6" x2="6.01" y2="6" />
          <line x1="6" y1="18" x2="6.01" y2="18" />
        </svg>
      ),
      badge: discordEnabled && discordConnected ? (
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#23A55A',
            boxShadow: '0 0 6px rgba(35, 165, 90, 0.6)',
          }}
        />
      ) : undefined,
    },
    {
      id: 'about',
      label: 'О приложении',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      ),
      badge: hasUpdate ? (
        <span
          style={{
            background: '#21A038',
            color: 'white',
            fontSize: '9px',
            fontWeight: 700,
            padding: '1px 5px',
            borderRadius: '10px',
            letterSpacing: '0.02em',
          }}
        >
          NEW
        </span>
      ) : undefined,
    },
  ];

  return (
    <div className="page-enter page-enter-active">
      <div className="page-header" style={{ marginBottom: '18px' }}>
        <h1 className="page-header__title">Настройки</h1>
      </div>

      {/* Tabs Navigation */}
      <div
        role="tablist"
        aria-label="Разделы настроек"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'rgba(255, 255, 255, 0.03)',
          padding: '6px',
          borderRadius: '14px',
          border: '1px solid var(--border-subtle)',
          marginBottom: '22px',
          overflowX: 'auto',
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 16px',
                borderRadius: '10px',
                border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                background: isActive ? 'var(--bg-card)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                transition: 'all 0.16s ease',
                whiteSpace: 'nowrap',
                boxShadow: isActive ? '0 2px 8px rgba(0, 0, 0, 0.25)' : 'none',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge}
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT: Профиль */}
      {activeTab === 'profile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Account Card */}
          <section
            style={{
              padding: '22px',
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <h4 style={{ marginBottom: '16px', fontSize: '16px' }}>Данные аккаунта</h4>
            {user ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {user.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        alt={user.username || 'User'}
                        style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '56px',
                          height: '56px',
                          borderRadius: '50%',
                          background: 'var(--accent)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '20px',
                          color: 'white',
                        }}
                      >
                        {(user.username || 'U')[0].toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '17px' }}>{user.username ?? user.email ?? 'Пользователь'}</div>
                      {user.email && (
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                          {user.email}
                        </div>
                      )}
                    </div>
                  </div>
                  <button className="btn btn--secondary" onClick={logout}>
                    Выйти из аккаунта
                  </button>
                </div>

                {/* SberPrime Subscription Card */}
                <div
                  style={{
                    marginTop: '20px',
                    padding: '16px 18px',
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
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '12px',
                        background: user.subscription?.is_prime ? 'var(--accent)' : 'var(--bg-secondary)',
                        color: user.subscription?.is_prime ? 'white' : 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '20px',
                        flexShrink: 0,
                      }}
                    >
                      {user.subscription?.is_prime ? (
                        <img
                          src="/sberprime-flag.svg"
                          alt="СберПрайм"
                          style={{ width: '22px', height: '22px', filter: 'brightness(0) invert(1)' }}
                        />
                      ) : (
                        '♫'
                      )}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)' }}>
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
                              fontSize: '11px',
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
                              style={{ width: '10px', height: '10px', filter: 'brightness(0) invert(1)' }}
                            />
                            Прайм
                          </span>
                        )}
                        {user.subscription?.is_hifi && (
                          <span className="hifi-badge" style={{ display: 'inline-flex' }}>HiFi</span>
                        )}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
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
        </div>
      )}

      {/* TAB CONTENT: Воспроизведение */}
      {activeTab === 'playback' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Audio Quality Section */}
          <section
            style={{
              padding: '20px',
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
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

          {/* Lyrics Sources Section - Reorderable Unified List */}
          <section
            style={{
              padding: '20px',
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <h4 style={{ margin: 0 }}>Источники текстов песен</h4>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Караоке и LRC</span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Настройте приоритет поиска и доступные базы караоке-текстов в плеере.
            </p>

            {/* Reorderable Sources List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {sourceOrder.map((sourceKey, index) => {
                const isEnabled = isSourceActive(sourceKey);
                const info = LYRICS_SOURCE_INFO[sourceKey];
                const isFirst = index === 0;
                const isLast = index === sourceOrder.length - 1;

                return (
                  <div
                    key={sourceKey}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      background: isEnabled ? 'var(--bg-card)' : 'rgba(255, 255, 255, 0.02)',
                      borderRadius: 'var(--radius-md)',
                      border: `1px solid ${isEnabled ? 'var(--border-subtle)' : 'rgba(255, 255, 255, 0.04)'}`,
                      opacity: isEnabled ? 1 : 0.6,
                      transition: 'all 0.2s ease',
                      gap: '12px',
                    }}
                  >
                    {/* Left: Reorder controls + Priority Index */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <div
                        style={{
                          width: '26px',
                          height: '26px',
                          borderRadius: '6px',
                          background: isEnabled && isFirst ? 'var(--accent)' : 'rgba(255, 255, 255, 0.07)',
                          color: isEnabled && isFirst ? '#ffffff' : 'var(--text-secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px',
                          fontWeight: 700,
                          fontFamily: 'monospace',
                        }}
                        title={isFirst ? 'Основной источник поиска' : `Приоритет #${index + 1}`}
                      >
                        #{index + 1}
                      </div>

                      {/* Up / Down Reorder buttons */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <button
                          type="button"
                          disabled={isFirst}
                          onClick={() => {
                            moveSource(sourceKey, 'up');
                            showToast(`Приоритет источника «${info.title}» повышен`, 'info');
                          }}
                          aria-label="Поднять в приоритете"
                          style={{
                            padding: '2px 4px',
                            border: 'none',
                            background: 'transparent',
                            color: isFirst ? 'rgba(255, 255, 255, 0.15)' : 'var(--text-secondary)',
                            cursor: isFirst ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            lineHeight: 1,
                            borderRadius: '3px',
                            transition: 'all 0.1s ease',
                          }}
                          onMouseEnter={(e) => {
                            if (!isFirst) (e.currentTarget.style.color = 'var(--text-primary)');
                          }}
                          onMouseLeave={(e) => {
                            if (!isFirst) (e.currentTarget.style.color = 'var(--text-secondary)');
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="18 15 12 9 6 15" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          disabled={isLast}
                          onClick={() => {
                            moveSource(sourceKey, 'down');
                            showToast(`Приоритет источника «${info.title}» понижен`, 'info');
                          }}
                          aria-label="Опустить в приоритете"
                          style={{
                            padding: '2px 4px',
                            border: 'none',
                            background: 'transparent',
                            color: isLast ? 'rgba(255, 255, 255, 0.15)' : 'var(--text-secondary)',
                            cursor: isLast ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            lineHeight: 1,
                            borderRadius: '3px',
                            transition: 'all 0.1s ease',
                          }}
                          onMouseEnter={(e) => {
                            if (!isLast) (e.currentTarget.style.color = 'var(--text-primary)');
                          }}
                          onMouseLeave={(e) => {
                            if (!isLast) (e.currentTarget.style.color = 'var(--text-secondary)');
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Center: Title + Badges + Description */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {info.title}
                        </span>
                        {isFirst && isEnabled && (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: '4px',
                              background: 'rgba(33, 160, 56, 0.2)',
                              color: '#21A038',
                              letterSpacing: '0.03em',
                              textTransform: 'uppercase',
                            }}
                          >
                            Основной
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.08)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {info.badge}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.35 }}>
                        {info.description}
                      </div>
                    </div>

                    {/* Right: Toggle Switch */}
                    <div
                      onClick={() => handleToggleSource(sourceKey, !isEnabled)}
                      title={isEnabled ? 'Отключить источник' : 'Включить источник'}
                      style={{
                        width: '38px',
                        height: '20px',
                        borderRadius: '11px',
                        background: isEnabled ? 'var(--accent)' : 'rgba(255, 255, 255, 0.15)',
                        position: 'relative',
                        transition: 'background 0.2s ease',
                        flexShrink: 0,
                        cursor: 'pointer',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: '2px',
                          left: isEnabled ? '20px' : '2px',
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
              })}
            </div>

            {/* Smart Word-Sync Preference Toggle */}
            <div style={{ marginBottom: '14px' }}>
              <ToggleRow
                label="Приоритет пословной синхронизации (Word-Sync)"
                description="Автоматически отдавать предпочтение слоговому караоке (Better Lyrics или NetEase), если оно найдено"
                checked={preferWordSync}
                badge={preferWordSync ? 'Активно' : 'Выкл'}
                onChange={(val) => {
                  setPreferWordSync(val);
                  showToast(val ? 'Приоритет слогового караоке включен' : 'Приоритет слогового караоке выключен', 'info');
                }}
              />
            </div>

            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>
              💡 Порядок сверху вниз задает очередь поиска: плеер опрашивает базы в этом порядке и загружает первый найденный караоке-текст.
            </p>
          </section>
        </div>
      )}

      {/* TAB CONTENT: Персонализация */}
      {activeTab === 'appearance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* GPU & Performance Section */}
          <section
            style={{
              padding: '20px',
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
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

          {/* Extensibility notice card */}
          <div
            style={{
              padding: '16px 18px',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-md)',
              border: '1px dashed var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent)',
                flexShrink: 0,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Раздел будет расширяться
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                В следующих обновлениях сюда добавятся выбор цветовых акцентов, тем оформления и кастомизация интерфейса плеера.
              </div>
            </div>
          </div>

          {/* Keyboard Shortcuts Section */}
          <section
            style={{
              padding: '20px',
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
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
                { key: 'F', label: 'Полноэкранный плеер' },
                { key: 'Esc', label: 'Выход из полноэкранного плеера' },
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
        </div>
      )}

      {/* TAB CONTENT: Интеграции */}
      {activeTab === 'integrations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Discord Rich Presence Section */}
          <section
            style={{
              padding: '20px',
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h4 style={{ margin: 0 }}>Discord Rich Presence</h4>
              </div>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Транслирует играющий трек, исполнителя, альбом, обложку и интерактивный прогресс-бар в ваш статус Discord («Listening to...»).
            </p>

            <ToggleRow
              label="Транслировать статус в Discord"
              description="Показывать текущее воспроизведение в вашем профиле Discord в реальном времени"
              checked={discordEnabled}
              badge={discordEnabled ? (discordConnected ? 'Подключено' : 'Ожидание Discord') : 'Выключено'}
              onChange={async (val) => {
                await setDiscordEnabled(val);
                showToast(val ? 'Discord Rich Presence включен' : 'Discord Rich Presence отключен', 'info');
              }}
            />

            {discordEnabled && (
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Status indicator bar */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: discordConnected ? '#23A55A' : '#F0B232',
                        boxShadow: discordConnected
                          ? '0 0 8px rgba(35, 165, 90, 0.6)'
                          : '0 0 8px rgba(240, 178, 50, 0.4)',
                      }}
                    />
                    <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                      {discordConnected
                        ? 'Клиент Discord обнаружен и подключен'
                        : 'Ожидание запуска Discord (запустите Discord на компьютере)'}
                    </span>
                  </div>
                  <button
                    className="btn btn--secondary"
                    style={{ padding: '4px 10px', fontSize: '12px' }}
                    onClick={() => {
                      checkDiscordStatus();
                      showToast('Проверка соединения с Discord...', 'info');
                    }}
                  >
                    Обновить
                  </button>
                </div>

                {/* Client ID Configuration */}
                <div
                  style={{
                    padding: '14px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Discord Application ID (Client ID)
                    </label>
                    {inputClientId.trim() !== '' && (
                      <button
                        className="btn btn--secondary"
                        style={{ fontSize: '11px', padding: '2px 8px' }}
                        onClick={async () => {
                          await resetDiscordClientId();
                          setInputClientId('');
                          showToast('Сброшено на Client ID по умолчанию', 'info');
                        }}
                      >
                        Сбросить по умолчанию
                      </button>
                    )}
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                    По умолчанию используется ключ разработчика. Вы можете указать собственный Application ID, если хотите настроить свое имя или иконку.
                  </p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={inputClientId}
                      onChange={(e) => setInputClientId(e.target.value)}
                      placeholder="По умолчанию (ключ разработчика)"
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        outline: 'none',
                        fontFamily: 'monospace',
                      }}
                    />
                    <button
                      className="btn btn--secondary"
                      disabled={inputClientId === discordClientId}
                      onClick={async () => {
                        await setDiscordClientId(inputClientId);
                        showToast('Discord Client ID сохранен', 'info');
                      }}
                    >
                      Применить
                    </button>
                  </div>
                  <div style={{ marginTop: '10px' }}>
                    <a
                      href="https://discord.com/developers/applications"
                      onClick={async (e) => {
                        e.preventDefault();
                        try {
                          await openUrl('https://discord.com/developers/applications');
                        } catch {
                          window.open('https://discord.com/developers/applications', '_blank');
                        }
                      }}
                      style={{
                        fontSize: '12px',
                        color: 'var(--accent)',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      <span>Создать свое приложение в Discord Developer Portal ↗</span>
                    </a>
                  </div>
                </div>

                {/* Additional Toggles */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <ToggleRow
                    label="Кнопка «Слушать в Звуке»"
                    description="Добавляет в активность кнопку с прямой ссылкой на воспроизводимый трек на Звук"
                    checked={discordShowButtons}
                    badge={discordShowButtons ? 'Вкл' : 'Выкл'}
                    onChange={async (val) => {
                      await setDiscordShowButtons(val);
                      showToast(val ? 'Кнопка трека включена' : 'Кнопка трека отключена', 'info');
                    }}
                  />

                  <ToggleRow
                    label="Отображать активность при паузе"
                    description="При паузе оставляет обложку и название трека с отметкой «На паузе». При отключении статус сразу скрывается при паузе"
                    checked={discordShowPause}
                    badge={discordShowPause ? 'Вкл' : 'Скрывать'}
                    onChange={async (val) => {
                      await setDiscordShowPause(val);
                      showToast(val ? 'Статус при паузе активен' : 'Статус скрывается при паузе', 'info');
                    }}
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB CONTENT: О приложении */}
      {activeTab === 'about' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <section
            style={{
              padding: '20px',
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>О приложении</h4>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Неофициальный десктоп-клиент для сервиса Звук
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>Версия:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>v{currentVersion || __APP_VERSION__}</span>
              </div>
            </div>

            {/* Update status panel */}
            <div
              style={{
                background: hasUpdate ? 'rgba(21, 182, 72, 0.08)' : 'var(--bg-card)',
                border: `1px solid ${hasUpdate ? 'rgba(21, 182, 72, 0.3)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '14px',
                marginBottom: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: hasUpdate ? 'rgba(21, 182, 72, 0.18)' : 'rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: hasUpdate ? 'var(--accent)' : 'var(--text-muted)',
                    flexShrink: 0,
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: hasUpdate ? 'var(--accent-light, #4ade80)' : 'var(--text-primary)' }}>
                    {hasUpdate
                      ? `Доступна новая версия v${updateInfo?.version}!`
                      : 'У вас установлена самая свежая версия'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {lastUpdateChecked
                      ? `Последняя проверка: ${new Date(lastUpdateChecked).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                      : 'Автоматическая проверка при запуске'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {hasUpdate && (
                  <button
                    type="button"
                    onClick={openUpdateModal}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '8px',
                      background: 'var(--accent)',
                      color: 'var(--accent-contrast, #ffffff)',
                      border: 'none',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    Посмотреть детали
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleManualCheckUpdates}
                  disabled={isCheckingUpdates}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: isCheckingUpdates ? 'not-allowed' : 'pointer',
                    opacity: isCheckingUpdates ? 0.7 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {isCheckingUpdates ? (
                    <>
                      <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>↻</span>
                      Проверка...
                    </>
                  ) : (
                    <>
                      <span>↻</span>
                      Проверить обновления
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Links and Test actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <a
                  href="https://github.com/Corvych/zvuk-desktop"
                  onClick={async (e) => {
                    e.preventDefault();
                    try {
                      await openUrl('https://github.com/Corvych/zvuk-desktop');
                    } catch {
                      window.open('https://github.com/Corvych/zvuk-desktop', '_blank');
                    }
                  }}
                  style={{
                    fontSize: '12px',
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    cursor: 'pointer',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  <span>GitHub репозиторий ↗</span>
                </a>
              </div>
            </div>
          </section>
        </div>
      )}
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
