import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../features/auth/authStore';
import { HeartIcon } from './HeartIcon';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    to: '/',
    label: 'Главная',
    end: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
        <path
          fill="currentColor"
          d="M12.411 18.402H7.59c-2.535 0-3.994-.191-4.818-1.016-.825-.825-1.016-2.283-1.016-4.818v-1.994c-.005-1.32.017-2.034.284-2.64s.78-1.104 1.756-1.992l.853-.779.853-.78C7.54 2.52 8.77 1.587 10 1.587s2.46.933 4.5 2.798l.852.779.853.78c.977.887 1.49 1.385 1.756 1.991.267.606.289 1.32.285 2.64v.997l-.001.997c0 2.535-.191 3.993-1.016 4.818-.824.825-2.283 1.015-4.818 1.015M10 3.298c-.422 0-.844.193-1.37.579-.528.386-1.16.964-2.005 1.736l-.854.781-.855.78c-.75.683-1.126 1.025-1.313 1.449s-.185.931-.182 1.945v1l.001 1c0 2.082 0 3.124.52 3.645.522.52 1.563.52 3.647.52h4.822c2.084 0 3.125 0 3.646-.52s.521-1.562.521-3.646V10.57c.004-1.015.006-1.522-.181-1.946-.187-.425-.562-.766-1.313-1.448l-.855-.78-.854-.782c-.844-.771-1.476-1.35-2.004-1.736-.527-.386-.949-.579-1.371-.579"
        />
      </svg>
    ),
  },
  {
    to: '/search',
    label: 'Поиск',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
        <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/library',
    label: 'Коллекция',
    icon: (
      <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
        <path
          fill="currentColor"
          d="M4.583 1.667H3.75a.417.417 0 0 0-.417.416v15.834c0 .23.187.416.417.416h.833c.23 0 .417-.186.417-.416V2.083a.417.417 0 0 0-.417-.416m3.75 0H7.5a.417.417 0 0 0-.417.416v15.834c0 .23.187.416.417.416h.833c.23 0 .417-.186.417-.416V2.083a.417.417 0 0 0-.417-.416m3.75 0h-.833a.417.417 0 0 0-.417.416v15.834c0 .23.187.416.417.416h.833c.23 0 .417-.186.417-.416V2.083a.417.417 0 0 0-.417-.416m3.547.054-.82.145a.417.417 0 0 0-.339.482l2.75 15.593c.04.227.256.378.482.338l.821-.145a.417.417 0 0 0 .338-.482l-2.75-15.593a.417.417 0 0 0-.482-.338"
        />
      </svg>
    ),
  },
  {
    to: '/favourites',
    label: 'Любимое',
    icon: <HeartIcon size={22} />,
  },
];

export function Sidebar() {
  return (
    <nav className="sidebar sidebar-area" aria-label="Боковое меню">
      <div className="sidebar__nav">
        {navItems.map((item) => (
          <div key={item.to} className="sidebar__item-wrapper">
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
              }
              aria-label={item.label}
            >
              <span className="sidebar__link-icon">{item.icon}</span>
            </NavLink>
            <div className="sidebar__tooltip">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="sidebar__footer">
        <UserProfileIcon />
      </div>
    </nav>
  );
}

function UserProfileIcon() {
  const { user, isAuthenticated, openLoginModal } = useAuthStore();

  if (isAuthenticated && user) {
    const isPrime = Boolean(user.subscription?.is_prime);

    return (
      <div className="sidebar__item-wrapper">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
          }
          aria-label={user.username || 'Профиль'}
        >
          {isPrime ? (
            <div className="sidebar__avatar-ring">
              <div className="sidebar__avatar-gap">
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.username || 'User'}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '12px',
                      color: 'var(--accent-contrast)',
                    }}
                  >
                    {(user.username || 'U')[0].toUpperCase()}
                  </div>
                )}
              </div>
            </div>
          ) : user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.username || 'User'}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ) : (
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '13px',
                color: 'var(--accent-contrast)',
              }}
            >
              {(user.username || 'U')[0].toUpperCase()}
            </div>
          )}
        </NavLink>
        <div className="sidebar__tooltip">
          {user.username || 'Профиль'}{isPrime ? ' • Прайм' : ''}
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar__item-wrapper">
      <button
        type="button"
        className="sidebar__link"
        onClick={openLoginModal}
        aria-label="Войти в аккаунт"
      >
        <span className="sidebar__link-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4.2" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M4.5 20C4.5 16.5 7.8 14 12 14C16.2 14 19.5 16.5 19.5 20"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </button>
      <div className="sidebar__tooltip">Войти в аккаунт</div>
    </div>
  );
}
