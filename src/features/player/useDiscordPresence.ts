import { useEffect, useRef } from 'react';
import { usePlayerStore } from './playerStore';
import { useDiscordSettingsStore } from '../settings/discordSettingsStore';
import { updateDiscordActivity, getCoverUrl, type DiscordActivity } from '../../api';

/**
 * Synchronises player state with Discord Rich Presence.
 *
 * Implements a Spotify-like musical presence:
 *  - Listening to <App Name>
 *  - Song title (details)
 *  - Artist names (state)
 *  - High-res cover art (large image)
 *  - Album title (large image text)
 *  - Interactive progress bar (start & end timestamps)
 *  - Play / Pause status badge
 *  - Button to listen on zvuk.com
 */
export function useDiscordPresence() {
  const { currentTrack, isPlaying, progress, duration } = usePlayerStore();
  const { enabled, showPause, showButtons, syncWithBackend, checkStatus } = useDiscordSettingsStore();

  const lastTrackIdRef = useRef<number | string | null>(null);
  const lastIsPlayingRef = useRef<boolean | null>(null);
  const lastSyncTimeRef = useRef<number>(0);
  const lastReportedProgressRef = useRef<number>(0);
  const hasActivePresenceRef = useRef<boolean>(false);
  const seekDebounceTimerRef = useRef<number | null>(null);

  // Sync settings with Rust backend on mount & periodically check Discord IPC connection
  useEffect(() => {
    syncWithBackend();

    const intervalId = window.setInterval(() => {
      if (useDiscordSettingsStore.getState().enabled) {
        checkStatus();
      }
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [syncWithBackend, checkStatus]);

  // Main presence synchronization effect
  useEffect(() => {
    if (!enabled || !currentTrack) {
      if (hasActivePresenceRef.current) {
        updateDiscordActivity(null).catch((err) =>
          console.warn('[DiscordPresence] Failed to clear activity:', err)
        );
        hasActivePresenceRef.current = false;
        lastTrackIdRef.current = null;
        lastIsPlayingRef.current = null;
      }
      return;
    }

    const now = Date.now();
    const trackChanged = lastTrackIdRef.current !== currentTrack.id;
    const playStateChanged = lastIsPlayingRef.current !== isPlaying;

    // Check if progress deviated significantly from natural playback (user seeked)
    const timeSinceLastSync = (now - lastSyncTimeRef.current) / 1000;
    const expectedProgress = lastReportedProgressRef.current + (isPlaying ? timeSinceLastSync : 0);
    const progressJumped = Math.abs(progress - expectedProgress) > 3.5;

    const shouldSendImmediately = trackChanged || playStateChanged;

    const buildAndSendActivity = () => {
      const artistNames =
        currentTrack.artists && currentTrack.artists.length > 0
          ? currentTrack.artists.map((a) => a.name).join(', ')
          : currentTrack.artist || 'Неизвестный исполнитель';

      const coverUrl = currentTrack.cover_url
        ? getCoverUrl(currentTrack.cover_url, 'large')
        : null;

      const trackDuration = duration > 0 ? duration : currentTrack.duration;

      const activity: DiscordActivity = {
        title: currentTrack.title || 'Музыкальный трек',
        artist: artistNames,
        album: currentTrack.album || null,
        cover_url: coverUrl,
        duration: trackDuration,
        position: progress,
        is_playing: isPlaying,
        track_id: typeof currentTrack.id === 'number' ? currentTrack.id : Number(currentTrack.id) || null,
      };

      updateDiscordActivity(activity)
        .then(() => {
          hasActivePresenceRef.current = true;
          lastTrackIdRef.current = currentTrack.id;
          lastIsPlayingRef.current = isPlaying;
          lastSyncTimeRef.current = Date.now();
          lastReportedProgressRef.current = progress;
        })
        .catch((err) => console.warn('[DiscordPresence] Update error:', err));
    };

    if (shouldSendImmediately) {
      if (seekDebounceTimerRef.current) {
        window.clearTimeout(seekDebounceTimerRef.current);
        seekDebounceTimerRef.current = null;
      }
      buildAndSendActivity();
    } else if (progressJumped) {
      // Debounce seek updates by 400ms while user drags the slider
      if (seekDebounceTimerRef.current) {
        window.clearTimeout(seekDebounceTimerRef.current);
      }
      seekDebounceTimerRef.current = window.setTimeout(() => {
        buildAndSendActivity();
        seekDebounceTimerRef.current = null;
      }, 400);
    }

    return () => {
      if (seekDebounceTimerRef.current) {
        window.clearTimeout(seekDebounceTimerRef.current);
      }
    };
  }, [
    enabled,
    showPause,
    showButtons,
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.artist,
    currentTrack?.album,
    currentTrack?.cover_url,
    isPlaying,
    progress,
    duration,
  ]);
}
