// Audio element and Web Audio API Analyser singleton for audio-reactive visualizations

let audioInstance: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let mediaSourceNode: MediaElementAudioSourceNode | null = null;

export function getOrCreateAudio(): HTMLAudioElement {
  if (!audioInstance) {
    audioInstance = new Audio();
    // Enable cross-origin so Web Audio Analyser can read frequency data
    audioInstance.crossOrigin = 'anonymous';
    // Use metadata preload to avoid aggressive in-memory over-buffering
    audioInstance.preload = 'metadata';
  }
  return audioInstance;
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

export function setupAudioContext(audio: HTMLAudioElement): AnalyserNode | null {
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
      analyserNode.fftSize = 128;
      analyserNode.smoothingTimeConstant = 0.7;
    }

    if (!mediaSourceNode && audio) {
      try {
        mediaSourceNode = audioContext.createMediaElementSource(audio);
        mediaSourceNode.connect(analyserNode);
        analyserNode.connect(audioContext.destination);
      } catch (err) {
        console.warn('[AudioService] createMediaElementSource failed, trying captureStream:', err);
      }
    }

    // Fallback: captureStream if createMediaElementSource was unavailable
    if (!mediaSourceNode && audio) {
      const captureStream =
        (audio as unknown as { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream })
          .captureStream ||
        (audio as unknown as { mozCaptureStream?: () => MediaStream }).mozCaptureStream;

      if (typeof captureStream === 'function') {
        try {
          const stream = captureStream.call(audio);
          const source = audioContext.createMediaStreamSource(stream);
          source.connect(analyserNode);
        } catch (err) {
          console.warn('[AudioService] captureStream connection failed:', err);
        }
      }
    }
  } catch (err) {
    console.warn('[AudioService] AudioContext initialization failed:', err);
  }

  return analyserNode;
}

export function getAnalyser(): AnalyserNode | null {
  return analyserNode;
}

const sharedFreqData = new Uint8Array(32);
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
