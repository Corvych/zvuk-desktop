import { useEffect, useState, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { ToastContainer } from './components/Toast';
import { PlayerBar } from './features/player/components/PlayerBar';
import { FullscreenPlayer } from './features/player/components/FullscreenPlayer';
import { LoginPage } from './features/auth/components/LoginPage';
import { HomePage } from './features/explore/components/HomePage';
import { SearchPage } from './features/search/components/SearchPage';
import { SoundEnergyPage } from './features/sound-energy/components/SoundEnergyPage';
import { LibraryPage } from './features/library/components/LibraryPage';
import { FavouritesPage } from './features/favourites/components/FavouritesPage';
import { PlaylistsPage } from './features/playlists/components/PlaylistsPage';
import { PlaylistDetailPage } from './features/playlists/components/PlaylistDetailPage';
import { AlbumDetailPage } from './features/library/components/AlbumDetailPage';
import { ArtistDetailPage } from './features/artists/components/ArtistDetailPage';
import { SettingsPage } from './features/settings/components/SettingsPage';

import { useAuthStore } from './features/auth/authStore';
import { usePlayerStore } from './features/player/playerStore';

import { useAudioPlayer } from './features/player/useAudioPlayer';
import { useHotkeys } from './features/player/useHotkeys';
import { useMediaSession } from './features/player/useMediaSession';
import { useAudioReactive } from './features/player/useAudioReactive';
import { useFavouritesStore } from './features/favourites/favouritesStore';
import { extractMonetThemeFromPalette, extractMonetFromImage, type MonetTheme } from './lib/monetPalette';

import { AuroraCanvas } from './components/AuroraCanvas';

function AppShell() {
  useAudioPlayer();
  useHotkeys();
  useMediaSession();
  useAudioReactive();

  const location = useLocation();
  const isHome = location.pathname === '/';
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const waveMood = usePlayerStore((s) => s.waveMood);
  const isWaveMode = usePlayerStore((s) => s.isWaveMode);
  const waveType = usePlayerStore((s) => s.waveType);
  const waveArtist = usePlayerStore((s) => s.waveArtist);
  const loadLikedIds = useFavouritesStore((s) => s.loadLikedIds);

  const [artistMonet, setArtistMonet] = useState<MonetTheme | null>(null);
  const mainAreaRef = useRef<HTMLElement>(null);
  const auroraRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadLikedIds();
  }, [loadLikedIds]);

  useEffect(() => {
    if (isWaveMode && waveType === 'artist' && waveArtist) {
      if (waveArtist.palette) {
        setArtistMonet(extractMonetThemeFromPalette(waveArtist.palette));
      } else if (waveArtist.imageUrl) {
        extractMonetFromImage(waveArtist.imageUrl).then(setArtistMonet);
      } else {
        setArtistMonet(null);
      }
    } else {
      setArtistMonet(null);
    }
  }, [isWaveMode, waveType, waveArtist]);

  useEffect(() => {
    if (artistMonet) {
      document.documentElement.style.setProperty('--wave-mood-rgb', artistMonet.glowRgb);
      document.documentElement.style.setProperty('--aurora-secondary-rgb', artistMonet.secondaryRgb);
    } else {
      const rgb = waveMood?.activeRgb ?? '112, 220, 85';
      document.documentElement.style.setProperty('--wave-mood-rgb', rgb);
      document.documentElement.style.removeProperty('--aurora-secondary-rgb');
    }
  }, [artistMonet, waveMood]);

  useEffect(() => {
    const mainEl = mainAreaRef.current;
    if (!mainEl) return;

    let scrollTimer: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      if (auroraRef.current) {
        auroraRef.current.style.transform = `translate3d(0, -${mainEl.scrollTop}px, 0)`;
      }

      mainEl.classList.add('is-scrolling');
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        mainEl.classList.remove('is-scrolling');
      }, 1000);
    };

    mainEl.addEventListener('scroll', handleScroll, { passive: true });
    if (auroraRef.current) {
      auroraRef.current.style.transform = `translate3d(0, -${mainEl.scrollTop}px, 0)`;
    }

    return () => {
      mainEl.removeEventListener('scroll', handleScroll);
      if (scrollTimer) clearTimeout(scrollTimer);
    };
  }, [location.pathname]);

  return (
    <div className={`app-layout ${isHome ? 'app-layout--home' : ''}`}>
      <div
        ref={auroraRef}
        className={`app-backdrop-aurora ${isHome ? 'app-backdrop-aurora--home' : ''} ${
          isPlaying ? 'app-backdrop-aurora--playing' : ''
        }`}
      >
        <AuroraCanvas className="app-backdrop-aurora__canvas" />
        <div className="app-backdrop-aurora__layer1" />
        <div className="app-backdrop-aurora__layer2" />
        <div className="app-backdrop-aurora__layer3" />
        <div className="app-backdrop-aurora__sidebar" />
        <div className="app-backdrop-aurora__flood" />
      </div>
      <TitleBar />
      <Sidebar />
      <main ref={mainAreaRef} className="main-area">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/sound-energy" element={<SoundEnergyPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/favourites" element={<FavouritesPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/playlist/:id" element={<PlaylistDetailPage />} />
          <Route path="/album/:id" element={<AlbumDetailPage />} />
          <Route path="/artist/:id" element={<ArtistDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ToastContainer />
      <PlayerBar />
      <FullscreenPlayer />
    </div>
  );
}

export default function App() {
  const { isLoading, isAuthenticated, isGuest, showLoginModal, checkAuth, closeLoginModal } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-primary)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '2.5rem',
            fontWeight: 800,
            background: 'linear-gradient(135deg, var(--accent-light), var(--accent))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            marginBottom: '16px',
          }}
        >
          Звук
        </div>
        <div
          style={{
            width: '32px',
            height: '32px',
            border: '3px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!isAuthenticated && !isGuest) {
    return (
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <AppShell />
      {showLoginModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeLoginModal();
          }}
        >
          <div style={{ position: 'relative', width: '100%', maxWidth: '440px' }}>
            <button
              onClick={closeLoginModal}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                zIndex: 10,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '20px',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
            <LoginPage />
          </div>
        </div>
      )}
    </BrowserRouter>
  );
}
