import React from 'react';
import type { Playlist, Track } from '../../../api';

interface PlaylistCoverProps {
  playlist: Playlist;
  tracks?: Track[] | null;
  className?: string;
  style?: React.CSSProperties;
}

export const PlaylistCover: React.FC<PlaylistCoverProps> = ({
  playlist,
  tracks,
  className = '',
  style,
}) => {
  // If tracks are provided (e.g. from detail page), use them;
  // otherwise fallback to playlist.tracks or playlist.cover_urls.
  const activeTracks = tracks ?? playlist.tracks ?? null;

  let coverUrls: string[] = [];
  if (activeTracks && activeTracks.length > 0) {
    coverUrls = activeTracks
      .slice(0, 4)
      .map((t) => t.cover_url)
      .filter((url): url is string => Boolean(url));
  } else if (playlist.cover_urls && playlist.cover_urls.length > 0) {
    coverUrls = playlist.cover_urls.filter((url): url is string => Boolean(url));
  }

  const trackCount =
    activeTracks?.length ??
    playlist.tracks?.length ??
    playlist.track_ids?.length ??
    playlist.track_count ??
    0;

  // Case 1: If it's a curated playlist that already has its own custom artwork
  // and no track covers collage was built for it:
  if (playlist.cover_url && (!playlist.cover_urls || playlist.cover_urls.length === 0) && !tracks) {
    return (
      <img
        src={playlist.cover_url}
        alt={playlist.title}
        className={`playlist-cover-single ${className}`}
        style={style}
        loading="lazy"
      />
    );
  }

  // Case 2: 4 or more tracks and we have at least 4 covers -> 2x2 collage
  if (trackCount >= 4 && coverUrls.length >= 4) {
    return (
      <div className={`playlist-cover-collage ${className}`} style={style}>
        {coverUrls.slice(0, 4).map((url, i) => (
          <img
            key={i}
            src={url}
            alt=""
            className="playlist-cover-collage__item"
            loading="lazy"
          />
        ))}
      </div>
    );
  }

  // Case 3: 1 to 3 tracks (or 4+ tracks with fewer than 4 distinct covers)
  // Display the cover of the topmost track
  if (coverUrls.length > 0) {
    return (
      <img
        src={coverUrls[0]}
        alt={playlist.title}
        className={`playlist-cover-single ${className}`}
        style={style}
        loading="lazy"
      />
    );
  }

  // Case 4: Curated playlist fallback if playlist.cover_url exists
  if (playlist.cover_url) {
    return (
      <img
        src={playlist.cover_url}
        alt={playlist.title}
        className={`playlist-cover-single ${className}`}
        style={style}
        loading="lazy"
      />
    );
  }

  // Case 5: 0 tracks or no cover available -> Placeholder icon
  return (
    <div
      className={`playlist-cover-fallback ${className}`}
      style={style}
      aria-label={playlist.title}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 18V5L21 3V16" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
};
