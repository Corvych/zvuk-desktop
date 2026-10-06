import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import type { UserProfile } from '../../api';
import * as api from '../../api';

if (api.isTauri()) {
  listen<UserProfile>('auth-changed', (event) => {
    useAuthStore.setState({
      user: event.payload,
      isAuthenticated: event.payload !== null,
      isLoading: false,
      error: null,
    });
  });
}

interface AuthState {
  user: UserProfile | null;
  isLoading: boolean;
  isSberIdOpening: boolean;
  isAuthenticated: boolean;
  isGuest: boolean;
  showLoginModal: boolean;
  error: string | null;

  checkAuth: () => Promise<void>;
  login: (token: string) => Promise<void>;
  startSberIdLogin: () => Promise<void>;
  startBrowserLogin: () => Promise<void>;
  logout: () => Promise<void>;
  continueAsGuest: () => void;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isSberIdOpening: false,
  isAuthenticated: false,
  isGuest: false,
  showLoginModal: false,
  error: null,

  continueAsGuest: () => set({ isGuest: true, showLoginModal: false }),
  openLoginModal: () => set({ showLoginModal: true }),
  closeLoginModal: () => set({ showLoginModal: false }),

  checkAuth: async () => {
    set({ isLoading: true, error: null });
    try {
      const user = await api.checkAuthStatus();
      set({
        user,
        isAuthenticated: user !== null,
        isLoading: false,
      });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  login: async (token: string) => {
    set({ isLoading: true, error: null });
    try {
      const user = await api.loginWithToken(token);
      set({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  startSberIdLogin: async () => {
    set({ isSberIdOpening: true, error: null });
    try {
      await api.openSberIdLogin();
    } catch (err) {
      set({
        error: `Не удалось открыть окно Сбер ID: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      set({ isSberIdOpening: false });
    }
  },

  startBrowserLogin: async () => {
    set({ isSberIdOpening: true, error: null });
    try {
      await api.openBrowserLogin();
    } catch (err) {
      set({
        error: `Не удалось открыть браузер: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      set({ isSberIdOpening: false });
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } catch {
      // Ignore logout errors
    }
    set({ user: null, isAuthenticated: false, error: null });
  },

  clearError: () => set({ error: null }),
}));
