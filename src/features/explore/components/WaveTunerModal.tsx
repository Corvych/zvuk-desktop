import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface WaveTunerState {
  pad: { x: number; y: number }; // -1 to 1 (x: -1 грустное / 1 весёлое, y: 1 энергичное / -1 спокойное)
  discovery: 'favorite' | 'unfamiliar' | null;
  popularity: 'popular' | 'rare' | null;
  language: 'russian' | 'foreign' | 'instrumental' | null;
}

interface WaveTunerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply?: (state: WaveTunerState) => void;
  initialState?: WaveTunerState | null;
}

const MIN_DOT_PERCENT = 18;
const MAX_DOT_PERCENT = 82;

export function WaveTunerModal({ isOpen, onClose, onApply, initialState }: WaveTunerModalProps) {
  // Pad coordinates in normalized -1..1 range (0,0 is center)
  const [pad, setPad] = useState<{ x: number; y: number }>(initialState?.pad ?? { x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Filter pills state
  const [discovery, setDiscovery] = useState<'favorite' | 'unfamiliar' | null>(initialState?.discovery ?? null);
  const [popularity, setPopularity] = useState<'popular' | 'rare' | null>(initialState?.popularity ?? null);
  const [language, setLanguage] = useState<'russian' | 'foreign' | 'instrumental' | null>(initialState?.language ?? null);

  // Synchronize when opening with an existing saved state
  useEffect(() => {
    if (isOpen) {
      if (initialState) {
        setPad(initialState.pad ?? { x: 0, y: 0 });
        setDiscovery(initialState.discovery ?? null);
        setPopularity(initialState.popularity ?? null);
        setLanguage(initialState.language ?? null);
      } else {
        setPad({ x: 0, y: 0 });
        setDiscovery(null);
        setPopularity(null);
        setLanguage(null);
      }
    }
  }, [isOpen, initialState]);

  const padRef = useRef<HTMLDivElement>(null);
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
  }, [isClosing]);

  const handleAnimationEnd = (e: React.AnimationEvent) => {
    if (isClosing && e.animationName === 'waveModalSlideOutRight') {
      setIsClosing(false);
      onClose();
    }
  };

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Handle pointer coordinate calculation clamped strictly to the dots grid boundary
  const updateCoordFromPointer = useCallback((clientX: number, clientY: number) => {
    if (!padRef.current) return;
    const rect = padRef.current.getBoundingClientRect();

    // Bounds corresponding to the 7x7 dots grid (18% to 82%)
    const minX = rect.left + (rect.width * MIN_DOT_PERCENT) / 100;
    const maxX = rect.left + (rect.width * MAX_DOT_PERCENT) / 100;
    const minY = rect.top + (rect.height * MIN_DOT_PERCENT) / 100;
    const maxY = rect.top + (rect.height * MAX_DOT_PERCENT) / 100;

    const clampedX = Math.max(minX, Math.min(maxX, clientX));
    const clampedY = Math.max(minY, Math.min(maxY, clientY));

    // Convert to -1..1 coordinates
    const normX = ((clampedX - minX) / (maxX - minX)) * 2 - 1;
    const normY = 1 - ((clampedY - minY) / (maxY - minY)) * 2; // inverted: top is +1, bottom is -1

    setPad({
      x: parseFloat(normX.toFixed(3)),
      y: parseFloat(normY.toFixed(3)),
    });
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateCoordFromPointer(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    updateCoordFromPointer(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if pointer capture was already lost
    }
    if (onApply) {
      onApply({ pad, discovery, popularity, language });
    }
  };

  const handleReset = () => {
    setPad({ x: 0, y: 0 });
    setDiscovery(null);
    setPopularity(null);
    setLanguage(null);
    if (onApply) {
      onApply({
        pad: { x: 0, y: 0 },
        discovery: null,
        popularity: null,
        language: null,
      });
    }
  };

  if (!isOpen) return null;

  // Convert -1..1 to percentage for puck display within the dots boundary (18% .. 82%)
  const puckXPercent = MIN_DOT_PERCENT + ((pad.x + 1) / 2) * (MAX_DOT_PERCENT - MIN_DOT_PERCENT);
  const puckYPercent = MIN_DOT_PERCENT + ((1 - pad.y) / 2) * (MAX_DOT_PERCENT - MIN_DOT_PERCENT);

  // Bilinear interpolation of official emotion corner colors:
  // Top-Left: ЭНЕРГИЧНОЕ (#ec8c4a: 236, 140, 74)
  // Top-Right: ВЕСЁЛОЕ (#70dc55: 112, 220, 85)
  // Bottom-Left: ГРУСТНОЕ (#98aff4: 152, 175, 244)
  // Bottom-Right: СПОКОЙНОЕ (#69aaf5: 105, 170, 245)
  const u = Math.max(0, Math.min(1, (pad.x + 1) / 2));
  const v = Math.max(0, Math.min(1, (pad.y + 1) / 2));

  const wTL = (1 - u) * v;
  const wTR = u * v;
  const wBL = (1 - u) * (1 - v);
  const wBR = u * (1 - v);

  const activeR = Math.round(wTL * 236 + wTR * 112 + wBL * 152 + wBR * 105);
  const activeG = Math.round(wTL * 140 + wTR * 220 + wBL * 175 + wBR * 170);
  const activeB = Math.round(wTL * 74  + wTR * 85  + wBL * 244 + wBR * 245);
  const activeRgb = `${activeR}, ${activeG}, ${activeB}`;

  // 7x7 Grid of dots coordinates (spaced between 18% and 82%)
  const gridSteps = [18, 28.7, 39.3, 50, 60.7, 71.3, 82];

  return createPortal(
    <div
      className={`wave-modal-backdrop ${isClosing ? 'wave-modal-backdrop--closing' : ''}`}
      style={{ '--wave-active-rgb': activeRgb } as React.CSSProperties}
      onClick={handleClose}
    >
      <div
        className={`wave-modal-card ${isClosing ? 'wave-modal-card--closing' : ''}`}
        style={{ '--wave-active-rgb': activeRgb } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={handleAnimationEnd}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wave-modal-title"
      >
        {/* Header */}
        <div className="wave-modal__header">
          <h2 id="wave-modal-title" className="wave-modal__title">
            Настроить волну
          </h2>
          <button
            type="button"
            className="wave-modal__close-btn"
            onClick={handleClose}
            aria-label="Закрыть"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6L6 18M6 6L18 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* 2D Mood / Energy XY Pad */}
        <div
          ref={padRef}
          className="wave-pad"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Corner Labels */}
          <div className="wave-pad__corner wave-pad__corner--tl">ЭНЕРГИЧНОЕ</div>
          <div className="wave-pad__corner wave-pad__corner--tr">ВЕСЁЛОЕ</div>
          <div className="wave-pad__corner wave-pad__corner--bl">ГРУСТНОЕ</div>
          <div className="wave-pad__corner wave-pad__corner--br">СПОКОЙНОЕ</div>

          {/* 7x7 Dot Matrix */}
          <div className="wave-pad__dots">
            {gridSteps.map((yVal, rIdx) =>
              gridSteps.map((xVal, cIdx) => (
                <span
                  key={`${rIdx}-${cIdx}`}
                  className="wave-pad__dot"
                  style={{ left: `${xVal}%`, top: `${yVal}%` }}
                />
              ))
            )}
          </div>

          {/* Draggable Puck */}
          <div
            className={`wave-pad__puck ${isDragging ? 'wave-pad__puck--dragging' : ''}`}
            style={{
              left: `${puckXPercent}%`,
              top: `${puckYPercent}%`,
            }}
          >
            <div className="wave-pad__puck-ring" />
            <div className="wave-pad__puck-body">
              <div className="wave-pad__puck-dot" />
            </div>
          </div>
        </div>

        {/* Filter Pills Grid */}
        <div className="wave-modal__filters">
          {/* Row 1: Discovery */}
          <div className="wave-modal__row wave-modal__row--2">
            <button
              type="button"
              className={`wave-pill ${discovery === 'favorite' ? 'wave-pill--active' : ''}`}
              onClick={() => {
                const next = discovery === 'favorite' ? null : 'favorite';
                setDiscovery(next);
                if (onApply) onApply({ pad, discovery: next, popularity, language });
              }}
            >
              <span className="wave-pill__emoji">💖</span>
              <span className="wave-pill__label">Любимое</span>
            </button>

            <button
              type="button"
              className={`wave-pill ${discovery === 'unfamiliar' ? 'wave-pill--active' : ''}`}
              onClick={() => {
                const next = discovery === 'unfamiliar' ? null : 'unfamiliar';
                setDiscovery(next);
                if (onApply) onApply({ pad, discovery: next, popularity, language });
              }}
            >
              <span className="wave-pill__emoji">🌚</span>
              <span className="wave-pill__label">Незнакомое</span>
            </button>
          </div>

          {/* Row 2: Popularity */}
          <div className="wave-modal__row wave-modal__row--2">
            <button
              type="button"
              className={`wave-pill ${popularity === 'popular' ? 'wave-pill--active' : ''}`}
              onClick={() => {
                const next = popularity === 'popular' ? null : 'popular';
                setPopularity(next);
                if (onApply) onApply({ pad, discovery, popularity: next, language });
              }}
            >
              <span className="wave-pill__emoji">🤩</span>
              <span className="wave-pill__label">Популярное</span>
            </button>

            <button
              type="button"
              className={`wave-pill ${popularity === 'rare' ? 'wave-pill--active' : ''}`}
              onClick={() => {
                const next = popularity === 'rare' ? null : 'rare';
                setPopularity(next);
                if (onApply) onApply({ pad, discovery, popularity: next, language });
              }}
            >
              <span className="wave-pill__emoji">🍀</span>
              <span className="wave-pill__label">Редкое</span>
            </button>
          </div>

          {/* Row 3: Language / Words */}
          <div className="wave-modal__row wave-modal__row--3">
            <button
              type="button"
              className={`wave-pill ${language === 'russian' ? 'wave-pill--active' : ''}`}
              onClick={() => {
                const next = language === 'russian' ? null : 'russian';
                setLanguage(next);
                if (onApply) onApply({ pad, discovery, popularity, language: next });
              }}
            >
              <span className="wave-pill__label">Русское</span>
            </button>

            <button
              type="button"
              className={`wave-pill ${language === 'foreign' ? 'wave-pill--active' : ''}`}
              onClick={() => {
                const next = language === 'foreign' ? null : 'foreign';
                setLanguage(next);
                if (onApply) onApply({ pad, discovery, popularity, language: next });
              }}
            >
              <span className="wave-pill__label">Иностранное</span>
            </button>

            <button
              type="button"
              className={`wave-pill ${language === 'instrumental' ? 'wave-pill--active' : ''}`}
              onClick={() => {
                const next = language === 'instrumental' ? null : 'instrumental';
                setLanguage(next);
                if (onApply) onApply({ pad, discovery, popularity, language: next });
              }}
            >
              <span className="wave-pill__label">Без слов</span>
            </button>
          </div>
        </div>

        {/* Reset Button */}
        <div className="wave-modal__footer">
          <button type="button" className="wave-modal__reset-btn" onClick={handleReset}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 4V9H9"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M20 20V15H15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M20.49 9A9 9 0 0 0 5.64 5.64L4 9M3.51 15A9 9 0 0 0 18.36 18.36L20 15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Сбросить</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
