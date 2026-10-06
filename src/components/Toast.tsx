import { useState, useEffect } from 'react';
import { create } from 'zustand';

export interface ToastItem {
  id: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

interface ToastStore {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => string;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      // Keep newest toast (up to 2 if quickly spammed)
      toasts: [...state.toasts.slice(-1), { ...toast, id }],
    }));
    return id;
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

export function showToast(
  message: string,
  type: 'info' | 'success' | 'warning' | 'error' = 'info',
  duration: number = 3200
) {
  useToastStore.getState().addToast({ message, type, duration });
}

function formatToastMessage(message: string) {
  const parts = message.split(/(HiFi|HQ|SQ)/g);
  if (parts.length === 1) return message;

  return parts.map((part, index) => {
    if (part === 'HiFi') {
      return (
        <span key={index} className="toast-badge toast-badge--hifi">
          HiFi
        </span>
      );
    }
    if (part === 'HQ') {
      return (
        <span key={index} className="toast-badge toast-badge--hq">
          HQ
        </span>
      );
    }
    if (part === 'SQ') {
      return (
        <span key={index} className="toast-badge toast-badge--sq">
          SQ
        </span>
      );
    }
    return part;
  });
}

function ToastElement({ toast, onRemove }: { toast: ToastItem; onRemove: () => void }) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (!toast.duration || toast.duration <= 0) return;
    const timer = setTimeout(() => {
      setIsExiting(true);
    }, toast.duration);

    return () => clearTimeout(timer);
  }, [toast.duration]);

  const handleAnimationEnd = (e: React.AnimationEvent) => {
    if (isExiting && e.animationName === 'toast-out') {
      onRemove();
    }
  };

  const handleClose = () => {
    setIsExiting(true);
  };

  return (
    <div
      className={`toast toast--${toast.type || 'info'} ${isExiting ? 'toast--exiting' : ''}`}
      onClick={handleClose}
      onAnimationEnd={handleAnimationEnd}
      role="button"
      tabIndex={0}
      title="Нажмите, чтобы скрыть"
    >
      <div className="toast__content">
        <span className="toast__icon">
          {toast.type === 'success' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : toast.type === 'error' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          ) : toast.type === 'warning' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" fill="currentColor" fillOpacity="0.25" />
              <circle cx="18" cy="16" r="3" fill="currentColor" fillOpacity="0.25" />
            </svg>
          )}
        </span>
        <span className="toast__message">{formatToastMessage(toast.message)}</span>
      </div>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((t) => (
        <ToastElement key={t.id} toast={t} onRemove={() => removeToast(t.id)} />
      ))}
    </div>
  );
}
