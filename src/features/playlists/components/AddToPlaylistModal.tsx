import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getUserShortPlaylists, addItemsToPlaylist, createPlaylist, type ShortPlaylist } from '../../../api';
import { usePlaylistModalStore } from '../playlistModalStore';
import { showToast } from '../../../components/Toast';

export const AddToPlaylistModal: React.FC = () => {
  const { isAddToPlaylistOpen, targetTrack, closeAddToPlaylist } = usePlaylistModalStore();

  const [playlists, setPlaylists] = useState<ShortPlaylist[]>([]);
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // New playlist creation inline state
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState<string>('');
  const [creatingLoading, setCreatingLoading] = useState<boolean>(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Load initial playlists when modal opens
  useEffect(() => {
    if (!isAddToPlaylistOpen) {
      setPlaylists([]);
      setEndCursor(null);
      setHasNextPage(false);
      setSearchQuery('');
      setAddingId(null);
      setAddedIds(new Set());
      setIsCreating(false);
      setNewPlaylistTitle('');
      return;
    }

    let isSubscribed = true;
    async function loadInitial() {
      setLoading(true);
      try {
        const res = await getUserShortPlaylists(15, '');
        if (isSubscribed) {
          setPlaylists(res.playlists || []);
          setEndCursor(res.page?.endCursor || null);
          setHasNextPage(Boolean(res.page?.hasNextPage));
        }
      } catch (err: any) {
        console.error('[AddToPlaylistModal] Failed to load playlists:', err);
        showToast('Не удалось загрузить плейлисты', 'error');
      } finally {
        if (isSubscribed) setLoading(false);
      }
    }

    loadInitial();
    return () => {
      isSubscribed = false;
    };
  }, [isAddToPlaylistOpen]);

  // Handle pagination
  const handleLoadMore = async () => {
    if (loadingMore || !hasNextPage || !endCursor) return;
    setLoadingMore(true);
    try {
      const res = await getUserShortPlaylists(15, endCursor);
      const newItems = res.playlists || [];
      setPlaylists((prev) => {
        const existing = new Set(prev.map((p) => p.id));
        const filtered = newItems.filter((p) => !existing.has(p.id));
        return [...prev, ...filtered];
      });
      setEndCursor(res.page?.endCursor || null);
      setHasNextPage(Boolean(res.page?.hasNextPage));
    } catch (err: any) {
      console.error('[AddToPlaylistModal] Failed to load more playlists:', err);
      showToast('Не удалось загрузить больше плейлистов', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isAddToPlaylistOpen) {
        closeAddToPlaylist();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddToPlaylistOpen, closeAddToPlaylist]);

  if (!isAddToPlaylistOpen || !targetTrack) return null;

  const handleAddToPlaylist = async (playlist: ShortPlaylist) => {
    if (addingId || addedIds.has(playlist.id)) return;
    setAddingId(playlist.id);
    try {
      await addItemsToPlaylist(playlist.id, [targetTrack.id]);
      setAddedIds((prev) => new Set(prev).add(playlist.id));
      showToast(`Трек добавлен в «${playlist.title}»`, 'success');
      setTimeout(() => {
        closeAddToPlaylist();
      }, 700);
    } catch (err: any) {
      console.error('[AddToPlaylistModal] Failed to add track to playlist:', err);
      showToast(err?.message || 'Ошибка при добавлении в плейлист', 'error');
    } finally {
      setAddingId(null);
    }
  };

  const handleCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newPlaylistTitle.trim();
    if (!title || creatingLoading) return;

    setCreatingLoading(true);
    try {
      const created = await createPlaylist(title);
      if (created?.id) {
        await addItemsToPlaylist(created.id, [targetTrack.id]);
        showToast(`Создан плейлист «${title}», трек добавлен!`, 'success');
        closeAddToPlaylist();
      }
    } catch (err: any) {
      console.error('[AddToPlaylistModal] Failed to create playlist:', err);
      showToast(err?.message || 'Не удалось создать плейлист', 'error');
    } finally {
      setCreatingLoading(false);
    }
  };

  const filteredPlaylists = playlists.filter((p) =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  return createPortal(
    <div
      className="add-to-pl-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeAddToPlaylist();
      }}
    >
      <div className="add-to-pl-card" ref={modalRef} role="dialog" aria-modal="true">
        {/* Header */}
        <div className="add-to-pl-header">
          <div className="add-to-pl-header__info">
            <h2 className="add-to-pl-title">Добавить в плейлист</h2>
            <div className="add-to-pl-track-preview">
              {targetTrack.cover_url ? (
                <img
                  src={targetTrack.cover_url}
                  alt={targetTrack.title}
                  className="add-to-pl-track-thumb"
                />
              ) : (
                <div className="add-to-pl-track-thumb add-to-pl-track-thumb--empty">♫</div>
              )}
              <div className="add-to-pl-track-meta">
                <div className="add-to-pl-track-name" title={targetTrack.title}>
                  {targetTrack.title}
                </div>
                {targetTrack.artist && (
                  <div className="add-to-pl-track-artist" title={targetTrack.artist}>
                    {targetTrack.artist}
                  </div>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="add-to-pl-close-btn"
            onClick={closeAddToPlaylist}
            aria-label="Закрыть"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search & New playlist trigger */}
        <div className="add-to-pl-controls">
          <div className="add-to-pl-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Поиск по плейлистам..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                className="add-to-pl-search-clear"
                onClick={() => setSearchQuery('')}
              >
                ✕
              </button>
            )}
          </div>

          {!isCreating ? (
            <button
              type="button"
              className="add-to-pl-new-btn"
              onClick={() => setIsCreating(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Новый плейлист
            </button>
          ) : (
            <form className="add-to-pl-create-form" onSubmit={handleCreateAndAdd}>
              <input
                type="text"
                placeholder="Название нового плейлиста"
                value={newPlaylistTitle}
                onChange={(e) => setNewPlaylistTitle(e.target.value)}
                autoFocus
              />
              <div className="add-to-pl-create-form__actions">
                <button
                  type="submit"
                  className="btn btn--primary add-to-pl-btn--compact"
                  disabled={!newPlaylistTitle.trim() || creatingLoading}
                >
                  {creatingLoading ? 'Создание...' : 'Создать'}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary add-to-pl-btn--compact"
                  onClick={() => {
                    setIsCreating(false);
                    setNewPlaylistTitle('');
                  }}
                >
                  Отмена
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Playlists list */}
        <div className="add-to-pl-list" ref={listContainerRef}>
          {loading ? (
            <div className="add-to-pl-loading">
              <div className="add-to-pl-spinner" />
              <span>Загрузка плейлистов...</span>
            </div>
          ) : filteredPlaylists.length === 0 ? (
            <div className="add-to-pl-empty">
              {searchQuery ? 'Ничего не найдено' : 'У вас пока нет созданных плейлистов'}
            </div>
          ) : (
            <>
              {filteredPlaylists.map((pl) => {
                const isAdding = addingId === pl.id;
                const isAdded = addedIds.has(pl.id);

                return (
                  <button
                    key={pl.id}
                    type="button"
                    className={`add-to-pl-item ${isAdded ? 'add-to-pl-item--added' : ''}`}
                    onClick={() => handleAddToPlaylist(pl)}
                    disabled={isAdding || isAdded}
                  >
                    <div className="add-to-pl-item__icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="8" y1="6" x2="21" y2="6" />
                        <line x1="8" y1="12" x2="21" y2="12" />
                        <line x1="8" y1="18" x2="21" y2="18" />
                        <line x1="3" y1="6" x2="3.01" y2="6" />
                        <line x1="3" y1="12" x2="3.01" y2="12" />
                        <line x1="3" y1="18" x2="3.01" y2="18" />
                      </svg>
                    </div>

                    <span className="add-to-pl-item__title">{pl.title}</span>

                    <div className="add-to-pl-item__status">
                      {isAdding ? (
                        <div className="add-to-pl-item-spinner" />
                      ) : isAdded ? (
                        <svg className="add-to-pl-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg className="add-to-pl-plus" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}

              {/* Pagination button */}
              {hasNextPage && !searchQuery && (
                <div className="add-to-pl-more-wrap">
                  <button
                    type="button"
                    className="add-to-pl-more-btn"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <>
                        <div className="add-to-pl-item-spinner" />
                        Загрузка...
                      </>
                    ) : (
                      'Загрузить ещё'
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
