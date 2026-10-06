import { useEffect } from 'react';
import { usePlayerStore } from './playerStore';
import { useFavouritesStore } from '../favourites/favouritesStore';

/**
 * Global keyboard shortcuts for the player.
 *
 * Space           – Play / Pause
 * L               – Toggle like on current track
 * ← / →          – Seek −5 / +5 seconds
 * Shift+← / →    – Previous / Next track
 * ↑ / ↓          – Volume +5% / −5%
 * M               – Toggle mute
 * S               – Toggle shuffle
 * R               – Cycle repeat mode
 *
 * Shortcuts are suppressed when focus is inside an <input>, <textarea>, or
 * any element with [contenteditable], so the user can type normally.
 */
export function useHotkeys() {
  const {
    currentTrack,
    isPlaying,
    progress,
    duration,
    volume,
    togglePlay,
    seekTo,
    nextTrack,
    previousTrack,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    isFullscreenPlayerOpen,
    openFullscreenPlayer,
    closeFullscreenPlayer,
  } = usePlayerStore();
  const toggleLikeTrack = useFavouritesStore((s) => s.toggleLikeTrack);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if focus is in a text input
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Ignore if Ctrl, Meta (Cmd), or Alt is held
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      const key = e.key;
      const code = e.code;

      // Space — play/pause (only if a track is loaded)
      if (code === 'Space' || key === ' ') {
        if (!currentTrack) return;
        e.preventDefault();
        togglePlay();
        return;
      }

      // L — toggle like on current track
      if (code === 'KeyL' || key === 'l' || key === 'L' || key === 'д' || key === 'Д') {
        if (!currentTrack) return;
        e.preventDefault();
        toggleLikeTrack(currentTrack.id);
        return;
      }

      // ArrowRight — seek forward / next track
      if (code === 'ArrowRight' || key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) {
          nextTrack();
        } else {
          if (!currentTrack) return;
          seekTo(Math.min(progress + 5, duration));
        }
        return;
      }

      // ArrowLeft — seek backward / prev track
      if (code === 'ArrowLeft' || key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) {
          previousTrack();
        } else {
          if (!currentTrack) return;
          seekTo(Math.max(progress - 5, 0));
        }
        return;
      }

      // ArrowUp — volume up
      if (code === 'ArrowUp' || key === 'ArrowUp') {
        e.preventDefault();
        setVolume(Math.min(volume + 0.05, 1));
        return;
      }

      // ArrowDown — volume down
      if (code === 'ArrowDown' || key === 'ArrowDown') {
        e.preventDefault();
        setVolume(Math.max(volume - 0.05, 0));
        return;
      }

      // M — toggle mute
      if (code === 'KeyM' || key === 'm' || key === 'M' || key === 'ь' || key === 'Ь') {
        e.preventDefault();
        toggleMute();
        return;
      }

      // S — toggle shuffle
      if (code === 'KeyS' || key === 's' || key === 'S' || key === 'ы' || key === 'Ы') {
        e.preventDefault();
        toggleShuffle();
        return;
      }

      // R — cycle repeat
      if (code === 'KeyR' || key === 'r' || key === 'R' || key === 'к' || key === 'К') {
        e.preventDefault();
        cycleRepeat();
        return;
      }

      // F — toggle fullscreen player
      if (code === 'KeyF' || key === 'f' || key === 'F' || key === 'а' || key === 'А') {
        if (!currentTrack) return;
        e.preventDefault();
        if (isFullscreenPlayerOpen) {
          closeFullscreenPlayer();
        } else {
          openFullscreenPlayer('track');
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    currentTrack,
    isPlaying,
    progress,
    duration,
    volume,
    togglePlay,
    seekTo,
    nextTrack,
    previousTrack,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    toggleLikeTrack,
  ]);
}
