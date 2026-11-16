// Dual-deck HTMLAudioElement and Web Audio API Analyser/GainNode singleton
// Supports smooth equal-power crossfades and shared FFT sampling for visualizations.

export type DeckId = 0 | 1;

interface DeckEntry {
  audio: HTMLAudioElement;
  sourceNode: MediaElementAudioSourceNode | null;
  gainNode: GainNode | null;
  gainValue: number;
}

const decks: [DeckEntry | null, DeckEntry | null] = [null, null];
let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let analyserConnected = false;
let masterVolume = 1;

function createDeckAudio(): HTMLAudioElement {
  const audio = new Audio();
  // Enable cross-origin so Web Audio Analyser can read frequency data
  audio.crossOrigin = 'anonymous';
  // Use metadata preload to avoid aggressive in-memory over-buffering
  audio.preload = 'metadata';
  return audio;
}

export function getDeckAudio(deckId: DeckId): HTMLAudioElement {
  let entry = decks[deckId];
  if (!entry) {
    entry = {
      audio: createDeckAudio(),
      sourceNode: null,
      gainNode: null,
      gainValue: deckId === 0 ? 1 : 0,
    };
    decks[deckId] = entry;
  }
  return entry.audio;
}

export function getOrCreateAudio(): HTMLAudioElement {
  return getDeckAudio(0);
}

export function clearAudioSource(audio: HTMLAudioElement) {
  try {
    audio.pause();
    audio.removeAttribute('src');
    audio.src = '';
    audio.load();
  } catch (err) {
    console.warn('[AudioService] Failed to clear audio source:', err);
  }
}

export function setupAudioContext(audio?: HTMLAudioElement): AnalyserNode | null {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!audioContext) {
      audioContext = new AudioCtx();
    }

    if (!analyserNode) {
      analyserNode = audioContext.createAnalyser();
      // fftSize=256 → 128 bins, better frequency resolution without heavy CPU cost.
      // smoothingTimeConstant=0 means NO built-in FFT smoothing — we do our own
      // asymmetric attack/decay smoothing in the consumers, which gives cleaner,
      // more natural live reaction without phantom frequency artifacts.
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0;
    }

    if (!analyserConnected && analyserNode) {
      analyserNode.connect(audioContext.destination);
      analyserConnected = true;
    }

    // Ensure both initialized decks (plus any explicitly passed audio) are wired through GainNodes
    const targetIds: DeckId[] = [0, 1];
    for (const id of targetIds) {
      const entry = decks[id];
      if (!entry) continue;
      wireDeckToContext(entry);
    }

    if (audio && !decks.some((d) => d?.audio === audio)) {
      // Compatibility fallback if called with an external element
      try {
        const src = audioContext.createMediaElementSource(audio);
        if (analyserNode) src.connect(analyserNode);
      } catch {
        // ignore if already connected
      }
    }
  } catch (err) {
    console.warn('[AudioService] AudioContext initialization failed:', err);
  }

  return analyserNode;
}

function wireDeckToContext(entry: DeckEntry) {
  if (!audioContext || !analyserNode) return;

  if (!entry.gainNode) {
    entry.gainNode = audioContext.createGain();
    entry.gainNode.gain.value = entry.gainValue;
    entry.gainNode.connect(analyserNode);
  }

  if (!entry.sourceNode) {
    try {
      entry.sourceNode = audioContext.createMediaElementSource(entry.audio);
      entry.sourceNode.connect(entry.gainNode);
    } catch (err) {
      console.warn('[AudioService] createMediaElementSource failed, trying captureStream:', err);
    }
  }

  if (!entry.sourceNode) {
    const captureStream =
      (entry.audio as unknown as { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream })
        .captureStream ||
      (entry.audio as unknown as { mozCaptureStream?: () => MediaStream }).mozCaptureStream;

    if (typeof captureStream === 'function') {
      try {
        const stream = captureStream.call(entry.audio);
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(entry.gainNode);
      } catch (err) {
        console.warn('[AudioService] captureStream connection failed:', err);
      }
    }
  }
}

export function setMasterVolume(volume: number) {
  masterVolume = Math.max(0, Math.min(1, volume));
  for (const id of [0, 1] as DeckId[]) {
    const entry = decks[id];
    if (!entry) continue;
    entry.audio.volume = entry.gainNode ? masterVolume : masterVolume * entry.gainValue;
  }
}

export function setDeckGain(deckId: DeckId, gain: number) {
  const clamped = Math.max(0, Math.min(1, gain));
  const entry = decks[deckId];
  if (!entry) return;
  entry.gainValue = clamped;
  if (entry.gainNode) {
    entry.gainNode.gain.value = clamped;
    entry.audio.volume = masterVolume;
  } else {
    entry.audio.volume = masterVolume * clamped;
  }
}

export function getAnalyser(): AnalyserNode | null {
  return analyserNode;
}

// fftSize=256 → 128 bins. We only expose 64 to consumers (covers up to ~10 kHz
// at 44100 Hz sample rate), which is plenty for bass/mid/treble decomposition.
const sharedFreqData = new Uint8Array(64);
let lastFreqSampleTime = 0;

/**
 * Samples byte frequency data into outArray, sharing a single FFT calculation
 * across all visualizer and reactive consumers within a single frame (~12ms window).
 */
export function sampleByteFrequencyData(outArray: Uint8Array): boolean {
  if (!analyserNode) return false;
  const now = performance.now();
  if (now - lastFreqSampleTime >= 12) {
    analyserNode.getByteFrequencyData(sharedFreqData);
    lastFreqSampleTime = now;
  }
  outArray.set(sharedFreqData.subarray(0, Math.min(outArray.length, sharedFreqData.length)));
  return true;
}

export function resumeAudioContext() {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
}
