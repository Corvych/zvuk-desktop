import { useEffect } from 'react';
import { useUpdateStore } from '../updateStore';
import { formatReleaseDate, formatFileSize } from '../updaterService';

function renderReleaseNotes(body: string) {
  if (!body || !body.trim()) {
    return <p style={{ color: 'var(--text-muted)' }}>Информация об изменениях не указана разработчиком.</p>;
  }

  const lines = body.split('\n');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} style={{ height: '4px' }} />;

        // Header ### / ## / #
        if (trimmed.startsWith('#')) {
          const text = trimmed.replace(/^#+\s*/, '');
          return (
            <h4
              key={idx}
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: '10px 0 3px',
              }}
            >
              {text}
            </h4>
          );
        }

        // List item
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const itemText = trimmed.substring(2);
          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                fontSize: '13px',
                color: 'var(--text-secondary)',
                lineHeight: '1.45',
              }}
            >
              <span style={{ color: 'var(--accent)', marginTop: '2px', flexShrink: 0 }}>•</span>
              <span>{itemText}</span>
            </div>
          );
        }

        return (
          <p
            key={idx}
            style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: '1.45',
              margin: '2px 0',
            }}
          >
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}

export function UpdateModal() {
  const {
    isModalOpen,
    closeModal,
    updateInfo,
    currentVersion,
    isSimulated,
    isDownloading,
    downloadStatus,
    downloadProgress,
    downloadError,
    startInAppUpdate,
  } = useUpdateStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen && !isDownloading) {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, closeModal, isDownloading]);

  if (!isModalOpen || !updateInfo) {
    return null;
  }

  const formattedDate = formatReleaseDate(updateInfo.publishedAt);
  const formattedSize = updateInfo.assetSize ? formatFileSize(updateInfo.assetSize) : '';

  const progressPercent = Math.round(downloadProgress?.percentage ?? 0);
  const downloadedText = downloadProgress
    ? `${formatFileSize(downloadProgress.downloaded)} из ${formatFileSize(downloadProgress.total || updateInfo.assetSize || 0)}`
    : '';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDownloading) closeModal();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          background: 'linear-gradient(180deg, rgba(28, 28, 34, 0.98) 0%, rgba(20, 20, 25, 0.99) 100%)',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.65), 0 0 40px rgba(21, 182, 72, 0.15)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        {/* Header decoration bar */}
        <div
          style={{
            height: '3px',
            width: '100%',
            background: 'linear-gradient(90deg, #15B648 0%, #EAE619 50%, #0A9FDF 100%)',
          }}
        />

        {/* Modal Header */}
        <div
          style={{
            padding: '22px 24px 16px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'rgba(21, 182, 72, 0.14)',
                border: '1px solid rgba(21, 182, 72, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent)',
                flexShrink: 0,
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Доступно обновление
                </h3>
                {isSimulated && (
                  <span
                    style={{
                      fontSize: '11px',
                      background: 'rgba(234, 230, 25, 0.15)',
                      color: '#EAE619',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: 600,
                    }}
                  >
                    Тест
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Текущая: <span style={{ fontFamily: 'monospace' }}>v{currentVersion}</span>
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>➔</span>
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--accent-light, #4ade80)',
                    background: 'rgba(21, 182, 72, 0.12)',
                    padding: '1px 7px',
                    borderRadius: '6px',
                    border: '1px solid rgba(21, 182, 72, 0.25)',
                    fontFamily: 'monospace',
                  }}
                >
                  v{updateInfo.version}
                </span>
              </div>
            </div>
          </div>

          {!isDownloading && (
            <button
              type="button"
              onClick={closeModal}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '18px',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '8px',
                transition: 'all 0.15s ease',
                lineHeight: 1,
              }}
              aria-label="Закрыть"
            >
              ✕
            </button>
          )}
        </div>

        {/* Modal Body / Release Notes */}
        <div style={{ padding: '0 24px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Release Title and Metadata */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
              {updateInfo.name}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              {formattedDate && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span>{formattedDate}</span>
                </div>
              )}

              {formattedSize && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ opacity: 0.4 }}>•</span>
                  <span>{formattedSize}</span>
                </div>
              )}
            </div>
          </div>

          {/* Release Notes Content */}
          <div
            style={{
              background: 'rgba(0, 0, 0, 0.35)',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              padding: '14px 16px',
              maxHeight: '220px',
              overflowY: 'auto',
            }}
          >
            {renderReleaseNotes(updateInfo.body)}
          </div>

          {/* Download Progress State */}
          {isDownloading && (
            <div
              style={{
                background: 'rgba(21, 182, 72, 0.08)',
                border: '1px solid rgba(21, 182, 72, 0.25)',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                animation: 'fadeIn 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ display: 'inline-block', animation: 'spin 1.2s linear infinite', color: 'var(--accent)' }}>
                    ↻
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {downloadStatus === 'installing'
                      ? 'Запуск установщика...'
                      : 'Скачивание обновления...'}
                  </span>
                </div>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent-light, #4ade80)', fontFamily: 'monospace' }}>
                  {progressPercent}%
                </span>
              </div>

              {/* Progress Bar Container */}
              <div
                style={{
                  height: '8px',
                  width: '100%',
                  background: 'rgba(0, 0, 0, 0.4)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progressPercent}%`,
                    background: 'linear-gradient(90deg, #15B648 0%, #EAE619 70%, #0A9FDF 100%)',
                    borderRadius: '4px',
                    transition: 'width 0.25s ease-out',
                    boxShadow: '0 0 10px rgba(21, 182, 72, 0.5)',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)' }}>
                <span>{downloadedText}</span>
                <span>
                  {downloadStatus === 'installing'
                    ? 'Приложение перезапустится после установки'
                    : 'Пожалуйста, не закрывайте приложение'}
                </span>
              </div>
            </div>
          )}

          {downloadError && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                fontSize: '12px',
              }}
            >
              Ошибка при обновлении: {downloadError}
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div
          style={{
            padding: '16px 24px 20px',
            background: 'rgba(0, 0, 0, 0.25)',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '12px',
          }}
        >
          {!isDownloading ? (
            <>
              <button
                type="button"
                onClick={closeModal}
                style={{
                  padding: '10px 18px',
                  borderRadius: '10px',
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--text-secondary)',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Позже
              </button>

              <button
                type="button"
                onClick={startInAppUpdate}
                style={{
                  padding: '10px 22px',
                  borderRadius: '10px',
                  background: 'var(--accent)',
                  border: 'none',
                  color: 'var(--accent-contrast, #ffffff)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 14px rgba(21, 182, 72, 0.35)',
                  transition: 'all 0.15s ease',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Установить обновление
              </button>
            </>
          ) : (
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Идет обновление приложения...
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
