import { useEffect, useState, useRef } from 'react';
import './SplashScreen.css';

interface SplashScreenProps {
  isLoading: boolean;
  minDuration?: number;
  onRevealing?: () => void;
  onFinish?: () => void;
}

type SplashPhase = 'breathing' | 'assembling' | 'revealing' | 'done';

export function SplashScreen({ isLoading, minDuration = 2200, onRevealing, onFinish }: SplashScreenProps) {
  const [phase, setPhase] = useState<SplashPhase>('breathing');
  const mountTimeRef = useRef<number>(Date.now());
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const completedRef = useRef<boolean>(false);
  const onRevealingRef = useRef(onRevealing);
  const onFinishRef = useRef(onFinish);

  onRevealingRef.current = onRevealing;
  onFinishRef.current = onFinish;

  useEffect(() => {
    // If still in initial loading, or transition already completed, do nothing
    if (isLoading || completedRef.current) return;

    // Clear any pending timers if state/props update
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    const elapsed = Date.now() - mountTimeRef.current;
    const remainingTime = Math.max(0, minDuration - elapsed);

    const t1 = setTimeout(() => {
      // Phase 1: Waves seamlessly dissolve in place, central logo emerges with emerald glow
      setPhase('assembling');

      const t2 = setTimeout(() => {
        // Phase 2: Logo sits clear and steady; begin smooth cross-dissolve with the app interface
        setPhase('revealing');
        onRevealingRef.current?.();

        const t3 = setTimeout(() => {
          // Phase 3: Transition fully complete, unmount splash cleanly
          completedRef.current = true;
          setPhase('done');
          onFinishRef.current?.();
        }, 800);

        timersRef.current.push(t3);
      }, 1000);

      timersRef.current.push(t2);
    }, remainingTime);

    timersRef.current.push(t1);

    return () => {
      if (!completedRef.current) {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
      }
    };
  }, [isLoading, minDuration]);

  if (phase === 'done') {
    return null;
  }

  return (
    <div className={`splash-screen splash-screen--${phase}`} aria-label="Экран загрузки Звук">
      {/* Background ambient lighting */}
      <div className="splash-screen__ambient" />

      {/* 
        Two Large Full Glass Quarter-Circle Sectors (One above another):
        Originating at bottom-left corner (0, 1000).
        Base larger sector underneath (R=560), and top sector stacked directly above it (R=340).
      */}
      <div className="splash-screen__waves-layer">
        <svg
          className="splash-screen__svg-fullscreen"
          viewBox="0 0 1000 1000"
          preserveAspectRatio="xMinYMax slice"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Deep Frosted Smoked Glass with Emerald Ambient Tint — Base Layer */}
            <linearGradient id="glassBaseGrad" x1="0%" y1="100%" x2="70%" y2="0%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.04" />
              <stop offset="30%" stopColor="#052e1c" stopOpacity="0.35" />
              <stop offset="65%" stopColor="#00D074" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#020617" stopOpacity="0.22" />
            </linearGradient>

            {/* Deep Frosted Smoked Glass with Emerald Ambient Tint — Top Layer */}
            <linearGradient id="glassTopGrad" x1="0%" y1="100%" x2="70%" y2="0%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.06" />
              <stop offset="30%" stopColor="#064e3b" stopOpacity="0.40" />
              <stop offset="70%" stopColor="#00D074" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#031f13" stopOpacity="0.28" />
            </linearGradient>

            {/* Soft Emerald-Mint Refractive Edge Rim Gradient */}
            <linearGradient id="glassSoftRim" x1="0%" y1="100%" x2="70%" y2="0%">
              <stop offset="0%" stopColor="#86efac" stopOpacity="0.32" />
              <stop offset="45%" stopColor="#00D074" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#4ade80" stopOpacity="0.28" />
            </linearGradient>
          </defs>

          {/* 
            LAYER 1 (BASE / UNDERNEATH):
            Full Quarter-Circle Sector, Radius = 560.
            Soft muted edges seamlessly blending into dark background.
          */}
          <g className="splash-glass-sector splash-glass-sector--base">
            <path
              d="M 0 1000 L 0 440 A 560 560 0 0 1 560 1000 Z"
              fill="url(#glassBaseGrad)"
              stroke="url(#glassSoftRim)"
              strokeWidth="0.8"
            />
          </g>

          {/* 
            LAYER 2 (TOP / STACKED ON TOP):
            Full Quarter-Circle Sector, Radius = 340.
            Soft muted edges with gentle depth.
          */}
          <g className="splash-glass-sector splash-glass-sector--top">
            <path
              d="M 0 1000 L 0 660 A 340 340 0 0 1 340 1000 Z"
              fill="url(#glassTopGrad)"
              stroke="url(#glassSoftRim)"
              strokeWidth="0.8"
            />
          </g>
        </svg>
      </div>

      {/* 
        Central Target Stage: Full Zvuk Logo (/zvuk-full.svg) in the center.
      */}
      <div className="splash-screen__center-logo-box">
        {/* Shockwave Flash when waves dissolve and logo emerges */}
        <div className="splash-screen__burst-flash" />

        {/* Full Zvuk Logo from public/zvuk-full.svg */}
        <div className="splash-screen__final-logo">
          <img src="/zvuk-full.svg" alt="Звук" />
        </div>
      </div>
    </div>
  );
}
