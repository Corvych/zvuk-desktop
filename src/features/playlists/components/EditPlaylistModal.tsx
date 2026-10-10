import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { updatePlaylist, getPlaylist, type Playlist, type Track } from '../../../api';
import { showToast } from '../../../components/Toast';

interface EditPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlist: Playlist;
  initialTracks: Track[];
  onSaveSuccess: (updatedName: string, updatedTracks: Track[], isPublic: boolean) => void;
}

export const EditPlaylistModal: React.FC<EditPlaylistModalProps> = ({
  isOpen,
  onClose,
  playlist,
  initialTracks,
  onSaveSuccess,
}) => {
  const [name, setName] = useState<string>(playlist.title || '');
  const [isPublic, setIsPublic] = useState<boolean>(playlist.is_public ?? false);
  const [checkingPublicity, setCheckingPublicity] = useState<boolean>(false);
  const [tracks, setTracks] = useState<Track[]>(initialTracks || []);
  const [saving, setSaving] = useState<boolean>(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(playlist.title || '');
      setTracks(initialTracks || []);
      setSaving(false);
      setDraggedIndex(null);

      if (typeof playlist.is_public === 'boolean') {
        setIsPublic(playlist.is_public);
      } else {
        setCheckingPublicity(true);
        getPlaylist(playlist.id)
          .then((fullPl) => {
            if (typeof fullPl.is_public === 'boolean') {
              setIsPublic(fullPl.is_public);
            }
          })
          .catch((err) => {
            console.warn('[EditPlaylistModal] Failed to verify publicity:', err);
          })
          .finally(() => {
            setCheckingPublicity(false);
          });
      }
    }
  }, [isOpen, playlist.id, playlist.title, playlist.is_public, initialTracks]);

  // Handle ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    setTracks((prev) => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleMoveDown = (index: number) => {
    if (index >= tracks.length - 1) return;
    setTracks((prev) => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleRemoveTrack = (index: number) => {
    setTracks((prev) => prev.filter((_, i) => i !== index));
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    setTracks((prev) => {
      const updated = [...prev];
      const [draggedItem] = updated.splice(draggedIndex, 1);
      updated.splice(index, 0, draggedItem);
      return updated;
    });
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      showToast('Введите название плейлиста', 'warning');
      return;
    }

    setSaving(true);
    try {
      const itemsPayload = tracks.map((t) => ({
        item_id: String(t.id),
        type: 'track',
      }));

      await updatePlaylist(playlist.id, cleanName, isPublic, itemsPayload);
      showToast('Плейлист сохранён', 'success');
      onSaveSuccess(cleanName, tracks, isPublic);
      onClose();
    } catch (err: any) {
      console.error('[EditPlaylistModal] Failed to update playlist:', err);
      showToast(err?.message || 'Ошибка при сохранении плейлиста', 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="edit-pl-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="edit-pl-card" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="edit-pl-header">
          <div>
            <h2 className="edit-pl-title">Редактировать плейлист</h2>
            <div className="edit-pl-subtitle">
              Изменяйте название, видимость и порядок треков
            </div>
          </div>
          <button
            type="button"
            className="edit-pl-close-btn"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSave} className="edit-pl-form">
          {/* Metadata Inputs */}
          <div className="edit-pl-section">
            <label className="edit-pl-label">Название плейлиста</label>
            <input
              type="text"
              className="edit-pl-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Название плейлиста"
              required
              disabled={saving}
            />

            {/* Publicity / Visibility Section */}
            <div className="edit-pl-publicity-card">
              <div className="edit-pl-publicity-main">
                <div className="edit-pl-publicity-status">
                  <div className={`edit-pl-publicity-icon-badge ${isPublic ? 'edit-pl-publicity-icon-badge--public' : 'edit-pl-publicity-icon-badge--private'}`}>
                    {isPublic ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <div className="edit-pl-publicity-header">
                      <span className="edit-pl-publicity-title">
                        {isPublic ? 'Публичный плейлист' : 'Приватный плейлист'}
                      </span>
                      {checkingPublicity && (
                        <span className="edit-pl-checking-badge">Проверка...</span>
                      )}
                    </div>
                    <p className="edit-pl-publicity-desc">
                      {isPublic
                        ? 'Плейлист виден другим пользователям, доступен по ссылке и в поиске Звука'
                        : 'Плейлист виден только вам. Другие пользователи не смогут открыть его'}
                    </p>
                  </div>
                </div>

                <label className="edit-pl-switch" title={isPublic ? 'Сделать приватным' : 'Сделать публичным'}>
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    disabled={saving || checkingPublicity}
                  />
                  <span className="edit-pl-switch-slider" />
                </label>
              </div>
            </div>
          </div>

          {/* Tracks Reordering Section */}
          <div className="edit-pl-section edit-pl-section--tracks">
            <div className="edit-pl-tracks-header">
              <label className="edit-pl-label">Треки ({tracks.length})</label>
              <span className="edit-pl-hint">
                Перетаскивайте треки или используйте стрелочки для смены порядка
              </span>
            </div>

            <div className="edit-pl-tracks-list">
              {tracks.length === 0 ? (
                <div className="edit-pl-tracks-empty">
                  В плейлисте нет треков
                </div>
              ) : (
                tracks.map((track, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === tracks.length - 1;
                  const isBeingDragged = draggedIndex === idx;

                  return (
                    <div
                      key={`${track.id}-${idx}`}
                      className={`edit-pl-track-item ${isBeingDragged ? 'edit-pl-track-item--dragging' : ''}`}
                      draggable={!saving}
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragEnd={handleDragEnd}
                    >
                      {/* Drag Handle */}
                      <div className="edit-pl-track-drag-handle" title="Перетащить">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="9" cy="6" r="2" />
                          <circle cx="15" cy="6" r="2" />
                          <circle cx="9" cy="12" r="2" />
                          <circle cx="15" cy="12" r="2" />
                          <circle cx="9" cy="18" r="2" />
                          <circle cx="15" cy="18" r="2" />
                        </svg>
                      </div>

                      {/* Number */}
                      <span className="edit-pl-track-num">{idx + 1}</span>

                      {/* Cover thumb */}
                      {track.cover_url ? (
                        <img
                          src={track.cover_url}
                          alt={track.title}
                          className="edit-pl-track-thumb"
                        />
                      ) : (
                        <div className="edit-pl-track-thumb edit-pl-track-thumb--empty">♫</div>
                      )}

                      {/* Track info */}
                      <div className="edit-pl-track-info">
                        <div className="edit-pl-track-title" title={track.title}>
                          {track.title}
                        </div>
                        <div className="edit-pl-track-artist" title={track.artist}>
                          {track.artist}
                        </div>
                      </div>

                      {/* Reorder Buttons (Up & Down) */}
                      <div className="edit-pl-track-reorder-actions">
                        <button
                          type="button"
                          className="edit-pl-order-btn"
                          onClick={() => handleMoveUp(idx)}
                          disabled={isFirst || saving}
                          title="Переместить выше"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="18 15 12 9 6 15" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="edit-pl-order-btn"
                          onClick={() => handleMoveDown(idx)}
                          disabled={isLast || saving}
                          title="Переместить ниже"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                      </div>

                      {/* Remove track button */}
                      <button
                        type="button"
                        className="edit-pl-remove-btn"
                        onClick={() => handleRemoveTrack(idx)}
                        disabled={saving}
                        title="Удалить из плейлиста"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6V20a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="edit-pl-footer">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onClose}
              disabled={saving}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={saving || !name.trim()}
            >
              {saving ? 'Сохранение...' : 'Сохранить изменения'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
