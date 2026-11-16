import React from 'react';

export function getSpeakerIconPath(device?: { model?: string | null; name?: string | null } | null): string {
  if (!device) return '/sber-speakers/sberboom.svg';

  const modelLower = (device.model || '').toLowerCase();
  const nameLower = (device.name || '').toLowerCase();
  const combined = `${modelLower} ${nameLower}`;

  if (combined.includes('home') || combined.includes('хоум')) {
    return '/sber-speakers/sberboom-home.svg';
  }
  if (combined.includes('micro') || combined.includes('микро')) {
    return '/sber-speakers/sberboom-micro.svg';
  }
  if (combined.includes('mini') || combined.includes('мини')) {
    return '/sber-speakers/sberboom-mini.svg';
  }
  if (
    combined.includes('boom 2') ||
    combined.includes('boom-2') ||
    combined.includes('boom_2') ||
    combined.includes('boom2') ||
    combined.includes('бум 2')
  ) {
    return '/sber-speakers/sberboom-2.svg';
  }

  return '/sber-speakers/sberboom.svg';
}

interface SberSpeakerIconProps {
  device?: { model?: string | null; name?: string | null } | null;
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const SberSpeakerIcon: React.FC<SberSpeakerIconProps> = ({
  device,
  size = 24,
  color,
  className,
  style,
}) => {
  const iconPath = getSpeakerIconPath(device);

  return (
    <span
      className={className}
      role="img"
      aria-label={device?.name || 'Sber Speaker'}
      style={{
        display: 'inline-block',
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: color || 'currentColor',
        WebkitMaskImage: `url("${iconPath}")`,
        maskImage: `url("${iconPath}")`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        flexShrink: 0,
        ...style,
      }}
    />
  );
};
