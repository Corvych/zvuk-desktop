import { useEffect } from 'react';
import { usePlayerStore } from './playerStore';
import { getAnalyser, getOrCreateAudio } from './audioService';

export function useAudioReactive(targetRef?: React.RefObject<HTMLElement | null>) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useEffect(() => {
    let animId: number;
    const dataArray = new Uint8Array(32);
    let smoothedBass = 0;
    let smoothedMid = 0;
    let smoothedTreble = 0;
    let smoothedEnergy = 0;

    const audio = getOrCreateAudio();
    const root = document.documentElement;

    const setProps = (key: string, val: string) => {
      root.style.setProperty(key, val);
      if (targetRef?.current) {
        targetRef.current.style.setProperty(key, val);
      }
    };

    const tick = () => {
      if (!isPlaying) {
        // Smoothly decay to calm resting aura
        smoothedBass *= 0.92;
        smoothedMid *= 0.92;
        smoothedTreble *= 0.92;
        smoothedEnergy *= 0.92;

        setProps('--audio-bass', smoothedBass.toFixed(3));
        setProps('--audio-mid', smoothedMid.toFixed(3));
        setProps('--audio-treble', smoothedTreble.toFixed(3));
        setProps('--audio-energy', smoothedEnergy.toFixed(3));
        setProps('--audio-glow-scale', (1 + smoothedBass * 0.25).toFixed(3));
        setProps('--audio-glow-opacity', (0.45 + smoothedEnergy * 0.35).toFixed(3));
        setProps('--audio-glow-blur', `${80 + smoothedBass * 25}px`);
        setProps('--audio-bar-1', '4px');
        setProps('--audio-bar-2', '4px');
        setProps('--audio-bar-3', '4px');

        animId = requestAnimationFrame(tick);
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
          smoothedBass += (rawBass - smoothedBass) * 0.22;
          smoothedMid += (rawMid - smoothedMid) * 0.18;
          smoothedTreble += (rawTreble - smoothedTreble) * 0.25;
          smoothedEnergy += (rawEnergy - smoothedEnergy) * 0.2;
        }
      }

      if (!hasRealAudio) {
        // High-precision musical rhythm model (124 BPM) synchronized with playback clock
        const t = audio.currentTime || performance.now() / 1000;
        const beatPeriod = 0.4838; // ~124 BPM
        const beatPhase = (t % beatPeriod) / beatPeriod;
        const kick = Math.pow(Math.max(0, 1 - beatPhase * 3.2), 2.2);
        const subKick = Math.pow(Math.max(0, 1 - ((t % (beatPeriod * 2)) / (beatPeriod * 2)) * 2.6), 2.0);
        const snare = Math.pow(Math.max(0, 1 - (((t + beatPeriod * 0.5) % beatPeriod) / beatPeriod) * 3.0), 2.0);

        const wave = 0.5 + 0.5 * Math.sin(t * 2.8);
        const shimmer = 0.5 + 0.5 * Math.sin(t * 7.5);

        const targetBass = Math.min(1, kick * 0.75 + subKick * 0.35 + wave * 0.15);
        const targetMid = Math.min(1, snare * 0.55 + wave * 0.3);
        const targetTreble = Math.min(1, shimmer * 0.4 + kick * 0.3);
        const targetEnergy = targetBass * 0.5 + targetMid * 0.35 + targetTreble * 0.15;

        smoothedBass += (targetBass - smoothedBass) * 0.24;
        smoothedMid += (targetMid - smoothedMid) * 0.18;
        smoothedTreble += (targetTreble - smoothedTreble) * 0.24;
        smoothedEnergy += (targetEnergy - smoothedEnergy) * 0.2;
      }

      // Update CSS custom properties directly on root element for 60fps GPU acceleration
      setProps('--audio-bass', smoothedBass.toFixed(3));
      setProps('--audio-mid', smoothedMid.toFixed(3));
      setProps('--audio-treble', smoothedTreble.toFixed(3));
      setProps('--audio-energy', smoothedEnergy.toFixed(3));

      // Glow scale & expansion: expands on bass kicks and volume swells
      const scale = 1.0 + smoothedBass * 0.32;
      const opacity = 0.5 + smoothedEnergy * 0.5;
      const blur = 80 + smoothedBass * 40;

      setProps('--audio-glow-scale', scale.toFixed(3));
      setProps('--audio-glow-opacity', Math.min(1, opacity).toFixed(3));
      setProps('--audio-glow-blur', `${blur.toFixed(1)}px`);

      // Dynamic equalizer mini-bars (b1, b2, b3)
      const b1 = Math.max(4, Math.round(4 + (hasRealAudio ? dataArray[1] / 255 : smoothedBass) * 12));
      const b2 = Math.max(4, Math.round(4 + (hasRealAudio ? dataArray[4] / 255 : smoothedMid) * 14));
      const b3 = Math.max(4, Math.round(4 + (hasRealAudio ? dataArray[8] / 255 : smoothedTreble) * 11));
      setProps('--audio-bar-1', `${b1}px`);
      setProps('--audio-bar-2', `${b2}px`);
      setProps('--audio-bar-3', `${b3}px`);

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isPlaying, targetRef]);
}
