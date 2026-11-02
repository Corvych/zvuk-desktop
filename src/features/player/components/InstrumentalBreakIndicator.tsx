import React, { useState, useEffect, useMemo, useRef } from 'react';

export interface InstrumentalBreakIndicatorProps {
  time: number;
  endTime: number;
  currentTime: number;
  isActive: boolean;
  size?: 'medium' | 'large';
  onClick?: () => void;
}

export const InstrumentalBreakIndicator: React.FC<InstrumentalBreakIndicatorProps> = ({
  time,
  endTime,
  currentTime,
  isActive,
  size = 'large',
  onClick,
}) => {
  const totalDuration = Math.max(0.1, endTime - time);
  const remainingTime = Math.max(0, endTime - currentTime);
  const isPast = currentTime >= endTime;
  const isFuture = currentTime < time;

  // Countdown phase during final 3 seconds before singing starts
  const isCountdown = isActive && remainingTime <= 3.05 && remainingTime > 0;

  const countdownNumber = useMemo(() => {
    if (!isCountdown) return null;
    if (remainingTime > 2.0) return 3;
    if (remainingTime > 1.0) return 2;
    return 1;
  }, [isCountdown, remainingTime]);

  // Track entering digit and exiting digit for lateral sliding animation
  const [activeDigit, setActiveDigit] = useState<number | null>(countdownNumber);
  const [exitingDigit, setExitingDigit] = useState<number | null>(null);

  // Track dots animation state: 'normal' | 'exit' | 'enter' (for returning dots when rewinding)
  const wasExitedRef = useRef(false);
  const [dotsState, setDotsState] = useState<'normal' | 'exit' | 'enter'>('normal');

  useEffect(() => {
    if (isCountdown || isPast) {
      setDotsState('exit');
      wasExitedRef.current = true;
    } else if (wasExitedRef.current && !isCountdown && !isPast) {
      // Rewound back into the break after countdown or after the break ended:
      // smoothly return dots from the left!
      setDotsState('enter');
      wasExitedRef.current = false;
      const timer = setTimeout(() => {
        setDotsState('normal');
      }, 350);
      return () => clearTimeout(timer);
    } else if (!isCountdown && !isPast) {
      setDotsState('normal');
      wasExitedRef.current = false;
    }
  }, [isCountdown, isPast]);

  // Handle countdown digit transitions (3 -> 2 -> 1)
  useEffect(() => {
    if (countdownNumber !== activeDigit) {
      if (activeDigit !== null) {
        setExitingDigit(activeDigit);
        const timer = setTimeout(() => {
          setExitingDigit(null);
        }, 280);
        setActiveDigit(countdownNumber);
        return () => clearTimeout(timer);
      } else {
        setActiveDigit(countdownNumber);
      }
    }
  }, [countdownNumber, activeDigit]);

  // When rewinding back before countdown, reset any lingering digit animations
  useEffect(() => {
    if (!isCountdown && !isPast) {
      setActiveDigit(null);
      setExitingDigit(null);
    }
  }, [isCountdown, isPast]);

  // Phase 1: Progressive saturation of pure white inside the static large dots
  const fillDuration = Math.max(0.6, totalDuration - 3.0);
  const elapsed = Math.min(fillDuration, Math.max(0, currentTime - time));
  const fillProgress = isCountdown || isPast
    ? 1.0
    : isFuture
      ? 0.0
      : Math.min(1.0, elapsed / fillDuration);

  // If past and all exit animations finished, unmount to let line collapse completely
  if (isPast && exitingDigit === null && activeDigit === null) {
    return null;
  }

  const showCountdown = isCountdown || exitingDigit !== null;

  return (
    <div
      className={`apple-instrumental-row apple-instrumental-row--${size} ${
        isActive ? 'apple-instrumental-row--active' : ''
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      title="Инструментальная перебивка"
    >
      <div className="apple-instrumental-content">
        {/* 3 Statically Large Dots (slide out to left on countdown, return on rewind) */}
        {!isPast && (
          <div
            className={`apple-instrumental-dots ${
              dotsState === 'exit'
                ? 'apple-instrumental-dots--exit-left'
                : dotsState === 'enter'
                  ? 'apple-instrumental-dots--enter-left'
                  : ''
            }`}
            aria-hidden="true"
          >
            {[0, 1, 2].map((index) => {
              const segStart = index / 3;
              const segEnd = (index + 1) / 3;
              const dotProgress = Math.min(
                1.0,
                Math.max(0, (fillProgress - segStart) / (segEnd - segStart))
              );

              // Clearly visible base white opacity (0.45) saturating smoothly to 1.0 with bloom
              const whiteOpacity = isFuture ? 0.35 : 0.45 + 0.55 * dotProgress;
              const glowPx = Math.round(14 * dotProgress);

              return (
                <span
                  key={index}
                  className="apple-instrumental-dot"
                  style={
                    {
                      opacity: whiteOpacity.toFixed(2),
                      '--glow': glowPx,
                      '--glow-alpha': glowPx > 0 ? (0.4 + 0.5 * dotProgress).toFixed(2) : 0,
                    } as React.CSSProperties
                  }
                />
              );
            })}
          </div>
        )}

        {/* Countdown Digits: strictly aligned to the left edge */}
        {showCountdown && (
          <div className="apple-countdown-container" aria-live="polite">
            {exitingDigit !== null && (
              <span
                key={`exit-${exitingDigit}`}
                className="apple-countdown-digit apple-countdown-digit--exit"
              >
                {exitingDigit}
              </span>
            )}
            {activeDigit !== null && (
              <span
                key={`enter-${activeDigit}`}
                className="apple-countdown-digit apple-countdown-digit--enter"
              >
                {activeDigit}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
