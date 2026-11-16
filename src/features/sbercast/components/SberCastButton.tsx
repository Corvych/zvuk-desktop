import React, { useRef, useEffect, useState } from 'react';
import { useSberCastStore } from '../sbercastStore';
import { SberCastMenu } from './SberCastMenu';

interface SberCastButtonProps {
  className?: string;
  iconSize?: number;
  menuPlacement?: 'top' | 'bottom';
}

export const SberCastButton: React.FC<SberCastButtonProps> = ({
  className = 'player-bar__btn',
  iconSize = 18,
  menuPlacement = 'top',
}) => {
  const { isConnected, activeDevice } = useSberCastStore();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        className={`${className} ${isConnected ? `${className}--active` : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        title={
          isConnected && activeDevice
            ? `Трансляция SberCast: ${activeDevice.name}`
            : 'Подключение к устройству (SberCast)'
        }
        style={{
          position: 'relative',
          color: isConnected ? '#21c063' : undefined,
        }}
      >
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6M2 20h.01" />
        </svg>
        {isConnected && (
          <span
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#21c063',
              boxShadow: '0 0 6px #21c063',
            }}
          />
        )}
      </button>

      {isOpen && <SberCastMenu onClose={() => setIsOpen(false)} placement={menuPlacement} />}
    </div>
  );
};
