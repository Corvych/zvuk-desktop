import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FullscreenScaleOption = 'auto' | 0.75 | 0.85 | 1 | 1.15 | 1.3 | 1.5 | 1.75 | 2;

export interface ScalePreset {
  value: FullscreenScaleOption;
  label: string;
  desc: string;
}

export const SCALE_OPTIONS: ScalePreset[] = [
  { value: 'auto', label: 'Авто', desc: 'Автоматически под размер и разрешение экрана' },
  { value: 0.75, label: '75%', desc: 'Компактный — для небольших экранов и окон' },
  { value: 0.85, label: '85%', desc: 'Уменьшенный — для ноутбуков (720p / 768p)' },
  { value: 1, label: '100%', desc: 'Стандартный — оптимально для Full HD (1080p)' },
  { value: 1.15, label: '115%', desc: 'Комфортный — слегка увеличенный размер' },
  { value: 1.3, label: '130%', desc: 'Крупный — для мониторов 2K / QHD (1440p)' },
  { value: 1.5, label: '150%', desc: 'Большой — для мониторов 4K / UHD' },
  { value: 1.75, label: '175%', desc: 'Очень крупный — для больших мониторов и ТВ' },
  { value: 2, label: '200%', desc: 'Максимальный — режим ТВ / просмотр с дивана' },
];

const SCALE_VALUES: FullscreenScaleOption[] = [0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];

export interface DetectedScreenInfo {
  category: string;
  baseScale: number;
  percentageText: string;
}

export function detectScreenResolution(width: number, height: number): DetectedScreenInfo {
  if (height <= 640) {
    return { category: 'Компактный (≤600p)', baseScale: 0.76, percentageText: '76%' };
  }
  if (height <= 760 || width <= 1080) {
    return { category: 'Ноутбук (720p/768p)', baseScale: 0.86, percentageText: '86%' };
  }
  if (height >= 1551 || (width >= 3000 && height >= 1200)) {
    return { category: '4K UHD / ТВ', baseScale: 1.55, percentageText: '155%' };
  }
  if (height >= 1150 || (width >= 2100 && height >= 950)) {
    return { category: '2K QHD / Ultrawide', baseScale: 1.25, percentageText: '125%' };
  }
  return { category: 'Full HD (1080p)', baseScale: 1.0, percentageText: '100%' };
}

export interface FullscreenSettingsState {
  scale: FullscreenScaleOption;
  setScale: (scale: FullscreenScaleOption) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

export const useFullscreenSettingsStore = create<FullscreenSettingsState>()(
  persist(
    (set, get) => ({
      scale: 'auto',
      setScale: (scale) => set({ scale }),
      zoomIn: () => {
        const current = get().scale;
        if (current === 'auto') {
          set({ scale: 1.15 });
          return;
        }
        const idx = SCALE_VALUES.indexOf(current);
        if (idx !== -1 && idx < SCALE_VALUES.length - 1) {
          set({ scale: SCALE_VALUES[idx + 1] });
        }
      },
      zoomOut: () => {
        const current = get().scale;
        if (current === 'auto') {
          set({ scale: 0.85 });
          return;
        }
        const idx = SCALE_VALUES.indexOf(current);
        if (idx > 0) {
          set({ scale: SCALE_VALUES[idx - 1] });
        }
      },
      resetZoom: () => set({ scale: 'auto' }),
    }),
    {
      name: 'zvuk-fullscreen-settings',
    }
  )
);

