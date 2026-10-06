import { useEffect } from 'react';
import { usePlayerStore } from './playerStore';

/**
 * Synchronises the current track with the browser's Media Session API.
 *
 * WebView2 (used by Tauri on Windows) forwards Media Session metadata and
 * action handlers directly to the Windows System Media Transport Controls
 * (SMTC), which powers the overlay shown in the volume OSD, the taskbar
 * thumbnail, and the hardware media-key handlers.
 *
 * Responsibilities:
 *  - Update `navigator.mediaSession.metadata` whenever the track changes.
 *  - Keep `navigator.mediaSession.playbackState` in sync with isPlaying.
 *  - Register action handlers so SMTC buttons call the correct store actions.
 *  - Update `setPositionState` on progress/duration changes so the seek bar
 *    in the SMTC overlay is accurate.
 */
export function useMediaSession() {
  const {
    currentTrack,
    isPlaying,
    progress,
    duration,
    togglePlay,
    nextTrack,
    previousTrack,
    seekTo,
  } = usePlayerStore();

  // ── Metadata ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album ?? undefined,
      artwork: currentTrack.cover_url
        ? [
            { src: currentTrack.cover_url, sizes: '512x512', type: 'image/jpeg' },
          ]
        : [],
    });
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.cover_url]);

  // ── Playback state ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  // ── Position state (seek bar in SMTC) ────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!duration || duration <= 0) return;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(progress, duration),
      });
    } catch {
      // setPositionState may throw if called before metadata is set
    }
  }, [progress, duration]);

  // ── Action handlers ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ['play',          () => { if (!isPlaying) togglePlay(); }],
      ['pause',         () => { if (isPlaying) togglePlay(); }],
      ['nexttrack',     () => nextTrack()],
      ['previoustrack', () => previousTrack()],
      ['seekto',        (details) => {
        if (details.seekTime !== undefined && details.seekTime !== null) {
          seekTo(details.seekTime);
        }
      }],
      ['seekforward',   (details) => {
        const skip = details.seekOffset ?? 10;
        seekTo(Math.min(progress + skip, duration));
      }],
      ['seekbackward',  (details) => {
        const skip = details.seekOffset ?? 10;
        seekTo(Math.max(progress - skip, 0));
      }],
    ];

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Some actions may not be supported in all environments
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // ignore
        }
      }
    };
  }, [isPlaying, progress, duration, togglePlay, nextTrack, previousTrack, seekTo]);
}
