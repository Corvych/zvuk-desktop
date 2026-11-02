import { useEffect, useRef } from 'react';
import { usePlayerStore } from './playerStore';
import { useDiscordSettingsStore } from '../settings/discordSettingsStore';
import { updateDiscordActivity, getCoverUrl, type DiscordActivity } from '../../api';
import { getIsWindowFrozen } from '../../lib/windowFreezeStore';

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
  const { currentTrack, isPlaying, duration } = usePlayerStore();
  const { enabled, showPause, showButtons, syncWithBackend, checkStatus } = useDiscordSettingsStore();

  const lastTrackIdRef = useRef<number | string | null>(null);
  const lastIsPlayingRef = useRef<boolean | null>(null);
  const lastDurationRef = useRef<number>(0);
  const hasActivePresenceRef = useRef<boolean>(false);
  const seekDebounceTimerRef = useRef<number | null>(null);

  // Helper to send current player state to Discord
  const sendCurrentActivity = () => {
    const store = usePlayerStore.getState();
    const track = store.currentTrack;

    if (!track) {
      if (hasActivePresenceRef.current) {
        updateDiscordActivity(null).catch((err) =>
          console.warn('[DiscordPresence] Failed to clear activity:', err)
        );
        hasActivePresenceRef.current = false;
        lastTrackIdRef.current = null;
        lastIsPlayingRef.current = null;
        lastDurationRef.current = 0;
      }
      return;
    }

    const artistNames =
      track.artists && track.artists.length > 0
        ? track.artists.map((a) => a.name).join(', ')
        : track.artist || 'Неизвестный исполнитель';

    const coverUrl = track.cover_url
      ? getCoverUrl(track.cover_url, 'large')
      : null;

    const trackDuration = store.duration > 0 ? store.duration : track.duration || 0;

    const activity: DiscordActivity = {
      title: track.title || 'Музыкальный трек',
      artist: artistNames,
      album: track.album || null,
      cover_url: coverUrl,
      duration: trackDuration,
      position: store.progress || 0,
      is_playing: store.isPlaying,
      track_id: typeof track.id === 'number' ? track.id : Number(track.id) || null,
    };

    updateDiscordActivity(activity)
      .then(() => {
        hasActivePresenceRef.current = true;
        lastTrackIdRef.current = track.id;
        lastIsPlayingRef.current = store.isPlaying;
        lastDurationRef.current = trackDuration;
      })
      .catch((err) => console.warn('[DiscordPresence] Update error:', err));
  };

  // Sync settings with Rust backend on mount & periodically check Discord IPC connection
  useEffect(() => {
    syncWithBackend();

    const intervalId = window.setInterval(() => {
      if (getIsWindowFrozen()) return;
      if (useDiscordSettingsStore.getState().enabled) {
        checkStatus();
      }
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [syncWithBackend, checkStatus]);

  // Main presence synchronization effect (track change, play/pause, duration load, settings toggle)
  useEffect(() => {
    if (!enabled || !currentTrack) {
      if (hasActivePresenceRef.current) {
        updateDiscordActivity(null).catch((err) =>
          console.warn('[DiscordPresence] Failed to clear activity:', err)
        );
        hasActivePresenceRef.current = false;
        lastTrackIdRef.current = null;
        lastIsPlayingRef.current = null;
        lastDurationRef.current = 0;
      }
      return;
    }

    // Cancel any pending seek debounce on track or play state change
    if (seekDebounceTimerRef.current) {
      window.clearTimeout(seekDebounceTimerRef.current);
      seekDebounceTimerRef.current = null;
    }

    sendCurrentActivity();
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
    duration,
  ]);

  // Dedicated seek detection via playerStore subscription (avoids re-rendering and debounce cancellation on every progress tick)
  useEffect(() => {
    let lastKnownProgress = usePlayerStore.getState().progress || 0;
    let lastKnownTime = Date.now();

    const unsubscribe = usePlayerStore.subscribe((state) => {
      const now = Date.now();
      const currentProgress = state.progress || 0;
      const timeDelta = (now - lastKnownTime) / 1000;
      lastKnownTime = now;

      const isPlaying = state.isPlaying;
      const expectedProgress = isPlaying ? lastKnownProgress + timeDelta : lastKnownProgress;
      const jumped = Math.abs(currentProgress - expectedProgress) > 2.5;

      lastKnownProgress = currentProgress;

      if (jumped && state.currentTrack && useDiscordSettingsStore.getState().enabled) {
        if (seekDebounceTimerRef.current) {
          window.clearTimeout(seekDebounceTimerRef.current);
        }
        seekDebounceTimerRef.current = window.setTimeout(() => {
          sendCurrentActivity();
          seekDebounceTimerRef.current = null;
        }, 400);
      }
    });

    return () => {
      unsubscribe();
      if (seekDebounceTimerRef.current) {
        window.clearTimeout(seekDebounceTimerRef.current);
        seekDebounceTimerRef.current = null;
      }
    };
  }, []);
}
