import { useEffect } from 'react';
import { usePlayerStore } from './playerStore';
import { updateTaskbarPlayback, isTauri } from '../../api';
import { listen } from '@tauri-apps/api/event';

/**
 * Synchronises the current track with:
 *  1. The browser's Media Session API (SMTC / volume overlay)
 *  2. Windows Taskbar Thumbnail Toolbar (mini-player under taskbar preview)
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
    queueIndex,
    queue,
    isWaveMode,
    queueContext,
  } = usePlayerStore();

  const canPrev = queueIndex > 0;
  const canNext = isWaveMode || (queueContext?.hasNext ?? false) || queueIndex < queue.length - 1;

  // ── Windows Taskbar Thumbnail Toolbar sync ────────────────────────────────
  useEffect(() => {
    updateTaskbarPlayback(isPlaying, canPrev, canNext);
  }, [isPlaying, canPrev, canNext]);

  // ── Listen for Windows Taskbar Thumbnail Toolbar clicks ───────────────────
  useEffect(() => {
    if (!isTauri()) return;

    let cleanups: (() => void)[] = [];
    let isCancelled = false;

    const setupListeners = async () => {
      try {
        const u1 = await listen('taskbar-prev', () => {
          usePlayerStore.getState().previousTrack();
        });
        const u2 = await listen('taskbar-play-pause', () => {
          usePlayerStore.getState().togglePlay();
        });
        const u3 = await listen('taskbar-next', () => {
          usePlayerStore.getState().nextTrack();
        });

        if (isCancelled) {
          u1();
          u2();
          u3();
        } else {
          cleanups.push(u1, u2, u3);
        }
      } catch (err) {
        console.warn('[useMediaSession] Failed to setup taskbar listeners:', err);
      }
    };

    setupListeners();

    return () => {
      isCancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);


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
