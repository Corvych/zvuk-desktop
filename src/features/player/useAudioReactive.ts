import { useEffect } from 'react';
import { usePlayerStore } from './playerStore';
import { sampleByteFrequencyData } from './audioService';
import { useAppearanceSettingsStore } from '../settings/appearanceSettingsStore';
import { useWindowFreezeStore, getIsWindowFrozen } from '../../lib/windowFreezeStore';

export function useAudioReactive(targetRef?: React.RefObject<HTMLElement | null>) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const enableVisualEffects = useAppearanceSettingsStore((s) => s.enableVisualEffects);

  useEffect(() => {
    const root = document.documentElement;

    const setProps = (key: string, val: string) => {
      root.style.setProperty(key, val);
      if (targetRef?.current) {
        targetRef.current.style.setProperty(key, val);
      }
    };

    // If visual effects disabled by user, reset properties to resting static state
    if (!enableVisualEffects) {
      setProps('--audio-bass', '0');
      setProps('--audio-mid', '0');
      setProps('--audio-treble', '0');
      setProps('--audio-energy', '0');
      setProps('--audio-glow-scale', '1');
      setProps('--audio-glow-opacity', '0.5');
      setProps('--audio-bar-1', '4px');
      setProps('--audio-bar-2', '4px');
      setProps('--audio-bar-3', '4px');
      return;
    }

    let animId: number;
    let isRunning = true;
    const dataArray = new Uint8Array(32);
    let smoothedBass = 0;
    let smoothedMid = 0;
    let smoothedTreble = 0;
    let smoothedEnergy = 0;
    let lastUpdate = 0;

    const tick = (now: number) => {
      // Freeze processing and DOM variable writes completely when window is minimized or hidden
      if (getIsWindowFrozen() || document.hidden) {
        isRunning = false;
        return;
      }

      // Throttling to ≥75 FPS (~11ms when focused, or ~8 FPS when window has no focus) for silky smooth audio-reactive glow and physics
      const throttleMs = document.hasFocus() ? 11 : 120;
      if (now - lastUpdate < throttleMs) {
        animId = requestAnimationFrame(tick);
        return;
      }
      lastUpdate = now;

      if (!isPlaying) {
        // Smoothly decay to calm resting aura
        smoothedBass *= 0.88;
        smoothedMid *= 0.88;
        smoothedTreble *= 0.88;
        smoothedEnergy *= 0.88;

        if (smoothedBass < 0.005) smoothedBass = 0;
        if (smoothedMid < 0.005) smoothedMid = 0;
        if (smoothedTreble < 0.005) smoothedTreble = 0;
        if (smoothedEnergy < 0.005) smoothedEnergy = 0;

        setProps('--audio-bass', smoothedBass.toFixed(2));
        setProps('--audio-mid', smoothedMid.toFixed(2));
        setProps('--audio-treble', smoothedTreble.toFixed(2));
        setProps('--audio-energy', smoothedEnergy.toFixed(2));
        setProps('--audio-glow-scale', (1 + smoothedBass * 0.25).toFixed(2));
        setProps('--audio-glow-opacity', (0.45 + smoothedEnergy * 0.35).toFixed(2));
        setProps('--audio-bar-1', '4px');
        setProps('--audio-bar-2', '4px');
        setProps('--audio-bar-3', '4px');
        animId = requestAnimationFrame(tick);
        return;
      }

      let hasRealAudio = false;

      if (sampleByteFrequencyData(dataArray)) {
        let sum = 0;
        for (let i = 0; i < 16; i++) {
          sum += dataArray[i];
        }

        // Noise gate: only respond when there is actual audible signal (silence is truly silent)
        if (sum > 4) {
          hasRealAudio = true;
          const rawBass = (dataArray[0] + dataArray[1] + dataArray[2] + dataArray[3]) / (4 * 255);
          const rawMid = (dataArray[4] + dataArray[5] + dataArray[6] + dataArray[7] + dataArray[8]) / (5 * 255);
          const rawTreble = (dataArray[9] + dataArray[10] + dataArray[11] + dataArray[12]) / (4 * 255);
          const rawEnergy = rawBass * 0.5 + rawMid * 0.35 + rawTreble * 0.15;

          // Asymmetric attack/decay: snappy attack on beats, smooth musical release
          const bSpeed = rawBass > smoothedBass ? 0.28 : 0.14;
          const mSpeed = rawMid > smoothedMid ? 0.24 : 0.12;
          const tSpeed = rawTreble > smoothedTreble ? 0.24 : 0.14;
          const eSpeed = rawEnergy > smoothedEnergy ? 0.26 : 0.12;

          smoothedBass += (rawBass - smoothedBass) * bSpeed;
          smoothedMid += (rawMid - smoothedMid) * mSpeed;
          smoothedTreble += (rawTreble - smoothedTreble) * tSpeed;
          smoothedEnergy += (rawEnergy - smoothedEnergy) * eSpeed;
        }
      }

      if (!hasRealAudio) {
        // True silence or quiet passages: decay to calm resting state (ZERO phantom hits)
        smoothedBass *= 0.86;
        smoothedMid *= 0.86;
        smoothedTreble *= 0.86;
        smoothedEnergy *= 0.86;

        if (smoothedBass < 0.005) smoothedBass = 0;
        if (smoothedMid < 0.005) smoothedMid = 0;
        if (smoothedTreble < 0.005) smoothedTreble = 0;
        if (smoothedEnergy < 0.005) smoothedEnergy = 0;
      }

      // Update CSS custom properties (2 decimals is sufficient precision, saves string allocs)
      setProps('--audio-bass', smoothedBass.toFixed(2));
      setProps('--audio-mid', smoothedMid.toFixed(2));
      setProps('--audio-treble', smoothedTreble.toFixed(2));
      setProps('--audio-energy', smoothedEnergy.toFixed(2));

      // GPU hardware composite-friendly transforms (scale & opacity)
      const scale = 1.0 + smoothedBass * 0.28;
      const opacity = 0.5 + smoothedEnergy * 0.45;

      setProps('--audio-glow-scale', scale.toFixed(2));
      setProps('--audio-glow-opacity', Math.min(1, opacity).toFixed(2));

      // Equalizer bars
      const b1 = Math.max(4, Math.round(4 + (hasRealAudio ? dataArray[1] / 255 : smoothedBass) * 12));
      const b2 = Math.max(4, Math.round(4 + (hasRealAudio ? dataArray[4] / 255 : smoothedMid) * 14));
      const b3 = Math.max(4, Math.round(4 + (hasRealAudio ? dataArray[8] / 255 : smoothedTreble) * 11));
      setProps('--audio-bar-1', `${b1}px`);
      setProps('--audio-bar-2', `${b2}px`);
      setProps('--audio-bar-3', `${b3}px`);

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    const unsub = useWindowFreezeStore.subscribe((state, prev) => {
      if (!state.isFrozen && prev.isFrozen) {
        if (!isRunning) {
          isRunning = true;
          lastUpdate = performance.now();
          animId = requestAnimationFrame(tick);
        }
      }
    });

    return () => {
      unsub();
      cancelAnimationFrame(animId);
    };
  }, [isPlaying, targetRef, enableVisualEffects]);
}
