import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import type { UpdateInfo, DownloadProgressPayload } from './types';
import { checkAvailableUpdate, getAppVersion } from './updaterService';
import { downloadAndInstallUpdate, isTauri } from '../../api';
import { showToast } from '../../components/Toast';

const STORAGE_KEY_LAST_CHECKED = 'zvuk_update_last_checked';
const CHECK_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes cooldown for auto-check

export type UpdateDownloadStatus = 'idle' | 'downloading' | 'installing' | 'error';

interface UpdateState {
  currentVersion: string;
  updateInfo: UpdateInfo | null;
  hasUpdate: boolean;
  isChecking: boolean;
  isModalOpen: boolean;
  lastChecked: number | null;
  error: string | null;
  isSimulated: boolean;

  // In-app update download state
  isDownloading: boolean;
  downloadStatus: UpdateDownloadStatus;
  downloadProgress: DownloadProgressPayload | null;
  downloadError: string | null;

  init: () => Promise<void>;
  checkForUpdates: (manual?: boolean) => Promise<boolean>;
  openModal: () => void;
  closeModal: () => void;
  dismissUpdate: () => void;
  triggerTestUpdate: () => void;
  startInAppUpdate: () => Promise<void>;
}

const getStoredLastChecked = (): number | null => {
  try {
    const val = localStorage.getItem(STORAGE_KEY_LAST_CHECKED);
    return val ? parseInt(val, 10) : null;
  } catch {
    return null;
  }
};

const setStoredLastChecked = (time: number) => {
  try {
    localStorage.setItem(STORAGE_KEY_LAST_CHECKED, time.toString());
  } catch {
    // Ignore storage errors
  }
};

export const useUpdateStore = create<UpdateState>((set, get) => ({
  currentVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.4',
  updateInfo: null,
  hasUpdate: false,
  isChecking: false,
  isModalOpen: false,
  lastChecked: getStoredLastChecked(),
  error: null,
  isSimulated: false,

  isDownloading: false,
  downloadStatus: 'idle',
  downloadProgress: null,
  downloadError: null,

  init: async () => {
    const version = await getAppVersion();
    set({ currentVersion: version });
  },

  checkForUpdates: async (manual = false) => {
    const state = get();
    if (state.isChecking || state.isDownloading) return false;

    // Cooldown check for automatic checks
    if (!manual && state.lastChecked) {
      const elapsed = Date.now() - state.lastChecked;
      if (elapsed < CHECK_COOLDOWN_MS && state.updateInfo) {
        return state.hasUpdate;
      }
      if (elapsed < CHECK_COOLDOWN_MS && !state.hasUpdate) {
        return false;
      }
    }

    set({ isChecking: true, error: null });

    try {
      const result = await checkAvailableUpdate();
      const now = Date.now();
      setStoredLastChecked(now);

      set({
        currentVersion: result.currentVersion,
        hasUpdate: result.hasUpdate,
        updateInfo: result.updateInfo,
        lastChecked: now,
        isChecking: false,
        isSimulated: false,
        error: null,
      });

      return result.hasUpdate;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Ошибка при проверке обновлений';
      console.warn('[Updater] Check failed:', errMsg);
      set({
        isChecking: false,
        error: errMsg,
      });
      return false;
    }
  },

  openModal: () => set({ isModalOpen: true }),
  closeModal: () => {
    const state = get();
    // Prevent accidental close during active download
    if (state.isDownloading && state.downloadStatus === 'downloading') {
      return;
    }
    set({ isModalOpen: false });
  },
  dismissUpdate: () => set({ hasUpdate: false, isModalOpen: false }),

  startInAppUpdate: async () => {
    const { updateInfo, isDownloading, isSimulated } = get();
    if (!updateInfo || isDownloading) return;

    set({
      isDownloading: true,
      downloadStatus: 'downloading',
      downloadError: null,
      downloadProgress: {
        downloaded: 0,
        total: updateInfo.assetSize || 0,
        percentage: 0,
      },
    });

    if (isSimulated || !isTauri()) {
      // Smooth simulation in browser or test mode
      const totalBytes = updateInfo.assetSize || 45 * 1024 * 1024;
      let percent = 0;
      const timer = setInterval(() => {
        percent += 10;
        if (percent >= 100) {
          clearInterval(timer);
          set({
            downloadProgress: { downloaded: totalBytes, total: totalBytes, percentage: 100 },
            downloadStatus: 'installing',
          });
          setTimeout(() => {
            set({ isDownloading: false, downloadStatus: 'idle' });
            showToast('Тест: Загрузка завершена! В приложении запустился бы инсталлятор.', 'info', 5000);
          }, 2000);
        } else {
          set({
            downloadProgress: {
              downloaded: Math.round((totalBytes * percent) / 100),
              total: totalBytes,
              percentage: percent,
            },
          });
        }
      }, 300);
      return;
    }

    try {
      await downloadAndInstallUpdate(updateInfo.downloadUrl, updateInfo.assetName);
      set({ downloadStatus: 'installing' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Updater] Download error:', msg);
      set({
        isDownloading: false,
        downloadStatus: 'error',
        downloadError: msg,
      });
      showToast(`Ошибка загрузки: ${msg}`, 'error');
    }
  },

  // Helper for UI testing
  triggerTestUpdate: () => {
    set({
      hasUpdate: true,
      isSimulated: true,
      downloadStatus: 'idle',
      isDownloading: false,
      downloadProgress: null,
      downloadError: null,
      updateInfo: {
        version: '0.0.5',
        tagName: 'v0.0.5',
        name: 'Zvuk Desktop v0.0.5',
        body: '### ✨ Что нового:\n- 🚀 Встроенное скачивание и автоустановка обновлений\n- 🎨 Улучшен боковой бар и анимации\n- ⚡ Повышена стабильность воспроизведения Hi-Fi FLAC\n- 🐛 Исправлены мелкие ошибки интерфейса',
        publishedAt: new Date().toISOString(),
        htmlUrl: 'https://github.com/Corvych/zvuk-desktop/releases',
        downloadUrl: 'https://github.com/Corvych/zvuk-desktop/releases',
        assetName: 'Zvuk.Desktop_0.0.5_x64-setup.exe',
        assetSize: 44236800,
        isPrerelease: false,
      },
    });
  },
}));

// Setup global Tauri listeners for download progress
if (isTauri()) {
  listen<DownloadProgressPayload>('update-download-progress', (event) => {
    useUpdateStore.setState({
      downloadProgress: event.payload,
      downloadStatus: 'downloading',
    });
  });

  listen<string>('update-download-complete', () => {
    useUpdateStore.setState({
      downloadStatus: 'installing',
    });
  });
}

// Expose triggerTestUpdate in window for quick developer access
if (typeof window !== 'undefined') {
  (window as unknown as { __triggerTestUpdate: () => void }).__triggerTestUpdate = () => {
    useUpdateStore.getState().triggerTestUpdate();
  };
}
