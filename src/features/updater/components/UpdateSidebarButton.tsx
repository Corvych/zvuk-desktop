import { useUpdateStore } from '../updateStore';

export function UpdateSidebarButton() {
  const { updateInfo, openModal } = useUpdateStore();

  return (
    <div className="sidebar__item-wrapper sidebar__item-wrapper--update">
      <button
        type="button"
        className="sidebar__link sidebar__link--update"
        onClick={openModal}
        aria-label={`Доступно обновление ${updateInfo?.version ? `v${updateInfo.version}` : ''}`}
      >
        <span className="sidebar__link-icon">
          {/* Download Icon */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="sidebar__update-icon"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </span>
      </button>

      <div className="sidebar__tooltip sidebar__tooltip--update">
        <div style={{ fontWeight: 600, color: 'var(--accent-light, #4ade80)' }}>
          Доступно обновление
        </div>
        <div style={{ fontSize: '11px', opacity: 0.85, marginTop: '2px' }}>
          {updateInfo?.version ? `Версия v${updateInfo.version}` : 'Новая версия'} • Нажмите для установки
        </div>
      </div>
    </div>
  );
}
