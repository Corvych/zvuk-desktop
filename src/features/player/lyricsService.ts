import { getLyrics, type Track } from '../../api';
import { useLyricsSettingsStore } from '../settings/lyricsSettingsStore';

export interface ResolvedLyrics {
  lyrics: string;
  is_synced: boolean;
  has_word_sync?: boolean;
  format?: 'lrc' | 'yrc' | 'ttml';
  source: 'zvuk' | 'betterlyrics' | 'netease' | 'lrclib';
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

export async function fetchNeteaseLyrics(track: Track): Promise<ResolvedLyrics | null> {
  try {
    const artist = track.artist.trim();
    const title = track.title.trim();
    const cleanedTitle = cleanTitleForSearch(title);
    const durationSec = Math.round(track.duration);

    const primaryArtist = artist.split(/[,&/]|feat\.|ft\./i)[0].trim();
    const queries = [
      `${cleanedTitle || title} ${primaryArtist}`,
      `${cleanedTitle || title} ${artist}`,
      cleanedTitle || title,
    ];

    let foundSongId: number | null = null;

    for (const q of queries) {
      const searchUrl = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(q)}&type=1&offset=0&limit=5`;
      const sRes = await fetch(searchUrl);
      if (!sRes.ok) continue;

      const sData = await sRes.json();
      const songs = sData.result?.songs;
      if (Array.isArray(songs) && songs.length > 0) {
        let best = songs[0];
        if (durationSec > 0) {
          let minDiff = Math.abs((best.dt || 0) / 1000 - durationSec);
          for (const s of songs) {
            const diff = Math.abs((s.dt || 0) / 1000 - durationSec);
            if (diff < minDiff) {
              minDiff = diff;
              best = s;
            }
          }
        }
        foundSongId = best.id;
        break;
      }
    }

    if (!foundSongId) return null;

    const lyricUrl = `https://music.163.com/api/song/lyric?id=${foundSongId}&lv=1&kv=1&tv=1&yv=1`;
    const lRes = await fetch(lyricUrl);
    if (!lRes.ok) return null;

    const lData = await lRes.json();

    // 1. Prefer YRC (Word/Syllable sync Enhanced Karaoke)
    if (lData.yrc?.lyric && lData.yrc.lyric.trim()) {
      return {
        lyrics: lData.yrc.lyric,
        is_synced: true,
        has_word_sync: true,
        format: 'yrc',
        source: 'netease',
        sourceLabel: 'NetEase (Word-Sync)',
      };
    }

    // 2. Standard LRC
    if (lData.lrc?.lyric && lData.lrc.lyric.trim()) {
      return {
        lyrics: lData.lrc.lyric,
        is_synced: true,
        has_word_sync: false,
        format: 'lrc',
        source: 'netease',
        sourceLabel: 'NetEase',
      };
    }
  } catch (err) {
    console.warn('[LyricsService] NetEase fetch failed:', err);
  }
  return null;
}

export async function fetchBetterLyrics(track: Track): Promise<ResolvedLyrics | null> {
  try {
    const artist = track.artist.trim();
    const title = track.title.trim();
    const cleanedTitle = cleanTitleForSearch(title);
    const durationSec = Math.round(track.duration);

    // 1. Exact query by track & artist
    const queryUrl = `https://lrc.red/api/v1?track=${encodeURIComponent(cleanedTitle || title)}&artist=${encodeURIComponent(artist)}`;
    let res = await fetch(queryUrl);

    interface LrcRedItem {
      id: string;
      track_name: string;
      artist_name: string;
      duration?: number;
      timing_type?: 'word' | 'line' | 'none';
      lyricsUrl: string;
    }

    interface LrcRedResponse {
      results?: LrcRedItem[];
    }

    let data: LrcRedResponse | null = null;
    if (res.ok) {
      data = await res.json();
    }

    // 2. Fallback query by general string search if no results
    if (!data?.results || data.results.length === 0) {
      const primaryArtist = artist.split(/[,&/]|feat\.|ft\./i)[0].trim();
      const fallbackQuery = `${cleanedTitle || title} ${primaryArtist || artist}`;
      const searchUrl = `https://lrc.red/api/v1?q=${encodeURIComponent(fallbackQuery)}`;
      const sRes = await fetch(searchUrl);
      if (sRes.ok) {
        data = await sRes.json();
      }
    }

    const items = data?.results;
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    // Prefer word-synced entries, then line-synced
    const wordItems = items.filter((it) => it.timing_type === 'word' && it.lyricsUrl);
    const lineItems = items.filter((it) => it.timing_type === 'line' && it.lyricsUrl);
    const candidateList = wordItems.length > 0 ? wordItems : lineItems.length > 0 ? lineItems : items;

    // Pick item with duration closest to track duration
    let bestItem: LrcRedItem = candidateList[0];
    if (durationSec > 0) {
      let minDiff = Math.abs((bestItem.duration || 0) - durationSec);
      for (const it of candidateList) {
        const diff = Math.abs((it.duration || 0) - durationSec);
        if (diff < minDiff) {
          minDiff = diff;
          bestItem = it;
        }
      }
    }

    if (!bestItem?.lyricsUrl) return null;

    // Fetch the TTML / LRC content
    const lyricsRes = await fetch(bestItem.lyricsUrl);
    if (!lyricsRes.ok) return null;

    const lyricsText = await lyricsRes.text();
    if (!lyricsText || !lyricsText.trim()) return null;

    const isWordSync = bestItem.timing_type === 'word' || lyricsText.includes('<span begin=');

    return {
      lyrics: lyricsText,
      is_synced: bestItem.timing_type !== 'none',
      has_word_sync: isWordSync,
      format: lyricsText.includes('<tt') ? 'ttml' : 'lrc',
      source: 'betterlyrics',
      sourceLabel: isWordSync ? 'Better Lyrics (Word-Sync)' : 'Better Lyrics',
    };
  } catch (err) {
    console.warn('[LyricsService] Better Lyrics fetch failed:', err);
  }
  return null;
}

const trackSourceLyricsCache = new Map<string, ResolvedLyrics | null>();
const trackUnifiedLyricsCache = new Map<string, ResolvedLyrics | null>();
const trackProbedSourcesCache = new Map<number, Record<string, SourceAvailability>>();

export function getCachedUnifiedLyrics(
  trackId: number,
  preferredSource?: string | null
): ResolvedLyrics | null | undefined {
  const key = `${trackId}:${preferredSource || 'auto'}`;
  if (trackUnifiedLyricsCache.has(key)) {
    return trackUnifiedLyricsCache.get(key) ?? null;
  }
  if (preferredSource && trackSourceLyricsCache.has(`${trackId}:${preferredSource}`)) {
    return trackSourceLyricsCache.get(`${trackId}:${preferredSource}`) ?? null;
  }
  return undefined;
}

export function getCachedProbeResults(
  trackId: number
): Record<string, SourceAvailability> | undefined {
  return trackProbedSourcesCache.get(trackId);
}

export function clearLyricsCacheForTrack(trackId: number) {
  for (const key of trackSourceLyricsCache.keys()) {
    if (key.startsWith(`${trackId}:`)) {
      trackSourceLyricsCache.delete(key);
    }
  }
  for (const key of trackUnifiedLyricsCache.keys()) {
    if (key.startsWith(`${trackId}:`)) {
      trackUnifiedLyricsCache.delete(key);
    }
  }
  trackProbedSourcesCache.delete(trackId);
}

export interface SourceAvailability {
  source: 'betterlyrics' | 'netease' | 'zvuk' | 'lrclib';
  status: 'loading' | 'available' | 'not_found';
  hasWordSync?: boolean;
  isSynced?: boolean;
  lyrics?: ResolvedLyrics;
}

export async function fetchLyricsBySource(
  track: Track,
  source: 'zvuk' | 'betterlyrics' | 'netease' | 'lrclib'
): Promise<ResolvedLyrics | null> {
  const cacheKey = `${track.id}:${source}`;
  if (trackSourceLyricsCache.has(cacheKey)) {
    return trackSourceLyricsCache.get(cacheKey) ?? null;
  }

  let result: ResolvedLyrics | null = null;
  if (source === 'zvuk') {
    result = await fetchZvukLyrics(track.id);
  } else if (source === 'betterlyrics') {
    result = await fetchBetterLyrics(track);
  } else if (source === 'netease') {
    result = await fetchNeteaseLyrics(track);
  } else {
    result = await fetchLrclibLyrics(track);
  }

  trackSourceLyricsCache.set(cacheKey, result);
  return result;
}

export async function probeAllSources(
  track: Track,
  onUpdate?: (source: 'betterlyrics' | 'netease' | 'zvuk' | 'lrclib', avail: SourceAvailability) => void
): Promise<Record<string, SourceAvailability>> {
  // If already probed for this track, return immediately from cache!
  const cached = trackProbedSourcesCache.get(track.id);
  if (cached) {
    if (onUpdate) {
      for (const [src, avail] of Object.entries(cached)) {
        onUpdate(src as any, avail);
      }
    }
    return cached;
  }

  const {
    enableZvuk,
    enableBetterLyrics,
    enableNetease,
    enableLrclib,
    sourceOrder = ['betterlyrics', 'netease', 'zvuk', 'lrclib'],
  } = useLyricsSettingsStore.getState();

  const sources = sourceOrder.filter((s) => {
    if (s === 'zvuk') return enableZvuk;
    if (s === 'betterlyrics') return enableBetterLyrics;
    if (s === 'netease') return enableNetease;
    if (s === 'lrclib') return enableLrclib;
    return true;
  });

  const results: Record<string, SourceAvailability> = {};
  for (const src of sources) {
    // If individual source is already fetched in cache, notify immediately
    const srcKey = `${track.id}:${src}`;
    if (trackSourceLyricsCache.has(srcKey)) {
      const cachedSrc = trackSourceLyricsCache.get(srcKey);
      if (cachedSrc && cachedSrc.lyrics && cachedSrc.lyrics.trim()) {
        results[src] = {
          source: src,
          status: 'available',
          hasWordSync: !!cachedSrc.has_word_sync,
          isSynced: !!cachedSrc.is_synced,
          lyrics: cachedSrc,
        };
      } else {
        results[src] = { source: src, status: 'not_found' };
      }
    } else {
      results[src] = { source: src, status: 'loading' };
    }
    onUpdate?.(src, results[src]);
  }

  await Promise.allSettled(
    sources.map(async (src) => {
      if (results[src]?.status !== 'loading') {
        return;
      }
      try {
        const res = await fetchLyricsBySource(track, src);
        if (res && res.lyrics && res.lyrics.trim()) {
          results[src] = {
            source: src,
            status: 'available',
            hasWordSync: !!res.has_word_sync,
            isSynced: !!res.is_synced,
            lyrics: res,
          };
        } else {
          results[src] = {
            source: src,
            status: 'not_found',
          };
        }
      } catch {
        results[src] = {
          source: src,
          status: 'not_found',
        };
      }
      onUpdate?.(src, results[src]);
    })
  );

  trackProbedSourcesCache.set(track.id, results);
  return results;
}

export async function fetchUnifiedLyrics(
  track: Track,
  preferredSource?: 'zvuk' | 'betterlyrics' | 'netease' | 'lrclib'
): Promise<ResolvedLyrics | null> {
  const cacheKey = `${track.id}:${preferredSource || 'auto'}`;
  if (trackUnifiedLyricsCache.has(cacheKey)) {
    return trackUnifiedLyricsCache.get(cacheKey) ?? null;
  }

  const {
    enableZvuk,
    enableBetterLyrics,
    enableNetease,
    enableLrclib,
    preferWordSync,
    sourceOrder = ['betterlyrics', 'netease', 'zvuk', 'lrclib'],
  } = useLyricsSettingsStore.getState();

  if (!enableZvuk && !enableBetterLyrics && !enableNetease && !enableLrclib) {
    trackUnifiedLyricsCache.set(cacheKey, null);
    return null;
  }

  let finalResult: ResolvedLyrics | null = null;

  // 1. Explicit manual source selection (e.g. user clicked source switcher in HUD)
  if (preferredSource) {
    finalResult = await fetchLyricsBySource(track, preferredSource);
    trackUnifiedLyricsCache.set(cacheKey, finalResult);
    return finalResult;
  }

  // 2. If preferWordSync is enabled, proactively query Enhanced word-level sync providers first!
  if (preferWordSync) {
    const wordSyncOrder = sourceOrder.filter(
      (s): s is 'betterlyrics' | 'netease' => s === 'betterlyrics' || s === 'netease'
    );

    for (const wsSource of wordSyncOrder) {
      if (wsSource === 'betterlyrics' && !enableBetterLyrics) continue;
      if (wsSource === 'netease' && !enableNetease) continue;

      const wsLyrics = await fetchLyricsBySource(track, wsSource);
      if (wsLyrics && wsLyrics.has_word_sync) {
        finalResult = wsLyrics;
        trackUnifiedLyricsCache.set(cacheKey, finalResult);
        return finalResult;
      }
    }
  }

  // 3. Chain through all enabled sources according to configured priority order
  let firstPlainFallback: ResolvedLyrics | null = null;

  for (const src of sourceOrder) {
    if (src === 'zvuk' && !enableZvuk) continue;
    if (src === 'betterlyrics' && !enableBetterLyrics) continue;
    if (src === 'netease' && !enableNetease) continue;
    if (src === 'lrclib' && !enableLrclib) continue;

    const candidate = await fetchLyricsBySource(track, src);
    if (candidate) {
      if (candidate.is_synced) {
        finalResult = candidate;
        trackUnifiedLyricsCache.set(cacheKey, finalResult);
        return finalResult;
      }
      if (!firstPlainFallback) {
        firstPlainFallback = candidate;
      }
    }
  }

  finalResult = firstPlainFallback;
  trackUnifiedLyricsCache.set(cacheKey, finalResult);
  return finalResult;
}


