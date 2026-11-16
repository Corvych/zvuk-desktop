import { useState, useEffect, useRef } from 'react';
import { useWindowFreezeStore, getIsWindowFrozen } from '../../lib/windowFreezeStore';
import { getOrCreateAudio } from './audioService';
import { useSberCastStore } from '../sbercast/sbercastStore';
import { usePlayerStore } from './playerStore';

interface UseKaraokeSmoothTimeProps {
  isActive: boolean;
  isPlaying: boolean;
  progress: number;
}

/**
 * Hook providing a high-precision, monotonic 60fps clock for synced lyrics and word-by-word karaoke.
 * Seamlessly handles both local HTMLAudio playback and SberCast remote speaker playback
 * with gentle clock drift correction and zero backward jitter.
 */
export function useKaraokeSmoothTime({
  isActive,
  isPlaying,
  progress,
}: UseKaraokeSmoothTimeProps): [number, (targetTime: number) => void] {
  const [smoothTime, setSmoothTime] = useState(progress);
  const smoothTimeRef = useRef(progress);
  const lastPerfRef = useRef(performance.now());

  // Manual seek setter (e.g. when user clicks a specific lyric line)
  const setManualTime = (targetTime: number) => {
    smoothTimeRef.current = targetTime;
    setSmoothTime(targetTime);
    lastPerfRef.current = performance.now();
  };

  // Sync immediately when progress jumps significantly (e.g. seekbar drag, track switch)
  useEffect(() => {
    const diff = progress - smoothTimeRef.current;
    if (progress === 0 || diff > 3.0 || diff < -4.0) {
      smoothTimeRef.current = progress;
      setSmoothTime(progress);
    }
  }, [progress]);

  useEffect(() => {
    if (!isActive || !isPlaying) {
      smoothTimeRef.current = progress;
      setSmoothTime(progress);
      return;
    }

    let animId: number;
    let isRunning = true;
    lastPerfRef.current = performance.now();

    const tick = (now: number) => {
      if (getIsWindowFrozen() || document.hidden) {
        isRunning = false;
        return;
      }

      const sberState = useSberCastStore.getState();
      if (sberState.isConnected) {
        // --- SberCast Follow Simulation (Имитация следования) ---
        const dt = Math.min(0.1, Math.max(0, (now - lastPerfRef.current) / 1000));
        lastPerfRef.current = now;

        const speakerTrack = sberState.speakerTrack;
        if (speakerTrack && speakerTrack.playing) {
          const duration = speakerTrack.duration ?? usePlayerStore.getState().duration ?? Infinity;
          const current = smoothTimeRef.current;

          // Follow simulation: autonomous continuous clock advancement every frame
          let nextTime = current + dt;

          if (speakerTrack.position !== undefined && speakerTrack.position !== null) {
            const refTime = speakerTrack.received_at_ms || Date.now();
            const speakerElapsed = (Date.now() - refTime) / 1000;
            const speakerExpectedPos = speakerTrack.position + speakerElapsed;

            // Only snap on huge jumps (seek)
            if (speakerExpectedPos > current + 3.0) {
              nextTime = speakerExpectedPos;
            } else if (speakerExpectedPos < current - 5.0) {
              nextTime = speakerExpectedPos;
            } else if (speakerExpectedPos > current) {
              // Gentle forward convergence if slightly behind speaker
              nextTime += (speakerExpectedPos - current) * 0.03;
            }
            // If speakerExpectedPos is slightly behind current:
            // NEVER jump backwards! Autonomous follow simulation continues cleanly forward.
          }

          nextTime = Math.min(duration, Math.max(current, nextTime));
          smoothTimeRef.current = nextTime;
          setSmoothTime(nextTime);
        } else if (speakerTrack?.position !== undefined && speakerTrack.position !== null) {
          smoothTimeRef.current = speakerTrack.position;
          setSmoothTime(speakerTrack.position);
        }
      } else {
        // --- Local HTMLAudio Smooth Clock ---
        const audio = getOrCreateAudio();
        if (audio && !audio.paused && !isNaN(audio.currentTime)) {
          smoothTimeRef.current = audio.currentTime;
          setSmoothTime(audio.currentTime);
        }
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    const unsub = useWindowFreezeStore.subscribe((state, prev) => {
      if (!state.isFrozen && prev.isFrozen) {
        if (!isRunning) {
          isRunning = true;
          lastPerfRef.current = performance.now();
          animId = requestAnimationFrame(tick);
        }
      }
    });

    return () => {
      unsub();
      cancelAnimationFrame(animId);
    };
  }, [isActive, isPlaying, progress]);

  return [smoothTime, setManualTime];
}
