import React from 'react';
import { useNavigate } from 'react-router-dom';

export interface ArtistItem {
  id: number;
  name: string;
}

interface ArtistLinksProps {
  artists?: ArtistItem[] | null;
  artistId?: number | null;
  artistName?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

export function ArtistLinks({
  artists,
  artistId,
  artistName,
  className,
  style,
}: ArtistLinksProps) {
  const navigate = useNavigate();

  // If we have an array of artists with IDs
  if (artists && artists.length > 0) {
    return (
      <span className={className} style={style}>
        {artists.map((a, index) => (
          <React.Fragment key={`${a.id}-${index}`}>
            <span
              className="artist-link"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/artist/${a.id}`);
              }}
              title={a.name}
            >
              {a.name}
            </span>
            {index < artists.length - 1 && ', '}
          </React.Fragment>
        ))}
      </span>
    );
  }

  // Fallback if we only have single artistId & artistName
  if (artistId && artistName) {
    return (
      <span className={className} style={style}>
        <span
          className="artist-link"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/artist/${artistId}`);
          }}
          title={artistName}
        >
          {artistName}
        </span>
      </span>
    );
  }

  // Plain text fallback
  return (
    <span className={className} style={style}>
      {artistName || '—'}
    </span>
  );
}
