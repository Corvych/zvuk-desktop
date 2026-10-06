import { useEffect, useRef } from 'react';
import { usePlayerStore } from './playerStore';
import { getStreamUrl } from '../../api';
import { getOrCreateAudio, setupAudioContext, resumeAudioContext } from './audioService';

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeTrackIdRef = useRef<string | number | null>(null);
  const initialRestorePendingRef = useRef<boolean>(true);

  const {
    currentTrack,
    isPlaying,
    volume,
    isMuted,
    seekTarget,
    setProgress,
    setDuration,
    nextTrack,
    setStreamInfo,
    clearSeekTarget,
  } = usePlayerStore();

  // Initialize HTML5 Audio instance once
  useEffect(() => {
    const audio = getOrCreateAudio();
    audioRef.current = audio;
    setupAudioContext(audio);

    const onTimeUpdate = () => {
      // Only record progress if this audio belongs to the currently active track
      if (activeTrackIdRef.current && activeTrackIdRef.current === usePlayerStore.getState().currentTrack?.id) {
        setProgress(audio.currentTime);
      }
    };

    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
      // Only restore saved progress once on cold app startup
      if (initialRestorePendingRef.current) {
        initialRestorePendingRef.current = false;
        const savedProgress = usePlayerStore.getState().progress;
        if (savedProgress > 0 && Math.abs(audio.currentTime - savedProgress) > 0.5) {
          try {
            audio.currentTime = savedProgress;
          } catch {
            // ignore if seek not yet permitted
          }
        }
      }
    };

    const onEnded = () => {
      nextTrack(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, [setProgress, setDuration, nextTrack]);

  // Apply user-initiated seek to audio element
  useEffect(() => {
    if (seekTarget === null) return;
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    // Only seek if the audio currently loaded matches current track
    if (activeTrackIdRef.current === currentTrack?.id) {
      audio.currentTime = seekTarget;
    }
    clearSeekTarget();
  }, [seekTarget, clearSeekTarget, currentTrack?.id]);

  // Sync track change & fetch stream URL with preferred quality
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    let isSubscribed = true;

    // If changing to a different track, stop current playback and reset position
    if (activeTrackIdRef.current !== currentTrack.id) {
      if (!initialRestorePendingRef.current) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        setProgress(0);
        clearSeekTarget();
      }
    }

    async function loadStream() {
      if (!currentTrack || !audioRef.current) return;
      const a = audioRef.current;

      try {
        const preferredQuality = usePlayerStore.getState().quality;
        const streamInfo = await getStreamUrl(currentTrack.id, preferredQuality);
        if (!isSubscribed) return;

        setStreamInfo(streamInfo);
        a.src = streamInfo.url;
        a.volume = isMuted ? 0 : volume;

        if (initialRestorePendingRef.current) {
          // Cold start: restore saved progress once
          initialRestorePendingRef.current = false;
          const savedProgress = usePlayerStore.getState().progress;
          if (savedProgress > 0) {
            try {
              a.currentTime = savedProgress;
            } catch {
              // will be applied in onLoadedMetadata
            }
          }
        } else {
          // Regular track change: always start cleanly at 0
          a.currentTime = 0;
          setProgress(0);
        }

        activeTrackIdRef.current = currentTrack.id;

        if (usePlayerStore.getState().isPlaying) {
          a.play().catch((err) => console.warn('[Audio Player] Play error:', err));
        }
      } catch (err) {
        console.error('[Audio Player] Failed to fetch stream URL:', err);
      }
    }

    loadStream();

    return () => {
      isSubscribed = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  // Sync play/pause toggle
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      resumeAudioContext();
      if (audio.src) {
        if (initialRestorePendingRef.current) {
          initialRestorePendingRef.current = false;
          const savedProgress = usePlayerStore.getState().progress;
          if (savedProgress > 0 && audio.currentTime === 0) {
            try {
              audio.currentTime = savedProgress;
            } catch {}
          }
        }
        audio.play().catch((err) => console.warn('[Audio Player] Play toggle error:', err));
      } else if (currentTrack) {
        const preferredQuality = usePlayerStore.getState().quality;
        getStreamUrl(currentTrack.id, preferredQuality)
          .then((streamInfo) => {
            if (!audioRef.current) return;
            setStreamInfo(streamInfo);
            audioRef.current.src = streamInfo.url;
            audioRef.current.volume = isMuted ? 0 : volume;
            if (initialRestorePendingRef.current) {
              initialRestorePendingRef.current = false;
              const savedProgress = usePlayerStore.getState().progress;
              if (savedProgress > 0) {
                try {
                  audioRef.current.currentTime = savedProgress;
                } catch {}
              }
            } else {
              audioRef.current.currentTime = 0;
            }
            activeTrackIdRef.current = currentTrack.id;
            audioRef.current.play().catch((err) => console.warn('[Audio Player] Play error:', err));
          })
          .catch((err) => console.error('[Audio Player] Failed to fetch stream URL on play:', err));
      }
    } else {
      if (audio.src) {
        audio.pause();
      }
    }
  }, [isPlaying, currentTrack, isMuted, volume, setStreamInfo]);

  // Sync volume & mute
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);
}
