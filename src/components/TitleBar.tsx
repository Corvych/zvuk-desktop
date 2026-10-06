import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';

export function TitleBar() {
  const navigate = useNavigate();

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

  return (
    <div className="titlebar titlebar-area" data-tauri-drag-region>
      {/* Navigation & Branding */}
      <div className="titlebar__nav" style={{ alignItems: 'center' }}>
        <div
          className="titlebar__logo"
          onClick={() => navigate('/')}
          title="Звук — На главную"
          style={{
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            paddingRight: '14px',
            paddingLeft: '4px',
            userSelect: 'none',
            transition: 'opacity 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          <img src="/zvuk-full.svg" alt="Звук" style={{ height: '17px', width: 'auto', display: 'block' }} />
        </div>
        <button
          className="titlebar__nav-btn"
          onClick={() => navigate(-1)}
          title="Назад"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          className="titlebar__nav-btn"
          onClick={() => navigate(1)}
          title="Forward"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="titlebar__search">
        <div className="search-bar">
          <svg className="search-bar__icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            className="search-bar__input"
            type="text"
            placeholder="Искать треки, альбомы, исполнителей..."
            onFocus={() => navigate('/search')}
          />
        </div>
      </div>

      {/* Window Controls */}
      <div className="titlebar__controls">
        <button
          className="titlebar__control-btn"
          onClick={handleMinimize}
          title="Свернуть"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <button
          className="titlebar__control-btn"
          onClick={handleToggleMaximize}
          title="Развернуть"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="2" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        </button>
        <button
          className="titlebar__control-btn titlebar__control-btn--close"
          onClick={handleClose}
          title="Закрыть"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
