import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getLikedTracks, getPersonalWave, isTauri } from '../../api';
import { showToast } from '../../components/Toast';
import { useAuthStore } from '../auth/authStore';
import { usePlayerStore } from './playerStore';

export type TaskbarAction = 'play-flow' | 'play-favourites';

let activeRequestId = 0;

async function executeTaskbarAction(action: string) {
  const requestId = ++activeRequestId;

  if (action === 'play-flow') {
    const state = usePlayerStore.getState();
    if (
      state.isWaveMode &&
      state.waveType === 'personal' &&
      state.waveMood?.discovery !== 'favorite' &&
      state.currentTrack
    ) {
      if (!state.isPlaying) {
        state.setIsPlaying(true);
      }
      return;
    }

    if (!useAuthStore.getState().isAuthenticated) {
      showToast('Войдите в аккаунт, чтобы включить «Мой поток»', 'info');
      return;
    }

    const opts =
      state.waveMood && state.waveMood.discovery !== 'favorite'
        ? state.waveOptions
        : null;

    try {
      const tracks = await getPersonalWave(null, 15, opts || undefined, 'AMAZME', null);
      if (requestId !== activeRequestId) return;
      if (tracks && tracks.length > 0) {
        const latest = usePlayerStore.getState();
        if (latest.waveMood?.discovery === 'favorite') {
          latest.setWaveMood(null);
        }
        latest.startWave(tracks, opts);
      } else {
        showToast('Не удалось загрузить «Мой поток»', 'error');
      }
    } catch (err) {
      if (requestId !== activeRequestId) return;
      console.error('[useTaskbarActions] Failed to start My Flow:', err);
      showToast('Не удалось включить «Мой поток»', 'error');
    }
    return;
  }

  if (action === 'play-favourites') {
    const state = usePlayerStore.getState();
    if (!state.isWaveMode && state.queueContext?.type === 'favourites' && state.currentTrack) {
      if (!state.isPlaying) {
        state.setIsPlaying(true);
      }
      return;
    }

    if (!useAuthStore.getState().isAuthenticated) {
      showToast('Войдите в аккаунт, чтобы включить «Любимое»', 'info');
      return;
    }

    try {
      const res = await getLikedTracks(0, 50);
      if (requestId !== activeRequestId) return;
      if (res?.items && res.items.length > 0) {
        usePlayerStore.getState().setQueue(res.items, 0, {
          type: 'favourites',
          offset: res.items.length,
          hasNext: res.has_next,
          total: res.total,
        });
      } else {
        showToast('Список любимых треков пуст', 'info');
      }
    } catch (err) {
      if (requestId !== activeRequestId) return;
      console.error('[useTaskbarActions] Failed to start Favourites:', err);
      showToast('Не удалось включить «Любимое»', 'error');
    }
  }
}

/**
 * Handles Windows Taskbar Jump List tasks ("Включить Мой поток", "Включить Любимое")
 * both on cold start and when triggered from a second-instance launch.
 */
export function useTaskbarActions() {
  useEffect(() => {
    if (!isTauri()) return;

    let isCancelled = false;
    let unlisten: (() => void) | null = null;

    const init = async () => {
      try {
        const fn = await listen<string>('taskbar-action', (event) => {
          if (!isCancelled && event.payload) {
            void executeTaskbarAction(event.payload);
          }
        });

        if (isCancelled) {
          fn();
          return;
        }
        unlisten = fn;

        const pendingAction = await invoke<string | null>('take_pending_taskbar_action');
        if (!isCancelled && pendingAction) {
          void executeTaskbarAction(pendingAction);
        }
      } catch (err) {
        console.warn('[useTaskbarActions] Failed to setup taskbar action listeners:', err);
      }
    };

    void init();

    return () => {
      isCancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);
}

