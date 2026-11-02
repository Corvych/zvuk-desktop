import { create } from 'zustand';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface WindowFreezeState {
  isFrozen: boolean;
  setFrozen: (frozen: boolean) => void;
}

export const useWindowFreezeStore = create<WindowFreezeState>((set) => ({
  isFrozen: typeof document !== 'undefined' ? document.hidden : false,
  setFrozen: (isFrozen) => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('app-window-frozen', isFrozen);
    }
    set((state) => (state.isFrozen === isFrozen ? state : { isFrozen }));
  },
}));

export const useWindowFrozen = () => useWindowFreezeStore((s) => s.isFrozen);
export const getIsWindowFrozen = () => useWindowFreezeStore.getState().isFrozen;

/**
 * Initializes listeners for window minimization and visibility changes.
 * Detects:
 * 1. Tauri v2 window minimization state (via appWindow.isMinimized())
 * 2. Tauri window resize & focus events
 * 3. Browser visibilitychange and window blur/focus
 *
 * Automatically manages an 800ms heartbeat only while minimized to guarantee
 * immediate restoration wakeup even if an OS edge-case drops a window event.
 */
export function initWindowFreezeListeners(): () => void {
  let isChecking = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let unlistenResize: (() => void) | null = null;
  let unlistenFocus: (() => void) | null = null;

  const checkState = async () => {
    if (isChecking) return;
    isChecking = true;
    try {
      let isMinimized = false;
      try {
        const appWin = getCurrentWindow();
        if (appWin && typeof appWin.isMinimized === 'function') {
          isMinimized = await appWin.isMinimized();
        }
      } catch {
        // Fallback if not running in Tauri context
      }

      const isHidden = Boolean(document.hidden || isMinimized);
      const currentFrozen = useWindowFreezeStore.getState().isFrozen;

      if (currentFrozen !== isHidden) {
        useWindowFreezeStore.getState().setFrozen(isHidden);
      }

      // Safety net polling ONLY while minimized/frozen
      if (isHidden) {
        if (!pollTimer) {
          pollTimer = setInterval(checkState, 750);
        }
      } else {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }
    } finally {
      isChecking = false;
    }
  };

  const onVisibilityChange = () => {
    checkState();
  };

  const onWindowResize = () => {
    checkState();
  };

  const onWindowFocus = () => {
    checkState();
  };

  const onWindowBlur = () => {
    checkState();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('focus', onWindowFocus);
  window.addEventListener('blur', onWindowBlur);

  // Hook into native Tauri window events
  try {
    const appWin = getCurrentWindow();
    if (appWin) {
      if (typeof appWin.onResized === 'function') {
        appWin.onResized(() => {
          checkState();
        }).then((unlisten) => {
          unlistenResize = unlisten;
        }).catch(() => {});
      }
      if (typeof appWin.onFocusChanged === 'function') {
        appWin.onFocusChanged(() => {
          checkState();
        }).then((unlisten) => {
          unlistenFocus = unlisten;
        }).catch(() => {});
      }
    }
  } catch {
    // Non-Tauri environment
  }

  // Initial check on startup
  checkState();

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('resize', onWindowResize);
    window.removeEventListener('focus', onWindowFocus);
    window.removeEventListener('blur', onWindowBlur);
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (unlistenResize) unlistenResize();
    if (unlistenFocus) unlistenFocus();
  };
}

