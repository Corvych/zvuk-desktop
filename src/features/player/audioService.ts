// Audio element and Web Audio API Analyser singleton for audio-reactive visualizations

let audioInstance: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;

export function getOrCreateAudio(): HTMLAudioElement {
  if (!audioInstance) {
    audioInstance = new Audio();
  }
  return audioInstance;
}

export function setupAudioContext(audio: HTMLAudioElement): AnalyserNode | null {
  if (analyserNode) return analyserNode;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    audioContext = new AudioCtx();
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 64;
    analyserNode.smoothingTimeConstant = 0.8;

    // Attempt non-intrusive stream capture first
    const captureStream = (audio as unknown as { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }).captureStream ||
      (audio as unknown as { mozCaptureStream?: () => MediaStream }).mozCaptureStream;

    if (typeof captureStream === 'function') {
      try {
        const stream = captureStream.call(audio);
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyserNode);
        return analyserNode;
      } catch (err) {
        console.warn('[AudioService] captureStream connection failed:', err);
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

export function resumeAudioContext() {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
}
