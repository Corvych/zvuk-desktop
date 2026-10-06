import React, { useState, useEffect, useRef } from 'react';
import { HeartIcon } from './HeartIcon';

export interface LikeButtonProps {
  isLiked: boolean;
  onToggle: (e: React.MouseEvent<HTMLButtonElement>) => void;
  size?: number;
  className?: string;
  title?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export const LikeButton: React.FC<LikeButtonProps> = ({
  isLiked,
  onToggle,
  size = 18,
  className = '',
  title,
  disabled = false,
  style,
}) => {
  const [animating, setAnimating] = useState(false);
  const prevLikedRef = useRef(isLiked);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // Trigger the 1-second halo burst whenever like transitions from false -> true
    if (!prevLikedRef.current && isLiked) {
      setAnimating(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setAnimating(false);
      }, 1000);
    } else if (!isLiked) {
      setAnimating(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
    prevLikedRef.current = isLiked;
  }, [isLiked]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (disabled) return;

    // Immediate tactile feedback if currently unliked and about to be liked
    if (!isLiked) {
      setAnimating(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setAnimating(false);
      }, 1000);
    }

    onToggle(e);
  };

  return (
    <button
      type="button"
      className={`like-btn ${isLiked ? 'like-btn--active' : ''} ${animating ? 'like-btn--animating' : ''} ${className}`}
      onClick={handleClick}
      title={title || (isLiked ? 'Удалить из любимых' : 'Добавить в любимое')}
      disabled={disabled}
      style={style}
    >
      <span className="like-btn__halo" aria-hidden="true" />
      <HeartIcon
        className="like-btn__icon"
        filled={isLiked}
        size={size}
      />
    </button>
  );
};
