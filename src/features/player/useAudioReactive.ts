import { useEffect } from 'react';
import { usePlayerStore } from './playerStore';
import { getAnalyser, getOrCreateAudio } from './audioService';
import { useAppearanceSettingsStore } from '../settings/appearanceSettingsStore';

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
    const dataArray = new Uint8Array(32);
    let smoothedBass = 0;
    let smoothedMid = 0;
    let smoothedTreble = 0;
    let smoothedEnergy = 0;
    let lastUpdate = 0;

    const audio = getOrCreateAudio();

    const tick = (now: number) => {
      animId = requestAnimationFrame(tick);

      // Throttling to ~35 FPS to dramatically reduce style recalculations and GPU load
      if (now - lastUpdate < 28) {
        return;
      }
      lastUpdate = now;

      // Skip processing when app window or tab is hidden
      if (document.hidden) {
        return;
      }

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
        return;
      }

      const analyser = getAnalyser();
      let hasRealAudio = false;

      if (analyser) {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < 16; i++) {
          sum += dataArray[i];
        }
        if (sum > 0) {
          hasRealAudio = true;
          const rawBass = (dataArray[0] + dataArray[1] + dataArray[2] + dataArray[3]) / (4 * 255);
          const rawMid = (dataArray[4] + dataArray[5] + dataArray[6] + dataArray[7] + dataArray[8]) / (5 * 255);
          const rawTreble = (dataArray[9] + dataArray[10] + dataArray[11] + dataArray[12]) / (4 * 255);
          const rawEnergy = rawBass * 0.5 + rawMid * 0.35 + rawTreble * 0.15;

          // Smooth exponential lerp
          smoothedBass += (rawBass - smoothedBass) * 0.26;
          smoothedMid += (rawMid - smoothedMid) * 0.22;
          smoothedTreble += (rawTreble - smoothedTreble) * 0.28;
          smoothedEnergy += (rawEnergy - smoothedEnergy) * 0.24;
        }
      }

      if (!hasRealAudio) {
        // High-precision musical rhythm model synchronized with playback clock
        const t = audio.currentTime || performance.now() / 1000;
        const beatPeriod = 0.4838;
        const beatPhase = (t % beatPeriod) / beatPeriod;
        const kick = Math.pow(Math.max(0, 1 - beatPhase * 3.2), 2.0);
        const subKick = Math.pow(Math.max(0, 1 - ((t % (beatPeriod * 2)) / (beatPeriod * 2)) * 2.6), 1.8);
        const snare = Math.pow(Math.max(0, 1 - (((t + beatPeriod * 0.5) % beatPeriod) / beatPeriod) * 3.0), 1.8);

        const wave = 0.5 + 0.5 * Math.sin(t * 2.8);
        const targetBass = Math.min(1, kick * 0.75 + subKick * 0.35 + wave * 0.15);
        const targetMid = Math.min(1, snare * 0.55 + wave * 0.3);
        const targetTreble = Math.min(1, kick * 0.4 + wave * 0.25);
        const targetEnergy = targetBass * 0.5 + targetMid * 0.35 + targetTreble * 0.15;

        smoothedBass += (targetBass - smoothedBass) * 0.26;
        smoothedMid += (targetMid - smoothedMid) * 0.22;
        smoothedTreble += (targetTreble - smoothedTreble) * 0.26;
        smoothedEnergy += (targetEnergy - smoothedEnergy) * 0.24;
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
    };

    animId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isPlaying, targetRef, enableVisualEffects]);
}
