import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  getDiscordSettings,
  setDiscordSettings,
  getDiscordStatus,
} from '../../api';

export const DEFAULT_DISCORD_CLIENT_ID = '1556060308911689789';

export interface DiscordSettingsState {
  enabled: boolean;
  clientId: string;
  showButtons: boolean;
  showPause: boolean;
  connected: boolean;
  lastError: string | null;

  // Actions
  setEnabled: (enabled: boolean) => Promise<void>;
  setClientId: (clientId: string) => Promise<void>;
  setShowButtons: (showButtons: boolean) => Promise<void>;
  setShowPause: (showPause: boolean) => Promise<void>;
  resetClientId: () => Promise<void>;
  syncWithBackend: () => Promise<void>;
  checkStatus: () => Promise<void>;
}

export const useDiscordSettingsStore = create<DiscordSettingsState>()(
  persist(
    (set, get) => ({
      enabled: false,
      clientId: '',
      showButtons: true,
      showPause: true,
      connected: false,
      lastError: null,

      setEnabled: async (enabled: boolean) => {
        set({ enabled });
        const { clientId, showButtons, showPause } = get();
        try {
          await setDiscordSettings({
            enabled,
            client_id: clientId.trim() || DEFAULT_DISCORD_CLIENT_ID,
            show_buttons: showButtons,
            show_pause: showPause,
          });
          get().checkStatus();
        } catch (e) {
          console.error('[DiscordSettings] Failed to save enabled state:', e);
        }
      },

      setClientId: async (clientId: string) => {
        const clean = clientId.trim();
        const stored = (clean === DEFAULT_DISCORD_CLIENT_ID || clean === '1084179647874474125') ? '' : clean;
        set({ clientId: stored });
        const { enabled, showButtons, showPause } = get();
        try {
          await setDiscordSettings({
            enabled,
            client_id: stored || DEFAULT_DISCORD_CLIENT_ID,
            show_buttons: showButtons,
            show_pause: showPause,
          });
          get().checkStatus();
        } catch (e) {
          console.error('[DiscordSettings] Failed to save clientId:', e);
        }
      },

      setShowButtons: async (showButtons: boolean) => {
        set({ showButtons });
        const { enabled, clientId, showPause } = get();
        try {
          await setDiscordSettings({
            enabled,
            client_id: clientId.trim() || DEFAULT_DISCORD_CLIENT_ID,
            show_buttons: showButtons,
            show_pause: showPause,
          });
        } catch (e) {
          console.error('[DiscordSettings] Failed to save showButtons:', e);
        }
      },

      setShowPause: async (showPause: boolean) => {
        set({ showPause });
        const { enabled, clientId, showButtons } = get();
        try {
          await setDiscordSettings({
            enabled,
            client_id: clientId.trim() || DEFAULT_DISCORD_CLIENT_ID,
            show_buttons: showButtons,
            show_pause: showPause,
          });
        } catch (e) {
          console.error('[DiscordSettings] Failed to save showPause:', e);
        }
      },

      resetClientId: async () => {
        await get().setClientId('');
      },

      syncWithBackend: async () => {
        try {
          const backendSettings = await getDiscordSettings();
          if (backendSettings) {
            const rawId = backendSettings.client_id?.trim() || '';
            const resolvedId =
              rawId === DEFAULT_DISCORD_CLIENT_ID || rawId === '1084179647874474125'
                ? ''
                : rawId;

            set({
              enabled: backendSettings.enabled,
              clientId: resolvedId,
              showButtons: backendSettings.show_buttons,
              showPause: backendSettings.show_pause,
            });
          }
          await get().checkStatus();
        } catch (e) {
          const { enabled, clientId, showButtons, showPause } = get();
          try {
            await setDiscordSettings({
              enabled,
              client_id: clientId.trim() || DEFAULT_DISCORD_CLIENT_ID,
              show_buttons: showButtons,
              show_pause: showPause,
            });
          } catch {}
        }
      },

      checkStatus: async () => {
        try {
          const status = await getDiscordStatus();
          set({
            connected: status.connected,
            lastError: status.error ?? null,
          });
        } catch {
          set({ connected: false });
        }
      },
    }),
    {
      name: 'zvuk-discord-settings',
      partialize: (state) => ({
        enabled: state.enabled,
        clientId: state.clientId,
        showButtons: state.showButtons,
        showPause: state.showPause,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (
            state.clientId === DEFAULT_DISCORD_CLIENT_ID ||
            state.clientId === '1084179647874474125'
          ) {
            state.clientId = '';
          }
        }
      },
    }
  )
);
