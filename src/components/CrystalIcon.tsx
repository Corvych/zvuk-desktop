import React from 'react';

interface CrystalIconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function CrystalIcon({ size = 12, className = '', style }: CrystalIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M4.5 1h7l3.5 4.5L8 15 .999 5.5 4.5 1zm.6 1.2L2.3 5h3.3l1.2-2.8H5.1zm2 0L6 5h4l-1.1-2.8H7.1zm2.9 0l1.2 2.8h3.3L12 2.2h-2zM2 6l5.3 7.4L3.6 6H2zm2.8 0l3.2 7 3.2-7H4.8zm7.6 0l-3.7 7.4L14 6h-1.6z" />
    </svg>
  );
}

