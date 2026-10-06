import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LyricsSourcePriority = 'zvuk' | 'lrclib';

export interface LyricsSettingsState {
  enableZvuk: boolean;
  enableLrclib: boolean;
  priority: LyricsSourcePriority;
  setEnableZvuk: (enabled: boolean) => void;
  setEnableLrclib: (enabled: boolean) => void;
  setPriority: (priority: LyricsSourcePriority) => void;
}

export const useLyricsSettingsStore = create<LyricsSettingsState>()(
  persist(
    (set) => ({
      enableZvuk: true,
      enableLrclib: true,
      priority: 'zvuk',
      setEnableZvuk: (enabled) => set({ enableZvuk: enabled }),
      setEnableLrclib: (enabled) => set({ enableLrclib: enabled }),
      setPriority: (priority) => set({ priority }),
    }),
    {
      name: 'zvuk-lyrics-settings',
    }
  )
);
