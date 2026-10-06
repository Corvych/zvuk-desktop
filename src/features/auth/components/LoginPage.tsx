import { useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { useAuthStore } from '../authStore';

export function LoginPage() {
  const [showManualToken, setShowManualToken] = useState(false);
  const [token, setToken] = useState('');
  const { login, startSberIdLogin, isLoading, isSberIdOpening, error, clearError, showLoginModal } = useAuthStore();

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch {
      await invoke('window_minimize');
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
    } catch {
      await invoke('window_toggle_maximize');
    }
  };

  const handleClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      await invoke('window_close');
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (token.trim()) {
      await login(token.trim());
    }
  };

  const handleStartDragging = (e: React.MouseEvent) => {
    if (e.button === 0 && (e.target as HTMLElement).tagName !== 'BUTTON' && !(e.target as HTMLElement).closest('button') && !(e.target as HTMLElement).closest('input')) {
      getCurrentWindow().startDragging().catch(() => invoke('window_start_dragging'));
    }
  };

  return (
    <div
      className="login-page"
      style={{ position: 'relative' }}
      onMouseDown={(e) => {
        if (e.button === 0 && e.target === e.currentTarget) {
          getCurrentWindow().startDragging().catch(() => invoke('window_start_dragging'));
        }
      }}
    >
      {/* Window Controls & Drag Area */}
      {!showLoginModal && (
        <div
          className="titlebar"
          data-tauri-drag-region
          onMouseDown={handleStartDragging}
          onDoubleClick={handleToggleMaximize}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 12px',
            zIndex: 1000,
            pointerEvents: 'auto',
          }}
        >
          {/* Brand/Drag region */}
          <div
            data-tauri-drag-region
            style={{
              flex: 1,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              userSelect: 'none',
              cursor: 'default',
            }}
          >
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, paddingLeft: '4px' }}>
              Звук
            </span>
          </div>

          <div
            className="titlebar__controls"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              pointerEvents: 'auto',
              zIndex: 1001,
            }}
          >
            <button
              type="button"
              className="titlebar__control-btn"
              onClick={handleMinimize}
              title="Свернуть"
              style={{ pointerEvents: 'auto' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              className="titlebar__control-btn"
              onClick={handleToggleMaximize}
              title="Развернуть"
              style={{ pointerEvents: 'auto' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="2" y="2" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
            <button
              type="button"
              className="titlebar__control-btn titlebar__control-btn--close"
              onClick={handleClose}
              title="Закрыть"
              style={{ pointerEvents: 'auto' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="login-page__logo" style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
        <img src="/zvuk-full.svg" alt="Звук" style={{ height: '38px', width: 'auto' }} />
      </div>
      <p className="login-page__tagline">Музыка, подкасты и аудиокниги в HiFi качестве</p>

      <div className="login-page__card" style={{ maxWidth: '420px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 600, textAlign: 'center', marginBottom: '8px' }}>
          Вход в сервис
        </h3>
        <p style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
          Войдите через Сбер ID для доступа к вашей медиатеке и подписке
        </p>

        {/* Primary Seamless Sber ID Login Button */}
        <button
          type="button"
          className="btn w-full"
          style={{
            height: '48px',
            fontSize: '15px',
            fontWeight: 600,
            background: 'linear-gradient(135deg, #21A038 0%, #17802B 100%)',
            color: 'white',
            boxShadow: '0 4px 14px rgba(33, 160, 56, 0.35)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            marginBottom: '16px',
          }}
          disabled={isSberIdOpening || isLoading}
          onClick={startSberIdLogin}
        >
          {isSberIdOpening ? 'Открываем окно Сбер ID...' : 'Войти со Сбер ID'}
        </button>

        <button
          type="button"
          className="btn btn--secondary w-full"
          style={{ height: '44px', fontSize: '14px', marginBottom: '16px' }}
          onClick={useAuthStore.getState().continueAsGuest}
        >
          Слушать без входа (Гостевой режим)
        </button>

        {error && (
          <div className="login-page__error" style={{ textAlign: 'center', marginTop: '8px', marginBottom: '8px' }}>
            {error}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <button
            type="button"
            className="btn btn--ghost"
            style={{ fontSize: '12px', color: 'var(--text-muted)' }}
            onClick={() => setShowManualToken(!showManualToken)}
          >
            {showManualToken ? 'Скрыть ручной ввод' : 'Войти по токену вручную'}
          </button>
        </div>

        {/* Fallback Manual Token Input */}
        {showManualToken && (
          <form onSubmit={handleManualSubmit} style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
            <div className="login-page__field">
              <label htmlFor="token-input">Токен авторизации</label>
              <input
                id="token-input"
                className="input"
                type="password"
                placeholder="Вставьте токен..."
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  if (error) clearError();
                }}
              />
            </div>
            <button
              type="submit"
              className="btn btn--secondary w-full"
              disabled={isLoading || !token.trim()}
            >
              {isLoading ? 'Проверяем...' : 'Войти по токену'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
