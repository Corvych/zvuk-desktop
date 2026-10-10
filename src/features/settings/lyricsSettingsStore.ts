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
  timingOffset: number; // in seconds (e.g. -0.5 to +0.5)
  setEnableZvuk: (enabled: boolean) => void;
  setEnableBetterLyrics: (enabled: boolean) => void;
  setEnableNetease: (enabled: boolean) => void;
  setEnableLrclib: (enabled: boolean) => void;
  setPreferWordSync: (enabled: boolean) => void;
  setPriority: (priority: LyricsSourcePriority) => void;
  setTimingOffset: (offset: number) => void;
  adjustTimingOffset: (delta: number) => void;
  resetTimingOffset: () => void;
}

export const useLyricsSettingsStore = create<LyricsSettingsState>()(
  persist(
    (set) => ({
      enableZvuk: true,
      enableBetterLyrics: true,
      enableNetease: true,
      enableLrclib: true,
      preferWordSync: true,
      priority: 'betterlyrics',
      timingOffset: 0,
      setEnableZvuk: (enabled) => set({ enableZvuk: enabled }),
      setEnableBetterLyrics: (enabled) => set({ enableBetterLyrics: enabled }),
      setEnableNetease: (enabled) => set({ enableNetease: enabled }),
      setEnableLrclib: (enabled) => set({ enableLrclib: enabled }),
      setPreferWordSync: (preferWordSync) => set({ preferWordSync }),
      setPriority: (priority) => set({ priority }),
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


