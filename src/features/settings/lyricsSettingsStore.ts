import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LyricsSource = 'zvuk' | 'betterlyrics' | 'netease' | 'lrclib';
export type LyricsSourcePriority = LyricsSource;

export interface LyricsSettingsState {
  enableZvuk: boolean;
  enableBetterLyrics: boolean;
  enableNetease: boolean;
  enableLrclib: boolean;
  preferWordSync: boolean; // Prefer providers that have Enhanced Word/Syllable sync
  priority: LyricsSourcePriority;
  sourceOrder: LyricsSource[];
  timingOffset: number; // in seconds (e.g. -0.5 to +0.5)
  setEnableZvuk: (enabled: boolean) => void;
  setEnableBetterLyrics: (enabled: boolean) => void;
  setEnableNetease: (enabled: boolean) => void;
  setEnableLrclib: (enabled: boolean) => void;
  setSourceEnabled: (source: LyricsSource, enabled: boolean) => void;
  setPreferWordSync: (enabled: boolean) => void;
  setPriority: (priority: LyricsSourcePriority) => void;
  setSourceOrder: (order: LyricsSource[]) => void;
  moveSource: (source: LyricsSource, direction: 'up' | 'down') => void;
  setTimingOffset: (offset: number) => void;
  adjustTimingOffset: (delta: number) => void;
  resetTimingOffset: () => void;
}

const DEFAULT_SOURCE_ORDER: LyricsSource[] = ['betterlyrics', 'netease', 'zvuk', 'lrclib'];

export const useLyricsSettingsStore = create<LyricsSettingsState>()(
  persist(
    (set) => ({
      enableZvuk: true,
      enableBetterLyrics: true,
      enableNetease: true,
      enableLrclib: true,
      preferWordSync: true,
      priority: 'betterlyrics',
      sourceOrder: DEFAULT_SOURCE_ORDER,
      timingOffset: 0,
      setEnableZvuk: (enabled) => set({ enableZvuk: enabled }),
      setEnableBetterLyrics: (enabled) => set({ enableBetterLyrics: enabled }),
      setEnableNetease: (enabled) => set({ enableNetease: enabled }),
      setEnableLrclib: (enabled) => set({ enableLrclib: enabled }),
      setSourceEnabled: (source, enabled) =>
        set((state) => {
          if (source === 'zvuk') return { enableZvuk: enabled };
          if (source === 'betterlyrics') return { enableBetterLyrics: enabled };
          if (source === 'netease') return { enableNetease: enabled };
          if (source === 'lrclib') return { enableLrclib: enabled };
          return state;
        }),
      setPreferWordSync: (preferWordSync) => set({ preferWordSync }),
      setPriority: (priority) => set({ priority }),
      setSourceOrder: (sourceOrder) => set({ sourceOrder, priority: sourceOrder[0] }),
      moveSource: (source, direction) =>
        set((state) => {
          const currentOrder =
            Array.isArray(state.sourceOrder) && state.sourceOrder.length === 4
              ? [...state.sourceOrder]
              : [...DEFAULT_SOURCE_ORDER];
          const idx = currentOrder.indexOf(source);
          if (idx === -1) return state;
          const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
          if (targetIdx < 0 || targetIdx >= currentOrder.length) return state;

          const [removed] = currentOrder.splice(idx, 1);
          currentOrder.splice(targetIdx, 0, removed);

          return {
            sourceOrder: currentOrder,
            priority: currentOrder[0],
          };
        }),
      setTimingOffset: (timingOffset) => set({ timingOffset }),
      adjustTimingOffset: (delta) =>
        set((state) => ({
          timingOffset: Math.round((state.timingOffset + delta) * 10) / 10,
        })),
      resetTimingOffset: () => set({ timingOffset: 0 }),
    }),
    {
      name: 'zvuk-lyrics-settings',
    }
  )
);
