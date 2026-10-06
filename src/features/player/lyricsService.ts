import { getLyrics, type Track } from '../../api';
import { useLyricsSettingsStore } from '../settings/lyricsSettingsStore';

export interface ResolvedLyrics {
  lyrics: string;
  is_synced: boolean;
  source: 'zvuk' | 'lrclib';
  sourceLabel: string;
}

// Helper to clean track titles from suffixes like "(Remastered 2011)", "[Deluxe]", etc.
function cleanTitleForSearch(title: string): string {
  return title
    .replace(/\((?:remastered|deluxe|bonus|live|radio edit|single version|anniversary)[^)]*\)/gi, '')
    .replace(/\[(?:remastered|deluxe|bonus|live|radio edit|single version|anniversary)[^\]]*\]/gi, '')
    .replace(/-\s*(?:remastered|deluxe|bonus|live|single version).*$/gi, '')
    .trim();
}

export async function fetchLrclibLyrics(track: Track): Promise<ResolvedLyrics | null> {
  try {
    const artist = track.artist.trim();
    const title = track.title.trim();
    const cleanedTitle = cleanTitleForSearch(title);
    const durationSec = Math.round(track.duration);

    // 1. Exact match query
    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanedTitle || title)}&artist_name=${encodeURIComponent(artist)}`;
    if (durationSec > 0) {
      url += `&duration=${durationSec}`;
    }
    if (track.album) {
      url += `&album_name=${encodeURIComponent(track.album.trim())}`;
    }

    let res = await fetch(url);

    // If 404 with duration & album, retry with just title and artist
    if (!res.ok && res.status === 404 && (durationSec > 0 || track.album)) {
      const fallbackUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanedTitle || title)}&artist_name=${encodeURIComponent(artist)}`;
      res = await fetch(fallbackUrl);
    }

    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics && data.syncedLyrics.trim()) {
        return {
          lyrics: data.syncedLyrics,
          is_synced: true,
          source: 'lrclib',
          sourceLabel: 'LRCLIB',
        };
      }
      if (data.plainLyrics && data.plainLyrics.trim()) {
        return {
          lyrics: data.plainLyrics,
          is_synced: false,
          source: 'lrclib',
          sourceLabel: 'LRCLIB',
        };
      }
    }

    // 2. Search fallback (with full artist query, and then primary artist query)
    const primaryArtist = artist.split(/[,&/]|feat\.|ft\./i)[0].trim();
    const searchQueries = [
      `${artist} ${cleanedTitle || title}`,
      primaryArtist && primaryArtist !== artist ? `${primaryArtist} ${cleanedTitle || title}` : null,
    ].filter(Boolean) as string[];

    for (const query of searchQueries) {
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
      const searchRes = await fetch(searchUrl);

      if (searchRes.ok) {
        const items = await searchRes.json();
        if (Array.isArray(items) && items.length > 0) {
          interface LrclibItem {
            id: number;
            trackName: string;
            artistName: string;
            duration?: number;
            syncedLyrics?: string | null;
            plainLyrics?: string | null;
          }

          const syncedItems = items.filter((it: LrclibItem) => it.syncedLyrics && it.syncedLyrics.trim());
          if (syncedItems.length > 0) {
            let bestItem = syncedItems[0];
            if (durationSec > 0) {
              let bestDiff = Math.abs((bestItem.duration || 0) - durationSec);
              for (const it of syncedItems) {
                const diff = Math.abs((it.duration || 0) - durationSec);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  bestItem = it;
                }
              }
            }
            return {
              lyrics: bestItem.syncedLyrics!,
              is_synced: true,
              source: 'lrclib',
              sourceLabel: 'LRCLIB',
            };
          }

          const plainItems = items.filter((it: LrclibItem) => it.plainLyrics && it.plainLyrics.trim());
          if (plainItems.length > 0) {
            return {
              lyrics: plainItems[0].plainLyrics!,
              is_synced: false,
              source: 'lrclib',
              sourceLabel: 'LRCLIB',
            };
          }
        }
      }
    }
  } catch (err) {
    console.warn('[LyricsService] LRCLIB fetch failed:', err);
  }
  return null;
}

export async function fetchZvukLyrics(trackId: number): Promise<ResolvedLyrics | null> {
  try {
    const data = await getLyrics(trackId);
    if (data && data.lyrics && data.lyrics.trim()) {
      return {
        lyrics: data.lyrics,
        is_synced: !!data.is_synced,
        source: 'zvuk',
        sourceLabel: 'Звук',
      };
    }
  } catch (err) {
    console.warn('[LyricsService] Zvuk lyrics fetch failed:', err);
  }
  return null;
}

export async function fetchUnifiedLyrics(track: Track): Promise<ResolvedLyrics | null> {
  const { enableZvuk, enableLrclib, priority } = useLyricsSettingsStore.getState();

  if (!enableZvuk && !enableLrclib) {
    return null;
  }

  if (priority === 'zvuk') {
    let zvukLyrics: ResolvedLyrics | null = null;
    if (enableZvuk) {
      zvukLyrics = await fetchZvukLyrics(track.id);
      if (zvukLyrics && zvukLyrics.is_synced) {
        return zvukLyrics;
      }
    }

    if (enableLrclib) {
      const lrclibLyrics = await fetchLrclibLyrics(track);
      if (lrclibLyrics && lrclibLyrics.is_synced) {
        return lrclibLyrics;
      }
      if (zvukLyrics) return zvukLyrics;
      if (lrclibLyrics) return lrclibLyrics;
    }

    return zvukLyrics;
  } else {
    // 'lrclib' priority
    let lrclibLyrics: ResolvedLyrics | null = null;
    if (enableLrclib) {
      lrclibLyrics = await fetchLrclibLyrics(track);
      if (lrclibLyrics && lrclibLyrics.is_synced) {
        return lrclibLyrics;
      }
    }

    if (enableZvuk) {
      const zvukLyrics = await fetchZvukLyrics(track.id);
      if (zvukLyrics && zvukLyrics.is_synced) {
        return zvukLyrics;
      }
      if (lrclibLyrics) return lrclibLyrics;
      if (zvukLyrics) return zvukLyrics;
    }

    return lrclibLyrics;
  }
}
