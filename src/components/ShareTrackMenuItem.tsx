import { useRef, useState } from 'react';
import type { Track } from '../api';
import { ShareIcon } from './ShareIcon';
import { showToast } from './Toast';

interface ShareTrackMenuItemProps {
  track: Track;
  onClose: () => void;
}

interface ShareOption {
  key: 'album' | 'artist';
  label: string;
  url: string;
  toast: string;
}

/**
 * Split menu item for sharing a track (primary click) with a hover-triggered
 * arrow submenu for copying album and artist links.
 */
export function ShareTrackMenuItem({ track, onClose }: ShareTrackMenuItemProps) {
  const [isSubmenuOpen, setIsSubmenuOpen] = useState(false);
  const [flipLeft, setFlipLeft] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  const artistId = track.artist_id ?? track.artists?.[0]?.id;
  const extraOptions: ShareOption[] = [];

  if (track.album_id) {
    extraOptions.push({
      key: 'album',
      label: 'Поделиться альбомом',
      url: `https://zvuk.com/release/${track.album_id}`,
      toast: 'Ссылка на альбом скопирована',
    });
  }

  if (artistId) {
    extraOptions.push({
      key: 'artist',
      label: 'Поделиться артистом',
      url: `https://zvuk.com/artist/${artistId}`,
      toast: 'Ссылка на артиста скопирована',
    });
  }

  const handleCopy = (url: string, toastMessage: string) => {
    setIsSubmenuOpen(false);
    onClose();
    navigator.clipboard.writeText(url);
    showToast(toastMessage, 'success');
  };

  const openSubmenu = () => {
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      setFlipLeft(rect.right + 220 > window.innerWidth);
    }
    setIsSubmenuOpen(true);
  };

  return (
    <div
      ref={rowRef}
      className="share-menu-row"
      onMouseLeave={flipLeft ? () => setIsSubmenuOpen(false) : undefined}
    >
      <button
        type="button"
        className="share-menu-row__main"
        onClick={() => handleCopy(`https://zvuk.com/track/${track.id}`, 'Ссылка на трек скопирована')}
      >
        <ShareIcon size={16} />
        <span>Поделиться</span>
      </button>

      {extraOptions.length > 0 && (
        <div
          className={`share-menu-row__arrow-zone${isSubmenuOpen ? ' is-open' : ''}`}
          onMouseEnter={openSubmenu}
          onMouseLeave={!flipLeft ? () => setIsSubmenuOpen(false) : undefined}
        >
          <button
            type="button"
            className={`share-menu-row__arrow${isSubmenuOpen ? ' is-open' : ''}`}
            aria-label="Дополнительные опции поделиться"
            aria-expanded={isSubmenuOpen}
            onClick={(e) => {
              e.stopPropagation();
              if (isSubmenuOpen) {
                setIsSubmenuOpen(false);
              } else {
                openSubmenu();
              }
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          {isSubmenuOpen && (
            <div className={`share-menu-submenu${flipLeft ? ' share-menu-submenu--left' : ''}`}>
              {extraOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => handleCopy(opt.url, opt.toast)}
                >
                  <ShareIcon size={16} />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

