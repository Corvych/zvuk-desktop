import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { parseZvukLink, isRedirectLink, extractUrlFromText, type ParsedZvukLink } from '../utils/linkParser';
import { getTrack } from '../api';
import { usePlayerStore } from '../features/player/playerStore';
import { showToast } from '../components/Toast';

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'textarea' ||
    target.isContentEditable ||
    target.getAttribute('contenteditable') === 'true' ||
    (tagName === 'input' && !target.classList.contains('search-bar__input'))
  );
}

export function useClipboardPasteHandler() {
  const navigate = useNavigate();
  const setQueue = usePlayerStore((s) => s.setQueue);
  const isHandlingRef = useRef(false);

  const handleParsedLink = async (parsed: ParsedZvukLink) => {
    try {
      switch (parsed.type) {
        case 'track': {
          showToast('Загружаем трек...', 'info', 2000);
          const track = await getTrack(Number(parsed.id));
          if (track) {
            setQueue([track], 0);
            showToast(`Включаем: ${track.artist} - ${track.title}`, 'info');
          } else {
            showToast(`Трек #${parsed.id} не найден`, 'error');
          }
          break;
        }

        case 'artist': {
          showToast('Открываем исполнителя', 'info', 2000);
          navigate(`/artist/${parsed.id}`);
          break;
        }

        case 'release': {
          showToast('Открываем альбом', 'info', 2000);
          navigate(`/album/${parsed.id}`);
          break;
        }

        case 'playlist': {
          showToast('Открываем плейлист', 'info', 2000);
          navigate(`/playlist/${parsed.id}`);
          break;
        }
      }
    } catch (err) {
      console.error('[PasteHandler] Error processing parsed link:', err);
      showToast('Не удалось открыть контент по ссылке', 'error');
    }
  };

  const processPastedText = async (text: string): Promise<boolean> => {
    if (!text || isHandlingRef.current) return false;

    // Fast check: does it look like a Zvuk link at all?
    const hasZvukKeywords = /zvuk|onelink\.me/i.test(text);
    if (!hasZvukKeywords) return false;

    try {
      isHandlingRef.current = true;
      if (isRedirectLink(text)) {
        showToast('Распознаем ссылку...', 'info', 2000);
      }

      const parsed = await parseZvukLink(text);
      if (parsed) {
        await handleParsedLink(parsed);
        return true;
      } else {
        showToast('Не удалось распознать ссылку Звука', 'error');
      }
    } catch (err) {
      console.error('[PasteHandler] Failed to parse link:', err);
      showToast('Ошибка при обработке ссылки', 'error');
    } finally {
      isHandlingRef.current = false;
    }

    return false;
  };

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      // If user is typing in a non-search editable input (e.g. playlist rename), don't intercept
      if (isEditableElement(e.target)) {
        return;
      }

      const text = e.clipboardData?.getData('text');
      if (!text) return;

      const handled = await processPastedText(text);
      if (handled) {
        e.preventDefault();
        // If pasted into search input, blur it to clean focus
        if (e.target instanceof HTMLInputElement && e.target.classList.contains('search-bar__input')) {
          e.target.value = '';
          e.target.blur();
        }
      }
    };

    window.addEventListener('paste', handlePaste);

    // Also listen for deep links passed from OS or second instance
    let unlistenDeepLink: (() => void) | undefined;
    listen<string[]>('deep-link-received', (event) => {
      const args = (event.payload || []).slice(1);
      for (const arg of args) {
        if (arg.startsWith('-')) continue;
        if (extractUrlFromText(arg) && /zvuk|onelink\.me/i.test(arg)) {
          processPastedText(arg);
          break;
        }
      }
    }).then((fn) => {
      unlistenDeepLink = fn;
    });

    return () => {
      window.removeEventListener('paste', handlePaste);
      if (unlistenDeepLink) unlistenDeepLink();
    };
  }, [navigate, setQueue]);
}

