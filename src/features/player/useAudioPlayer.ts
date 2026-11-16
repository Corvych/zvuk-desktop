import { useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore } from './playerStore';
import { getStreamUrl, getTrack, type Track } from '../../api';
import { useSberCastStore, savePreCastVolume, restorePreCastVolume } from '../sbercast/sbercastStore';
import {
  sbercastPlayTrack,
  sbercastMediaPlay,
  sbercastMediaPause,
  sbercastSeek,
  sbercastSetVolume,
} from '../sbercast/sbercastApi';
import {
  getDeckAudio,
  setupAudioContext,
  resumeAudioContext,
  clearAudioSource,
  setMasterVolume,
  setDeckGain,
  type DeckId,
} from './audioService';

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

interface PendingCrossfade {
  outgoingDeck: DeckId;
  incomingDeck: DeckId;
  durationMs: number;
  startTime: number;
  incomingStartTime: number | null;
}

export function useAudioPlayer() {
  const deckAudioRefs = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const hlsRefs = useRef<[Hls | null, Hls | null]>([null, null]);
  const activeDeckRef = useRef<DeckId>(0);
  const activeTrackIdRef = useRef<string | number | null>(null);
  const loadingTrackIdRef = useRef<string | number | null>(null);
  const initialRestorePendingRef = useRef<boolean>(true);
  const crossfadeTriggeredForRef = useRef<string | number | null>(null);
  const pendingCrossfadeRef = useRef<PendingCrossfade | null>(null);
  const fadeRafRef = useRef<number | null>(null);
  const lastCastTrackIdRef = useRef<string | null>(null);

  const isSberCastConnected = useSberCastStore((state) => state.isConnected);
  const prevSberCastConnectedRef = useRef(isSberCastConnected);

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

  const destroyDeckHls = useCallback((deckId: DeckId) => {
    const hls = hlsRefs.current[deckId];
    if (hls) {
      hls.destroy();
      hlsRefs.current[deckId] = null;
    }
  }, []);

  const stopDeck = useCallback(
    (deckId: DeckId) => {
      destroyDeckHls(deckId);
      const audio = deckAudioRefs.current[deckId];
      if (audio) {
        clearAudioSource(audio);
      }
      setDeckGain(deckId, 0);
    },
    [destroyDeckHls]
  );

  const cancelCrossfade = useCallback(() => {
    if (fadeRafRef.current !== null) {
      cancelAnimationFrame(fadeRafRef.current);
      fadeRafRef.current = null;
    }
    const pending = pendingCrossfadeRef.current;
    if (pending) {
      pendingCrossfadeRef.current = null;
      stopDeck(pending.outgoingDeck);
    }
    setDeckGain(activeDeckRef.current, 1);
  }, [stopDeck]);

  const startCrossfadeLoop = useCallback(() => {
    if (fadeRafRef.current !== null) {
      cancelAnimationFrame(fadeRafRef.current);
      fadeRafRef.current = null;
    }

    const step = (now: number) => {
      const pending = pendingCrossfadeRef.current;
      if (!pending) {
        fadeRafRef.current = null;
        return;
      }

      const outProgress = Math.max(0, Math.min(1, (now - pending.startTime) / Math.max(1, pending.durationMs)));
      // Smooth S-curve fade-out (1 -> 0)
      const outGain = 0.5 * (1 + Math.cos(Math.PI * outProgress));
      setDeckGain(pending.outgoingDeck, outGain);

      let inProgress = 0;
      if (pending.incomingStartTime !== null) {
        const remainingAtStart = pending.startTime + pending.durationMs - pending.incomingStartTime;
        const inDuration = Math.max(1200, remainingAtStart);
        inProgress = Math.max(0, Math.min(1, (now - pending.incomingStartTime) / inDuration));
        // Smooth S-curve fade-in (0 -> 1)
        const inGain = 0.5 * (1 - Math.cos(Math.PI * inProgress));
        setDeckGain(pending.incomingDeck, inGain);
      } else {
        setDeckGain(pending.incomingDeck, 0);
      }

      if (outProgress >= 1 && pending.incomingStartTime !== null && inProgress >= 1) {
        pendingCrossfadeRef.current = null;
        fadeRafRef.current = null;
        stopDeck(pending.outgoingDeck);
        setDeckGain(pending.incomingDeck, 1);
        return;
      }

      if (outProgress >= 1) {
        stopDeck(pending.outgoingDeck);
      }

      fadeRafRef.current = requestAnimationFrame(step);
    };

    fadeRafRef.current = requestAnimationFrame(step);
  }, [stopDeck]);

  const attachStream = useCallback(
    (deckId: DeckId, streamUrl: string, startTime = 0) => {
      const audio = deckAudioRefs.current[deckId];
      if (!audio) return;

      destroyDeckHls(deckId);

      const markIncomingPlaying = () => {
        const pending = pendingCrossfadeRef.current;
        if (pending && pending.incomingDeck === deckId && pending.incomingStartTime === null) {
          pending.incomingStartTime = performance.now();
        }
      };

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
            if (hlsRefs.current[deckId] === hls) {
              hlsRefs.current[deckId] = null;
            }
            // Fallback to high MP3 if HLS fails (e.g. keyserver blocked by VPN)
            const curr = usePlayerStore.getState().currentTrack;
            if (curr && activeDeckRef.current === deckId) {
              getStreamUrl(curr.id, 'high')
                .then((fallbackInfo) => {
                  if (deckAudioRefs.current[deckId] && activeDeckRef.current === deckId) {
                    usePlayerStore.getState().setStreamInfo(fallbackInfo);
                    attachStream(deckId, fallbackInfo.url);
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
          if (activeLevel && activeDeckRef.current === deckId) {
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
          if (usePlayerStore.getState().isPlaying && activeDeckRef.current === deckId) {
            audio
              .play()
              .then(markIncomingPlaying)
              .catch((err) => console.warn('[Audio Player] Play error:', err));
          }
        });

        hlsRefs.current[deckId] = hls;
        return;
      }

      // Direct MP3/AAC or native HLS (Safari)
      audio.src = streamUrl;
      if (startTime > 0) {
        try {
          audio.currentTime = startTime;
        } catch {}
      }
      if (usePlayerStore.getState().isPlaying && activeDeckRef.current === deckId) {
        audio
          .play()
          .then(markIncomingPlaying)
          .catch((err) => console.warn('[Audio Player] Play error:', err));
      }
    },
    [destroyDeckHls]
  );

  // Initialize dual HTML5 Audio decks once
  useEffect(() => {
    const audio0 = getDeckAudio(0);
    const audio1 = getDeckAudio(1);
    deckAudioRefs.current = [audio0, audio1];
    setupAudioContext();
    setDeckGain(0, 1);
    setDeckGain(1, 0);

    const makeHandlers = (deckId: DeckId, audio: HTMLAudioElement) => {
      const onTimeUpdate = () => {
        if (deckId !== activeDeckRef.current) return;
        const state = usePlayerStore.getState();
        if (!activeTrackIdRef.current || activeTrackIdRef.current !== state.currentTrack?.id) {
          return;
        }

        setProgress(audio.currentTime);

        const canAdvance =
          state.repeat !== 'one' &&
          (state.isWaveMode ||
            (state.queueContext?.hasNext ?? false) ||
            state.queueIndex < state.queue.length - 1 ||
            state.repeat === 'all');

        if (
          state.crossfadeEnabled &&
          state.crossfadeDuration > 0 &&
          state.isPlaying &&
          canAdvance &&
          state.currentTrack &&
          crossfadeTriggeredForRef.current !== state.currentTrack.id &&
          audio.duration &&
          !isNaN(audio.duration) &&
          audio.duration > state.crossfadeDuration + 2
        ) {
          const remaining = audio.duration - audio.currentTime;
          if (remaining <= state.crossfadeDuration && remaining > 0.15) {
            crossfadeTriggeredForRef.current = state.currentTrack.id;
            const outgoingDeck = activeDeckRef.current;
            const incomingDeck: DeckId = outgoingDeck === 0 ? 1 : 0;

            stopDeck(incomingDeck);
            activeDeckRef.current = incomingDeck;
            pendingCrossfadeRef.current = {
              outgoingDeck,
              incomingDeck,
              durationMs: Math.min(state.crossfadeDuration, remaining) * 1000,
              startTime: performance.now(),
              incomingStartTime: null,
            };

            startCrossfadeLoop();
            nextTrack(false);
          }
        }
      };

      const onLoadedMetadata = () => {
        if (deckId !== activeDeckRef.current) return;
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
        if (deckId !== activeDeckRef.current) {
          stopDeck(deckId);
          return;
        }
        nextTrack(false);
      };

      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('loadedmetadata', onLoadedMetadata);
      audio.addEventListener('ended', onEnded);

      return () => {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('ended', onEnded);
      };
    };

    const cleanup0 = makeHandlers(0, audio0);
    const cleanup1 = makeHandlers(1, audio1);

    return () => {
      if (fadeRafRef.current !== null) {
        cancelAnimationFrame(fadeRafRef.current);
        fadeRafRef.current = null;
      }
      destroyDeckHls(0);
      destroyDeckHls(1);
      clearAudioSource(audio0);
      clearAudioSource(audio1);
      cleanup0();
      cleanup1();
    };
  }, [setProgress, setDuration, nextTrack, stopDeck, startCrossfadeLoop, destroyDeckHls]);

  // Apply user-initiated seek to active deck
  useEffect(() => {
    if (seekTarget === null) return;
    if (useSberCastStore.getState().isConnected) {
      const targetSec = Math.floor(seekTarget);
      sbercastSeek(targetSec).catch((err) => console.warn('[SberCast] Seek error:', err));
      const sberState = useSberCastStore.getState();
      if (sberState.speakerTrack) {
        useSberCastStore.setState({
          speakerTrack: {
            ...sberState.speakerTrack,
            position: targetSec,
            received_at_ms: Date.now(),
          },
        });
      }
      setProgress(seekTarget);
      clearSeekTarget();
      return;
    }
    const deckId = activeDeckRef.current;
    const audio = deckAudioRefs.current[deckId];
    if (!audio) return;

    if (activeTrackIdRef.current === currentTrack?.id) {
      cancelCrossfade();
      audio.currentTime = seekTarget;
      const { crossfadeDuration } = usePlayerStore.getState();
      if (audio.duration && seekTarget < audio.duration - crossfadeDuration - 0.5) {
        crossfadeTriggeredForRef.current = null;
      }
    }
    clearSeekTarget();
  }, [seekTarget, clearSeekTarget, currentTrack?.id, cancelCrossfade]);

  // Sync track change & fetch stream URL with preferred quality
  useEffect(() => {
    const activeDeck = activeDeckRef.current;
    const audio = deckAudioRefs.current[activeDeck];
    if (!audio || !currentTrack) return;

    let isSubscribed = true;
    const isCrossfadeTransition = pendingCrossfadeRef.current?.incomingDeck === activeDeck;

    // If changing to a different track manually (not via crossfade), stop old playback
    if (activeTrackIdRef.current !== currentTrack.id) {
      if (!isCrossfadeTransition) {
        cancelCrossfade();
        destroyDeckHls(activeDeck);
        if (!initialRestorePendingRef.current) {
          clearAudioSource(audio);
          setProgress(0);
          clearSeekTarget();
        }
        setDeckGain(activeDeck, 1);
      } else {
        setProgress(0);
        clearSeekTarget();
        setDeckGain(activeDeck, 0);
      }
    }

    async function loadStream() {
      if (!currentTrack) return;
      const targetDeck = activeDeck;
      const targetAudio = deckAudioRefs.current[targetDeck];
      if (!targetAudio) return;

      if (useSberCastStore.getState().isConnected) {
        targetAudio.pause();
        const tid = String(currentTrack.id);
        if (lastCastTrackIdRef.current === tid) {
          return;
        }
        lastCastTrackIdRef.current = tid;
        sbercastPlayTrack(tid).catch((err) => console.warn('[SberCast] Play error:', err));
        return;
      }

      loadingTrackIdRef.current = currentTrack.id;
      try {
        const preferredQuality = usePlayerStore.getState().quality;
        const streamInfo = await getStreamUrl(currentTrack.id, preferredQuality);
        if (!isSubscribed || activeDeckRef.current !== targetDeck) return;

        setStreamInfo(streamInfo);
        const state = usePlayerStore.getState();
        setMasterVolume(state.isMuted ? 0 : state.volume);

        let startTime = 0;
        if (initialRestorePendingRef.current) {
          initialRestorePendingRef.current = false;
          const savedProgress = state.progress;
          if (savedProgress > 0) {
            startTime = savedProgress;
          }
        } else {
          targetAudio.currentTime = 0;
          setProgress(0);
        }

        activeTrackIdRef.current = currentTrack.id;
        attachStream(targetDeck, streamInfo.url, startTime);
      } catch (err) {
        console.error('[Audio Player] Failed to fetch stream URL:', err);
        if (pendingCrossfadeRef.current?.incomingDeck === targetDeck) {
          cancelCrossfade();
        }
      } finally {
        if (loadingTrackIdRef.current === currentTrack.id) {
          loadingTrackIdRef.current = null;
        }
      }
    }

    loadStream();

    return () => {
      isSubscribed = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, attachStream]);

  // Handle handover between local playback and SberCast
  useEffect(() => {
    const wasConnected = prevSberCastConnectedRef.current;
    prevSberCastConnectedRef.current = isSberCastConnected;

    if (wasConnected && !isSberCastConnected) {
      console.log('[Audio Player] SberCast disconnected, resuming local playback...');
      lastCastTrackIdRef.current = null;
      activeTrackIdRef.current = null;

      // Restore desktop volume that was saved before SberCast was connected
      restorePreCastVolume();

      const track = usePlayerStore.getState().currentTrack;
      if (!track) return;

      const targetDeck = activeDeckRef.current;
      const targetAudio = deckAudioRefs.current[targetDeck];
      if (!targetAudio) return;

      destroyDeckHls(targetDeck);
      clearAudioSource(targetAudio);
      setDeckGain(targetDeck, 1);

      const savedProgress = usePlayerStore.getState().progress || 0;
      const preferredQuality = usePlayerStore.getState().quality;
      loadingTrackIdRef.current = track.id;

      getStreamUrl(track.id, preferredQuality)
        .then((streamInfo) => {
          if (useSberCastStore.getState().isConnected) return;
          setStreamInfo(streamInfo);
          const state = usePlayerStore.getState();
          setMasterVolume(state.isMuted ? 0 : state.volume);

          activeTrackIdRef.current = track.id;
          attachStream(targetDeck, streamInfo.url, savedProgress);

          if (state.isPlaying) {
            resumeAudioContext();
            targetAudio.play().catch((err) => console.warn('[Audio Player] Resume local playback error:', err));
          }
        })
        .catch((err) => console.error('[Audio Player] Failed to load local stream after SberCast disconnect:', err))
        .finally(() => {
          if (loadingTrackIdRef.current === track.id) {
            loadingTrackIdRef.current = null;
          }
        });
    } else if (!wasConnected && isSberCastConnected) {
      console.log('[Audio Player] SberCast connected, capturing volume and muting local audio...');
      // Save current desktop volume before capturing for SberCast
      savePreCastVolume();

      // If speaker volume is already known, capture it immediately into player store
      const { speakerVolume, speakerMuted } = useSberCastStore.getState();
      if (speakerVolume !== undefined && speakerVolume !== null) {
        usePlayerStore.setState({
          volume: speakerVolume / 100,
          isMuted: speakerMuted,
        });
      }

      const targetDeck = activeDeckRef.current;
      const targetAudio = deckAudioRefs.current[targetDeck];
      if (targetAudio) {
        targetAudio.pause();
        clearAudioSource(targetAudio);
        destroyDeckHls(targetDeck);
      }
    }
  }, [isSberCastConnected, destroyDeckHls, setStreamInfo, attachStream]);

  // Sync play/pause toggle
  useEffect(() => {
    const deckId = activeDeckRef.current;
    const audio = deckAudioRefs.current[deckId];
    if (!audio) return;

    if (useSberCastStore.getState().isConnected) {
      audio.pause();
      const sberState = useSberCastStore.getState();
      if (sberState.speakerTrack && sberState.speakerTrack.playing !== isPlaying) {
        useSberCastStore.setState({
          speakerTrack: {
            ...sberState.speakerTrack,
            playing: isPlaying,
            received_at_ms: Date.now(),
          },
        });
        if (isPlaying) {
          sbercastMediaPlay().catch((err) => console.warn('[SberCast] Play error:', err));
        } else {
          sbercastMediaPause().catch((err) => console.warn('[SberCast] Pause error:', err));
        }
      }
      return;
    }

    if (isPlaying) {
      resumeAudioContext();
      const isLoadedForCurrentTrack =
        currentTrack &&
        activeTrackIdRef.current === currentTrack.id &&
        (audio.src || hlsRefs.current[deckId]);

      if (isLoadedForCurrentTrack) {
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
      } else if (currentTrack && loadingTrackIdRef.current !== currentTrack.id) {
        const preferredQuality = usePlayerStore.getState().quality;
        const currentProgress = usePlayerStore.getState().progress || 0;
        loadingTrackIdRef.current = currentTrack.id;

        getStreamUrl(currentTrack.id, preferredQuality)
          .then((streamInfo) => {
            const targetAudio = deckAudioRefs.current[deckId];
            if (!targetAudio || activeDeckRef.current !== deckId) return;
            setStreamInfo(streamInfo);
            setMasterVolume(isMuted ? 0 : volume);
            activeTrackIdRef.current = currentTrack.id;
            attachStream(deckId, streamInfo.url, currentProgress);
          })
          .catch((err) => console.error('[Audio Player] Failed to fetch stream URL on play:', err))
          .finally(() => {
            if (loadingTrackIdRef.current === currentTrack.id) {
              loadingTrackIdRef.current = null;
            }
          });
      }
    } else {
      cancelCrossfade();
      if (audio.src || hlsRefs.current[deckId]) {
        audio.pause();
      }
    }
  }, [isPlaying, currentTrack, isMuted, volume, setStreamInfo, attachStream, cancelCrossfade]);

  // Sync volume & mute
  useEffect(() => {
    if (useSberCastStore.getState().isConnected) {
      const currentSpeakerVol = useSberCastStore.getState().speakerVolume;
      const targetVol = isMuted ? 0 : Math.round(volume * 100);
      if (currentSpeakerVol !== targetVol) {
        useSberCastStore.setState({ speakerVolume: targetVol, speakerMuted: isMuted });
        sbercastSetVolume(targetVol).catch((err) => console.warn('[SberCast] Set volume error:', err));
      }
    } else {
      setMasterVolume(isMuted ? 0 : volume);
    }
  }, [volume, isMuted]);

  // Continuous progress ticker when SberCast is connected and playing
  useEffect(() => {
    let lastTick = Date.now();
    const interval = setInterval(() => {
      const { isConnected, speakerTrack } = useSberCastStore.getState();
      if (!isConnected || !speakerTrack) {
        lastTick = Date.now();
        return;
      }

      const now = Date.now();
      const delta = (now - lastTick) / 1000;
      lastTick = now;

      if (speakerTrack.playing) {
        const currentProgress = usePlayerStore.getState().progress || 0;
        const duration = speakerTrack.duration ?? Infinity;

        // Follow simulation: autonomous clock advancement
        let nextProgress = currentProgress + delta;

        if (speakerTrack.position !== undefined && speakerTrack.position !== null) {
          const speakerRefElapsed = (now - (speakerTrack.received_at_ms || now)) / 1000;
          const speakerExpectedPos = speakerTrack.position + speakerRefElapsed;

          // Only snap if speaker seeked by a large delta (> 3.0s forward, or > 5.0s backward)
          if (speakerExpectedPos > currentProgress + 3.0) {
            nextProgress = speakerExpectedPos;
          } else if (speakerExpectedPos < currentProgress - 5.0) {
            nextProgress = speakerExpectedPos;
          } else if (speakerExpectedPos > currentProgress) {
            // Gentle forward convergence when slightly behind speaker
            nextProgress += (speakerExpectedPos - currentProgress) * 0.05;
          }
          // If speakerExpectedPos is slightly behind currentProgress (e.g. coarse integer reporting or network latency):
          // NEVER jump backwards! Autonomous follow simulation continues forward.
        }

        nextProgress = Math.min(duration, Math.max(currentProgress, nextProgress));
        setProgress(nextProgress);
      } else if (speakerTrack.position !== undefined && speakerTrack.position !== null) {
        setProgress(speakerTrack.position);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [setProgress]);

  // Synchronize speaker progress, playing state, track metadata, and hardware volume when SberCast pushes updates
  useEffect(() => {
    return useSberCastStore.subscribe((state) => {
      if (!state.isConnected) return;

      // Ensure pre-cast volume is saved before applying speaker volume
      savePreCastVolume();

      // Sync volume from speaker to player store if changed
      if (state.speakerVolume !== undefined && state.speakerVolume !== null) {
        const speakerVolRatio = state.speakerVolume / 100;
        const currentVol = usePlayerStore.getState().volume;
        if (Math.abs(speakerVolRatio - currentVol) >= 0.01) {
          usePlayerStore.setState({ volume: speakerVolRatio });
        }
      }
      if (state.speakerMuted !== undefined && state.speakerMuted !== null) {
        if (state.speakerMuted !== usePlayerStore.getState().isMuted) {
          usePlayerStore.setState({ isMuted: state.speakerMuted });
        }
      }

      if (!state.speakerTrack) return;
      const speakerTrack = state.speakerTrack;

      // Sync duration
      if (speakerTrack.duration) {
        setDuration(speakerTrack.duration);
      }

      // Sync playing state if different
      if (
        speakerTrack.playing !== undefined &&
        speakerTrack.playing !== usePlayerStore.getState().isPlaying
      ) {
        usePlayerStore.setState({ isPlaying: speakerTrack.playing });
      }

      // Sync track if speaker changed to another track
      if (speakerTrack.track_id) {
        const currentTrack = usePlayerStore.getState().currentTrack;
        const speakerTid = String(speakerTrack.track_id);

        if (!currentTrack || String(currentTrack.id) !== speakerTid) {
          // Record so loadStream does NOT send play back to speaker
          lastCastTrackIdRef.current = speakerTid;

          const queue = usePlayerStore.getState().queue;
          const foundIdx = queue.findIndex((t) => String(t.id) === speakerTid);
          if (foundIdx !== -1) {
            usePlayerStore.setState({
              queueIndex: foundIdx,
              currentTrack: queue[foundIdx],
              progress: speakerTrack.position ?? 0,
            });
          } else {
            getTrack(Number(speakerTid))
              .then((fetchedTrack) => {
                if (fetchedTrack) {
                  usePlayerStore.setState({
                    currentTrack: fetchedTrack,
                    progress: speakerTrack.position ?? 0,
                  });
                }
              })
              .catch(() => {
                const fallbackTrack: Track = {
                  id: Number(speakerTid) || 0,
                  title: speakerTrack.title || 'Неизвестный трек',
                  artist: speakerTrack.artists.join(', ') || 'Неизвестный исполнитель',
                  artist_id: null,
                  album: speakerTrack.album || null,
                  album_id: null,
                  duration: speakerTrack.duration || 0,
                  cover_url: null,
                  is_explicit: false,
                  is_liked: speakerTrack.liked,
                  has_flac: false,
                  release_year: null,
                };
                usePlayerStore.setState({
                  currentTrack: fallbackTrack,
                  progress: speakerTrack.position ?? 0,
                });
              });
          }
        }
      }
    });
  }, [setDuration, setProgress]);
}
