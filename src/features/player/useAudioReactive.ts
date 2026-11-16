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
      return;
    }

    let animId: number;
    let isRunning = true;
    // 64 bins from fftSize=256 analyser. At 44100 Hz: each bin ≈ 344 Hz wide.
    // Bass:   bins 0–4   (~0–1.7 kHz, skipping bin 0 which may carry DC offset)
    // Mid:    bins 5–14  (~1.7–5 kHz)
    // Treble: bins 15–28 (~5–10 kHz)
    const dataArray = new Uint8Array(64);
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
        animId = requestAnimationFrame(tick);
        return;
      }

      let hasRealAudio = false;

      if (sampleByteFrequencyData(dataArray)) {
        // Check signal presence across the main audible range (bins 1–28).
        // Bin 0 is skipped: it can carry a DC-offset artifact even during silence.
        let sum = 0;
        for (let i = 1; i < 28; i++) {
          sum += dataArray[i];
        }

        // Noise gate: require a meaningful signal level across the audible band.
        // With smoothingTimeConstant=0 the FFT is now raw per-frame, so sum>80
        // across 27 bins safely rejects true silence and codec DC leakage.
        if (sum > 80) {
          hasRealAudio = true;

          // Bass: bins 1–4 (~344 Hz – 1.72 kHz), skip DC bin 0
          const rawBass = (dataArray[1] + dataArray[2] + dataArray[3] + dataArray[4]) / (4 * 255);
          // Mid: bins 5–14 (~1.72 kHz – 4.83 kHz)
          const rawMid =
            (dataArray[5] + dataArray[6] + dataArray[7] + dataArray[8] + dataArray[9] +
             dataArray[10] + dataArray[11] + dataArray[12] + dataArray[13] + dataArray[14]) /
            (10 * 255);
          // Treble: bins 15–28 (~5.2 kHz – 9.6 kHz)
          const rawTreble =
            (dataArray[15] + dataArray[16] + dataArray[17] + dataArray[18] + dataArray[19] +
             dataArray[20] + dataArray[21] + dataArray[22] + dataArray[23] + dataArray[24] +
             dataArray[25] + dataArray[26] + dataArray[27] + dataArray[28]) /
            (14 * 255);
          const rawEnergy = rawBass * 0.5 + rawMid * 0.35 + rawTreble * 0.15;

          // Moderate attack — responsive but not jarring; longer musical tail
          const bSpeed = rawBass > smoothedBass ? 0.26 : 0.10;
          const mSpeed = rawMid > smoothedMid ? 0.22 : 0.09;
          const tSpeed = rawTreble > smoothedTreble ? 0.22 : 0.10;
          const eSpeed = rawEnergy > smoothedEnergy ? 0.24 : 0.09;

          smoothedBass += (rawBass - smoothedBass) * bSpeed;
          smoothedMid += (rawMid - smoothedMid) * mSpeed;
          smoothedTreble += (rawTreble - smoothedTreble) * tSpeed;
          smoothedEnergy += (rawEnergy - smoothedEnergy) * eSpeed;
        }
      }

      if (!hasRealAudio) {
        // True silence or quiet passages: gentle decay, not an instant drop
        // Slower multiplier = longer "breathing out" after the last beat
        smoothedBass *= 0.92;
        smoothedMid *= 0.92;
        smoothedTreble *= 0.92;
        smoothedEnergy *= 0.92;

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
      // Wider range → more visible punch on every hit
      const scale = 1.0 + smoothedBass * 0.45;
      const opacity = 0.42 + smoothedEnergy * 0.58;

      setProps('--audio-glow-scale', scale.toFixed(2));
      setProps('--audio-glow-opacity', Math.min(1, opacity).toFixed(2));

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
