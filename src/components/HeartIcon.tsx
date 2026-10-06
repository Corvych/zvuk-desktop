import React from 'react';

export interface HeartIconProps extends React.SVGProps<SVGSVGElement> {
  filled?: boolean;
  size?: number;
}

export const HeartOutlinePath =
  'M10.776 6.868c2.106.011 4.165 1.104 5.418 2.801.2.27.775 1.058 1.81 1.058 1.033 0 1.608-.787 1.808-1.057 2.133-3.029 6.793-3.764 9.585-1.246 2.002 1.82 2.14 4.708 1.762 7.293-1.491 6.24-8.019 10.245-13.156 13.228-5.137-2.983-11.665-6.987-13.156-13.228-.86-4.363 1.04-8.795 5.929-8.849m0-3C4.05 3.888.683 9.988 1.879 16.154c1.611 7.423 8.993 12.298 15.182 15.68.29.16.603.308.942.298.34.01.652-.138.942-.298 6.168-3.375 13.553-8.215 15.172-15.615.517-3.435.118-7.24-2.41-9.763C28 2.74 21.378 3.187 18.002 7.153c-1.82-2.026-4.492-3.29-7.227-3.285';

export const HeartFilledPath =
  'M10.776 3.868C4.05 3.888.683 9.988 1.879 16.154c1.611 7.423 8.993 12.298 15.182 15.68.29.16.603.308.942.298.34.01.652-.138.942-.298 6.168-3.375 13.553-8.215 15.172-15.615.517-3.435.118-7.24-2.41-9.763C28 2.74 21.378 3.187 18.002 7.153c-1.82-2.026-4.492-3.29-7.227-3.285z';

export const HeartIcon: React.FC<HeartIconProps> = ({
  filled = false,
  size = 18,
  className = '',
  ...props
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d={filled ? HeartFilledPath : HeartOutlinePath} />
    </svg>
  );
};
