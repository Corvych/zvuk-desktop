import React from 'react';

export interface DislikeIconProps extends React.SVGProps<SVGSVGElement> {
  active?: boolean;
  size?: number;
}

export const DislikeIcon: React.FC<DislikeIconProps> = ({
  active = false,
  size = 18,
  className = '',
  ...props
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.3 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.22 : 0}
      />
      <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
    </svg>
  );
};

