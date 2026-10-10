import { useRef, useEffect } from 'react';
import { usePlayerStore } from './playerStore';

/**
 * Heuristic to distinguish whether a WheelEvent comes from a discrete physical
 * mouse wheel or from a continuous precision touchpad / trackpad.
 */
function isPhysicalMouseWheel(e: WheelEvent): boolean {
  // Line (1) or page (2) deltaMode is always a physical mouse wheel
  if (e.deltaMode !== 0) return true;

  const absX = Math.abs(e.deltaX);
  const absY = Math.abs(e.deltaY);

  // If deltas are non-integer, it is definitely a high-precision trackpad
  if (!Number.isInteger(absX) || !Number.isInteger(absY)) return false;

  // Standard Windows / Chromium mouse wheel clicks produce multiples of 100 or 120
  if ((absY >= 100 && absY % 100 === 0) || (absY >= 120 && absY % 120 === 0)) return true;
  if ((absX >= 100 && absX % 100 === 0) || (absX >= 120 && absX % 120 === 0)) return true;

  // Single-axis discrete step of >= 50px with other axis 0 is a physical mouse wheel
  if ((absY >= 50 && absX === 0) || (absX >= 50 && absY === 0)) return true;

  // Otherwise, small deltas or simultaneous X/Y movement indicate a trackpad
  return false;
}

/**
 * Hook to manage volume control via mouse wheel and trackpad gestures.
 * Supports:
 * - Physical mouse: vertical wheel up/down (±5% per notch), horizontal tilt wheel left/right.
 * - Touchpad: horizontal 2-finger swipe along the slider, and vertical 2-finger swipe,
 *   with smooth continuous scaling (no jarring jumps).
 */
export function useVolumeWheel(isActive = true) {
  const containerRef = useRef<HTMLDivElement>(null);
  const accumulatedDeltaRef = useRef<number>(0);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) return;
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const isMouse = isPhysicalMouseWheel(e);

      // Reset trackpad accumulator when gesture pauses
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        accumulatedDeltaRef.current = 0;
      }, 300);

      const isHorizontal = absX > absY;
      const { volume, setVolume } = usePlayerStore.getState();

      if (isMouse) {
        // Discrete mouse wheel: fixed 5% step per notch
        accumulatedDeltaRef.current = 0;
        const step = 0.05;
        const delta = isHorizontal
          ? (e.deltaX < 0 ? step : -step)
          : (e.deltaY < 0 ? step : -step);

        const nextVol = Math.round(Math.min(1, Math.max(0, volume + delta)) * 100) / 100;
        setVolume(nextVol);
      } else {
        // Continuous precision touchpad (natural scrolling direction):
        // Horizontal: swipe right -> louder, swipe left -> quieter
        // Vertical: swipe up -> louder, swipe down -> quieter
        const rawDelta = isHorizontal ? -e.deltaX : e.deltaY;
        // ~280px of total trackpad movement spans 0% to 100% volume
        const sensitivity = 0.0035;
        accumulatedDeltaRef.current += rawDelta * sensitivity;

        // Apply changes in 1% (0.01) increments for smooth, responsive feedback
        if (Math.abs(accumulatedDeltaRef.current) >= 0.01) {
          const change = Math.trunc(accumulatedDeltaRef.current / 0.01) * 0.01;
          accumulatedDeltaRef.current -= change;
          const nextVol = Math.round(Math.min(1, Math.max(0, volume + change)) * 100) / 100;
          setVolume(nextVol);
        }
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, [isActive]);

  return containerRef;
}
