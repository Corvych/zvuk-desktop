import React from 'react';

interface CrystalIconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function CrystalIcon({ size = 12, className = '', style }: CrystalIconProps) {
  const width = Math.round(size * (100 / 160) * 100) / 100;

  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 100 160"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <polygon
        points="50,14 88,52 88,108 50,146 12,108 12,52"
        fill="none"
        stroke="currentColor"
        strokeWidth={12}
        strokeLinejoin="round"
      />
    </svg>
  );
}

