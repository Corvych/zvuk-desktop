import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AppearanceSettingsState {
  enableVisualEffects: boolean;
  setEnableVisualEffects: (enabled: boolean) => void;
}

export const useAppearanceSettingsStore = create<AppearanceSettingsState>()(
  persist(
    (set) => ({
      enableVisualEffects: true,
      setEnableVisualEffects: (enabled) => set({ enableVisualEffects: enabled }),
    }),
    {
      name: 'zvuk-appearance-settings',
    }
  )
);
