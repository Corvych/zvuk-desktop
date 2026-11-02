import { useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore } from './playerStore';
import { getStreamUrl } from '../../api';
import { getOrCreateAudio, setupAudioContext, resumeAudioContext, clearAudioSource } from './audioService';

class CustomHlsLoader extends (Hls.DefaultConfig.loader as any) {
  load(context: any, config: any, callbacks: any) {
    if (context.url && (context.url.includes('keyserver') || context.type === 'key')) {
      const stats = this.stats;
      const now = performance.now();
      stats.loading.start = now;
      stats.loading.first = now;
      invoke<number[]>('fetch_audio_key', { url: context.url })
        .then((bytes) => {
          stats.loading.end = performance.now();
          stats.loaded = bytes.length;
          stats.total = bytes.length;
          const u8 = new Uint8Array(bytes);
          console.log('[HLS CustomLoader] Key delivered to hls.js, bytes:', bytes.length);
          callbacks.onSuccess(
            { url: context.url, data: u8.buffer, code: 200 },
            stats,
            context,
            null
          );
        })
        .catch((err) => {
          console.error('[HLS CustomLoader] Failed to fetch key via Tauri invoke:', err);
          callbacks.onError({ code: 500, text: String(err) }, context, null, stats);
        });
      return;
    }
    super.load(context, config, callbacks);
  }
}

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
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

  const attachStream = useCallback((streamUrl: string, startTime = 0) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (streamUrl.includes('.m3u8') && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: true,
        loader: CustomHlsLoader as any,
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.warn('[HLS Audio Player] HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('[HLS Audio Player] Fatal media error, attempting recovery...');
              hls.recoverMediaError();
              return;
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('[HLS Audio Player] Fatal network error, attempting startLoad...');
              hls.startLoad();
              return;
            default:
              console.error('[HLS Audio Player] Fatal unrecoverable error:', data.type, data.details);
              break;
          }

          hls.destroy();
          hlsRef.current = null;
          // Fallback to high MP3 if HLS fails (e.g. keyserver blocked by VPN)
          const curr = usePlayerStore.getState().currentTrack;
          if (curr) {
            getStreamUrl(curr.id, 'high')
              .then((fallbackInfo) => {
                if (audioRef.current) {
                  usePlayerStore.getState().setStreamInfo(fallbackInfo);
                  attachStream(fallbackInfo.url);
                }
              })
              .catch((e) => console.error('[Audio Player] Fallback stream failed:', e));
          }
        }
      });

      hls.attachMedia(audio);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(streamUrl);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        // Prioritize the lossless FLAC level when FLAC is requested
        const preferredQuality = usePlayerStore.getState().quality;
        let selectedIdx = -1;

        if (preferredQuality === 'flac') {
          selectedIdx = data.levels.findIndex(
            (lvl) =>
              lvl.audioCodec?.toLowerCase().includes('flac') ||
              lvl.codecSet?.toLowerCase().includes('flac') ||
              lvl.url?.some((u) => u.toLowerCase().includes('lossless') || u.toLowerCase().includes('flac')) ||
              (lvl as any)._attrs?.some((a: any) => a.CODECS?.toLowerCase().includes('flac'))
          );
        }

        if (selectedIdx === -1) {
          // If preferred quality is high or fallback, choose the highest bitrate level
          let maxBw = -1;
          data.levels.forEach((lvl, idx) => {
            if (lvl.bitrate > maxBw) {
              maxBw = lvl.bitrate;
              selectedIdx = idx;
            }
          });
        }

        if (selectedIdx !== -1) {
          hls.currentLevel = selectedIdx;
        }

        // Synchronize active level metadata with player store streamInfo
        const activeLevel = data.levels[hls.currentLevel >= 0 ? hls.currentLevel : selectedIdx];
        if (activeLevel) {
          const isLevelFlac =
            activeLevel.audioCodec?.toLowerCase().includes('flac') ||
            activeLevel.codecSet?.toLowerCase().includes('flac') ||
            activeLevel.url?.some((u) => u.toLowerCase().includes('lossless') || u.toLowerCase().includes('flac')) ||
            (activeLevel as any)._attrs?.some((a: any) => a.CODECS?.toLowerCase().includes('flac'));

          const currentInfo = usePlayerStore.getState().streamInfo;
          if (currentInfo) {
            const levelBitrate = Math.round(activeLevel.bitrate / 1000);
            usePlayerStore.getState().setStreamInfo({
              ...currentInfo,
              codec: isLevelFlac ? 'FLAC' : (activeLevel.audioCodec ? activeLevel.audioCodec.toUpperCase() : currentInfo.codec),
              quality: isLevelFlac ? 'Flac' : currentInfo.quality,
              bitrate: levelBitrate > 0 ? levelBitrate : currentInfo.bitrate,
              sample_rate: currentInfo.sample_rate || 44100,
              bit_depth: currentInfo.bit_depth || 16,
              channels: currentInfo.channels || 2,
            });
          }
        }
        if (startTime > 0) {
          try {
            audio.currentTime = startTime;
          } catch {}
        }
        if (usePlayerStore.getState().isPlaying) {
          audio.play().catch((err) => console.warn('[Audio Player] Play error:', err));
        }
      });

      hlsRef.current = hls;
      return;
    }

    // Direct MP3/AAC or native HLS (Safari)
    audio.src = streamUrl;
    if (startTime > 0) {
      try {
        audio.currentTime = startTime;
      } catch {}
    }
    if (usePlayerStore.getState().isPlaying) {
      audio.play().catch((err) => console.warn('[Audio Player] Play error:', err));
    }
  }, []);

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
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      clearAudioSource(audio);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, [setProgress, setDuration, nextTrack]);

  // Apply user-initiated seek to audio element
  useEffect(() => {
    if (seekTarget === null) return;
    const audio = audioRef.current;
    if (!audio) return;
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
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (!initialRestorePendingRef.current) {
        clearAudioSource(audio);
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
        a.volume = isMuted ? 0 : volume;

        let startTime = 0;
        if (initialRestorePendingRef.current) {
          initialRestorePendingRef.current = false;
          const savedProgress = usePlayerStore.getState().progress;
          if (savedProgress > 0) {
            startTime = savedProgress;
          }
        } else {
          a.currentTime = 0;
          setProgress(0);
        }

        activeTrackIdRef.current = currentTrack.id;
        attachStream(streamInfo.url, startTime);
      } catch (err) {
        console.error('[Audio Player] Failed to fetch stream URL:', err);
      }
    }

    loadStream();

    return () => {
      isSubscribed = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, attachStream]);

  // Sync play/pause toggle
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      resumeAudioContext();
      if (audio.src || hlsRef.current) {
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
            audioRef.current.volume = isMuted ? 0 : volume;
            let startTime = 0;
            if (initialRestorePendingRef.current) {
              initialRestorePendingRef.current = false;
              const savedProgress = usePlayerStore.getState().progress;
              if (savedProgress > 0) {
                startTime = savedProgress;
              }
            } else {
              audioRef.current.currentTime = 0;
            }
            activeTrackIdRef.current = currentTrack.id;
            attachStream(streamInfo.url, startTime);
          })
          .catch((err) => console.error('[Audio Player] Failed to fetch stream URL on play:', err));
      }
    } else {
      if (audio.src || hlsRef.current) {
        audio.pause();
      }
    }
  }, [isPlaying, currentTrack, isMuted, volume, setStreamInfo, attachStream]);

  // Sync volume & mute
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);
}
