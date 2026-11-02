import React, { useState, useEffect, useRef } from 'react';
import { DislikeIcon } from './DislikeIcon';

export interface DislikeButtonProps {
  isDisliked: boolean;
  onToggle: (e: React.MouseEvent<HTMLButtonElement>) => void;
  size?: number;
  className?: string;
  title?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export const DislikeButton: React.FC<DislikeButtonProps> = ({
  isDisliked,
  onToggle,
  size = 18,
  className = '',
  title,
  disabled = false,
  style,
}) => {
  const [animating, setAnimating] = useState(false);
  const prevDislikedRef = useRef(isDisliked);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!prevDislikedRef.current && isDisliked) {
      setAnimating(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setAnimating(false);
      }, 700);
    } else if (!isDisliked) {
      setAnimating(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
    prevDislikedRef.current = isDisliked;
  }, [isDisliked]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (disabled) return;

    if (!isDisliked) {
      setAnimating(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setAnimating(false);
      }, 700);
    }

    onToggle(e);
  };

  return (
    <button
      type="button"
      className={`dislike-btn ${isDisliked ? 'dislike-btn--active' : ''} ${animating ? 'dislike-btn--animating' : ''} ${className}`}
      onClick={handleClick}
      title={
        title ||
        (isDisliked
          ? 'Снять отметку «Не нравится» (D)'
          : 'Не нравится / Скрыть (D)')
      }
      disabled={disabled}
      style={style}
    >
      <span className="dislike-btn__halo" aria-hidden="true" />
      <DislikeIcon
        className="dislike-btn__icon"
        active={isDisliked}
        size={size}
      />
    </button>
  );
};

