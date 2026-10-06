import type { WaveTunerState } from '../components/WaveTunerModal';
import type { WaveMoodInfo, EmotionDescriptor } from '../../player/playerStore';

export function computeWaveMood(state: WaveTunerState | null): WaveMoodInfo | null {
  if (!state) return null;

  const isPadCenter = Math.abs(state.pad.x) < 0.14 && Math.abs(state.pad.y) < 0.14;
  const hasNoFilters = !state.discovery && !state.popularity && !state.language;
  if (isPadCenter && hasNoFilters) {
    return null; // Considered reset / default "Мой персональный поток"
  }

  // Normalized coordinates:
  // u: 0 (left) .. 1 (right)
  // v: 0 (bottom) .. 1 (top)
  const u = Math.max(0, Math.min(1, (state.pad.x + 1) / 2));
  const v = Math.max(0, Math.min(1, (state.pad.y + 1) / 2));

  // 4 emotion corners:
  // Top-Left: ЭНЕРГИЧНОЕ (#ec8c4a: 236, 140, 74) -> энергичная
  // Top-Right: ВЕСЁЛОЕ (#70dc55: 112, 220, 85) -> весёлая
  // Bottom-Left: ГРУСТНОЕ (#98aff4: 152, 175, 244) -> грустная
  // Bottom-Right: СПОКОЙНОЕ (#69aaf5: 105, 170, 245) -> спокойная
  const wEnergy = (1 - u) * v;
  const wFun = u * v;
  const wSad = (1 - u) * (1 - v);
  const wCalm = u * (1 - v);

  const activeR = Math.round(wEnergy * 236 + wFun * 112 + wSad * 152 + wCalm * 105);
  const activeG = Math.round(wEnergy * 140 + wFun * 220 + wSad * 175 + wCalm * 170);
  const activeB = Math.round(wEnergy * 74 + wFun * 85 + wSad * 244 + wCalm * 245);
  const activeRgb = `${activeR}, ${activeG}, ${activeB}`;

  const allEmotions = [
    { id: 'calm', label: 'спокойная', color: '#69aaf5', rgb: [105, 170, 245] as [number, number, number], weight: wCalm },
    { id: 'sad', label: 'грустная', color: '#98aff4', rgb: [152, 175, 244] as [number, number, number], weight: wSad },
    { id: 'energy', label: 'энергичная', color: '#ec8c4a', rgb: [236, 140, 74] as [number, number, number], weight: wEnergy },
    { id: 'fun', label: 'весёлая', color: '#70dc55', rgb: [112, 220, 85] as [number, number, number], weight: wFun },
  ];

  // Sort by weight descending
  const sorted = [...allEmotions].sort((a, b) => b.weight - a.weight);

  const dominantEmotions: EmotionDescriptor[] = [];
  if (sorted[0].weight >= 0.12) {
    dominantEmotions.push({
      id: sorted[0].id,
      label: sorted[0].label,
      color: sorted[0].color,
      rgb: sorted[0].rgb,
    });
  }

  // If second emotion is close enough in weight (e.g. at least 38% of top and >= 0.18)
  if (
    sorted[1].weight >= 0.18 &&
    sorted[1].weight / (sorted[0].weight || 1) >= 0.38
  ) {
    dominantEmotions.push({
      id: sorted[1].id,
      label: sorted[1].label,
      color: sorted[1].color,
      rgb: sorted[1].rgb,
    });
  }

  return {
    activeRgb,
    dominantEmotions,
    pad: state.pad,
    discovery: state.discovery,
    popularity: state.popularity,
    language: state.language,
  };
}
