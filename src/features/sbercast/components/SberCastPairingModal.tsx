import React, { useEffect } from 'react';
import { useSberCastStore } from '../sbercastStore';

export type SpeakerPanelModel = 'sberboom' | 'sberboom-2' | 'sberboom-home' | 'sberboom-mini';

interface SpeakerModelConfig {
  id: SpeakerPanelModel;
  name: string;
  viewBox: string;
}

const SPEAKER_CONFIGS: Record<SpeakerPanelModel, SpeakerModelConfig> = {
  sberboom: {
    id: 'sberboom',
    name: 'SberBoom',
    viewBox: '55 30 210 100',
  },
  'sberboom-2': {
    id: 'sberboom-2',
    name: 'SberBoom 2',
    viewBox: '55 30 210 115',
  },
  'sberboom-home': {
    id: 'sberboom-home',
    name: 'SberBoom Home',
    viewBox: '16 48 288 152',
  },
  'sberboom-mini': {
    id: 'sberboom-mini',
    name: 'SberBoom Mini / Micro',
    viewBox: '16 50 288 150',
  },
};

function detectSpeakerModel(device?: { model?: string | null; name?: string | null } | null): SpeakerPanelModel {
  if (!device) return 'sberboom';
  const combined = `${device.model || ''} ${device.name || ''}`.toLowerCase();

  if (combined.includes('home') || combined.includes('хоум')) {
    return 'sberboom-home';
  }
  if (
    combined.includes('mini') ||
    combined.includes('мини') ||
    combined.includes('micro') ||
    combined.includes('микро')
  ) {
    return 'sberboom-mini';
  }
  if (
    combined.includes('boom 2') ||
    combined.includes('boom-2') ||
    combined.includes('boom_2') ||
    combined.includes('boom2') ||
    combined.includes('бум 2')
  ) {
    return 'sberboom-2';
  }
  return 'sberboom';
}

/* ═══════════════════════════════════════════════════════════════════════════
   Speaker Vector Panels (ViewBox: 0 0 320 320)
   ═══════════════════════════════════════════════════════════════════════════ */

const SberBoomPaths: React.FC = () => (
  <>
    {/* Body shell */}
    <g stroke="rgba(255, 255, 255, 0.35)" strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M 160 34 C 78 34 32 68 32 138 L 35 256 C 58 269 106 275 160 275 C 214 275 262 269 285 256 L 288 138 C 288 68 242 34 160 34 Z"
        fill="rgba(255, 255, 255, 0.02)"
        strokeWidth="2.5"
      />
    </g>

    {/* Top panel */}
    <g stroke="rgba(255, 255, 255, 0.85)" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="160" cy="74" rx="92" ry="36" fill="rgba(255, 255, 255, 0.04)" strokeWidth="2.4" />
    </g>

    {/* Controls */}
    <g stroke="rgba(255, 255, 255, 0.7)" strokeLinecap="round" strokeLinejoin="round">
      {/* Minus */}
      <line x1="92" y1="74" x2="112" y2="74" strokeWidth="2.6" />

      {/* Mic mute */}
      <rect x="157" y="48" width="6" height="9.5" rx="3" fill="none" strokeWidth="1.9" />
      <path d="M 152.5 55 C 152.5 58.8 155.8 61 160 61 C 164.2 61 167.5 58.8 167.5 55" fill="none" strokeWidth="1.8" />
      <line x1="160" y1="61" x2="160" y2="64" strokeWidth="1.8" />
      <line x1="155" y1="64" x2="165" y2="64" strokeWidth="1.8" />
      <line x1="151" y1="49" x2="169" y2="62" strokeWidth="2" />

      {/* Salute button */}
      <ellipse cx="160" cy="94" rx="11" ry="4.4" fill="none" strokeWidth="2.1" />

      {/* Pulsing White Plus Button */}
      <g className="sber-white-plus-pulse" stroke="#FFFFFF">
        <line x1="208" y1="74" x2="228" y2="74" strokeWidth="3" />
        <line x1="219.5" y1="67.5" x2="216.5" y2="80.5" strokeWidth="2.8" />
      </g>
    </g>

    {/* Acoustic ribs */}
    <g stroke="rgba(255, 255, 255, 0.28)" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 156.5 110 L 156.5 262" fill="none" strokeWidth="2" />
      <path d="M 163.5 110 L 163.5 262" fill="none" strokeWidth="2" />
      <path d="M 134 108.5 C 131 126 131 158 131 260" fill="none" strokeWidth="2" />
      <path d="M 140 109.1 C 137 127 137 158 137 261" fill="none" strokeWidth="1.2" strokeOpacity="0.45" />
      <path d="M 110 104.3 C 103 122 103 156 103 257" fill="none" strokeWidth="2" />
      <path d="M 116 105.6 C 109 124 109 156 109 258" fill="none" strokeWidth="1.2" strokeOpacity="0.45" />
      <path d="M 88 96.4 C 75 114 75 150 75 251" fill="none" strokeWidth="2" />
      <path d="M 94 98.9 C 81 117 81 150 81 253" fill="none" strokeWidth="1.2" strokeOpacity="0.45" />
      <path d="M 73 86.2 C 53 102 52 140 52 243" fill="none" strokeWidth="2" />

      <path d="M 186 108.5 C 189 126 189 158 189 260" fill="none" strokeWidth="2" />
      <path d="M 180 109.1 C 183 127 183 158 183 261" fill="none" strokeWidth="1.2" strokeOpacity="0.45" />
      <path d="M 210 104.3 C 217 122 217 156 217 257" fill="none" strokeWidth="2" />
      <path d="M 204 105.6 C 211 124 211 156 211 258" fill="none" strokeWidth="1.2" strokeOpacity="0.45" />
      <path d="M 232 96.4 C 245 114 245 150 245 251" fill="none" strokeWidth="2" />
      <path d="M 226 98.9 C 239 117 239 150 239 253" fill="none" strokeWidth="1.2" strokeOpacity="0.45" />
      <path d="M 247 86.2 C 267 102 268 140 268 243" fill="none" strokeWidth="2" />
    </g>
  </>
);

const SberBoom2Paths: React.FC = () => (
  <>
    {/* Body shell */}
    <g stroke="rgba(255, 255, 255, 0.35)" strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M 160 32 C 80 32 36 64 36 130 L 39 256 C 62 269 108 275 160 275 C 212 275 258 269 281 256 L 284 130 C 284 64 240 32 160 32 Z"
        fill="rgba(255, 255, 255, 0.02)"
        strokeWidth="2.5"
      />
    </g>

    {/* LED Ring */}
    <g stroke="rgba(255, 255, 255, 0.85)" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="160" cy="84" rx="94" ry="36" fill="none" strokeWidth="2.2" />
      <ellipse cx="160" cy="86" rx="84" ry="31.5" fill="none" strokeWidth="2.8" />
      <ellipse cx="160" cy="87.5" rx="76" ry="28" fill="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" strokeOpacity="0.75" />
    </g>

    {/* Controls */}
    <g stroke="rgba(255, 255, 255, 0.7)" strokeLinecap="round" strokeLinejoin="round">
      {/* Minus */}
      <line x1="98" y1="87.5" x2="116" y2="87.5" strokeWidth="2.5" />

      {/* Mic mute */}
      <rect x="157.3" y="64" width="5.4" height="8.5" rx="2.7" fill="none" strokeWidth="1.8" />
      <path d="M 153 70.5 C 153 73.8 156 75.8 160 75.8 C 164 75.8 167 73.8 167 70.5" fill="none" strokeWidth="1.7" />
      <line x1="160" y1="75.8" x2="160" y2="78.5" strokeWidth="1.7" />
      <line x1="155.5" y1="78.5" x2="164.5" y2="78.5" strokeWidth="1.7" />
      <line x1="151.5" y1="65" x2="168.5" y2="76.5" strokeWidth="1.9" />

      {/* Salute button */}
      <ellipse cx="160" cy="106" rx="10" ry="4" fill="none" strokeWidth="2" />

      {/* Pulsing White Plus Button */}
      <g className="sber-white-plus-pulse" stroke="#FFFFFF">
        <line x1="204" y1="87.5" x2="222" y2="87.5" strokeWidth="3" />
        <line x1="214.5" y1="81.5" x2="211.5" y2="93.5" strokeWidth="2.8" />
      </g>
    </g>

    {/* Fabric Texture */}
    <g stroke="rgba(255, 255, 255, 0.22)" strokeLinecap="round">
      <line x1="56" y1="124" x2="58" y2="252" strokeWidth="1.4" />
      <line x1="76" y1="134" x2="77" y2="257" strokeWidth="1.5" />
      <line x1="98" y1="141" x2="99" y2="261" strokeWidth="1.6" />
      <line x1="122" y1="146" x2="122" y2="264" strokeWidth="1.7" />
      <line x1="147" y1="148" x2="147" y2="265" strokeWidth="1.8" />
      <line x1="173" y1="148" x2="173" y2="265" strokeWidth="1.8" />
      <line x1="198" y1="146" x2="198" y2="264" strokeWidth="1.7" />
      <line x1="222" y1="141" x2="221" y2="261" strokeWidth="1.6" />
      <line x1="244" y1="134" x2="243" y2="257" strokeWidth="1.5" />
      <line x1="264" y1="124" x2="262" y2="252" strokeWidth="1.4" />
    </g>
  </>
);

const SberBoomHomePaths: React.FC = () => (
  <>
    {/* Body shell */}
    <g stroke="rgba(255, 255, 255, 0.35)" strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M 18 112 C 18 164 22 214 27 254 C 46 265 98 271 160 271 C 222 271 274 265 293 254 C 298 214 302 164 302 112"
        fill="rgba(255, 255, 255, 0.02)"
        strokeWidth="2.5"
      />
      <path d="M 33 148 C 36 184 39 218 43 248" fill="none" strokeWidth="1.1" strokeOpacity="0.28" />
      <path d="M 287 148 C 284 184 281 218 277 248" fill="none" strokeWidth="1.1" strokeOpacity="0.28" />
    </g>

    {/* Top panel */}
    <g stroke="rgba(255, 255, 255, 0.85)" strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M 18 112 C 18 68 78 52 160 52 C 242 52 302 68 302 112 C 302 156 242 172 160 172 C 78 172 18 156 18 112 Z"
        fill="rgba(255, 255, 255, 0.04)"
        strokeWidth="2.5"
      />
      <path d="M 18 119 C 24 162 82 179 160 179 C 238 179 296 162 302 119" fill="none" strokeWidth="1.7" strokeOpacity="0.75" />
      <ellipse cx="160" cy="111" rx="62" ry="22" fill="none" strokeWidth="2.2" />
    </g>

    {/* Controls */}
    <g stroke="rgba(255, 255, 255, 0.7)" strokeLinecap="round" strokeLinejoin="round">
      {/* Heart button */}
      <path
        d="M 160 106.5 C 155.5 101 142.5 102 142.5 109.5 C 142.5 116 154.5 120.5 160 124 C 165.5 120.5 177.5 116 177.5 109.5 C 177.5 102 164.5 101 160 106.5 Z"
        fill="none"
        strokeWidth="2.1"
      />
      {/* Minus */}
      <line x1="48" y1="111" x2="72" y2="111" strokeWidth="2.8" />
      {/* Wave top */}
      <path d="M 143 74 C 147 66 151 65 155 69 C 158 72 162 72 165 69 C 169 65 173 66 177 74" fill="none" strokeWidth="2.6" />
      {/* Mic led indicator */}
      <ellipse cx="160" cy="150" rx="15" ry="5.2" fill="none" strokeWidth="2.3" />
      <ellipse cx="160" cy="150" rx="10" ry="3.2" fill="none" strokeWidth="1" strokeOpacity="0.35" />

      {/* Pulsing White Plus Button */}
      <g className="sber-white-plus-pulse" stroke="#FFFFFF">
        <line x1="248" y1="111" x2="272" y2="111" strokeWidth="3.2" />
        <line x1="261.5" y1="104.5" x2="258.5" y2="117.5" strokeWidth="3" />
      </g>
    </g>
  </>
);

const SberBoomMiniPaths: React.FC = () => (
  <>
    {/* Body shell */}
    <g stroke="rgba(255, 255, 255, 0.35)" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 20 116 L 26 254 C 48 267 100 274 160 274 C 220 274 272 267 294 254 L 300 116" fill="rgba(255, 255, 255, 0.02)" strokeWidth="2.5" />
    </g>

    {/* Top panel */}
    <g stroke="rgba(255, 255, 255, 0.85)" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="160" cy="116" rx="140" ry="62" fill="rgba(255, 255, 255, 0.04)" strokeWidth="2.5" />
      <path d="M 20 123 C 28 168 86 186 160 186 C 234 186 292 168 300 123" fill="none" strokeWidth="1.7" strokeOpacity="0.75" />
    </g>

    {/* Controls */}
    <g stroke="rgba(255, 255, 255, 0.7)" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="160" cy="115" rx="58" ry="24" fill="none" strokeWidth="2.3" />
      <path d="M 160 109 C 155 103 141 104 141 112 C 141 119 154 124 160 128 C 166 124 179 119 179 112 C 179 104 165 103 160 109 Z" fill="none" strokeWidth="2.2" />
      <line x1="44" y1="115" x2="68" y2="115" strokeWidth="2.6" />
      <ellipse cx="84" cy="115" rx="3.2" ry="1.8" fill="none" strokeWidth="1.8" />
      <ellipse cx="236" cy="115" rx="3.2" ry="1.8" fill="none" strokeWidth="1.8" />
      <path d="M 143 72 C 147 64 151 63 155 67 C 158 70 162 70 165 67 C 169 63 173 64 177 72" fill="none" strokeWidth="2.5" />
      <ellipse cx="160" cy="158" rx="16" ry="5.5" fill="none" strokeWidth="2.2" />

      {/* Pulsing White Plus Button */}
      <g className="sber-white-plus-pulse" stroke="#FFFFFF">
        <line x1="252" y1="115" x2="276" y2="115" strokeWidth="3" />
        <line x1="265.5" y1="109" x2="262.5" y2="121" strokeWidth="2.8" />
      </g>
    </g>

    {/* Acoustic ribs */}
    <g stroke="rgba(255, 255, 255, 0.28)" strokeLinecap="round">
      <line x1="46" y1="176" x2="48" y2="246" strokeWidth="1.8" />
      <line x1="72" y1="186" x2="73" y2="254" strokeWidth="2" />
      <line x1="100" y1="193" x2="101" y2="259" strokeWidth="2.1" />
      <line x1="130" y1="197" x2="130" y2="262" strokeWidth="2.2" />
      <line x1="160" y1="199" x2="160" y2="263" strokeWidth="2.2" />
      <line x1="190" y1="197" x2="190" y2="262" strokeWidth="2.2" />
      <line x1="220" y1="193" x2="219" y2="259" strokeWidth="2.1" />
      <line x1="248" y1="186" x2="247" y2="254" strokeWidth="2" />
      <line x1="274" y1="176" x2="272" y2="246" strokeWidth="1.8" />
    </g>
  </>
);

export const SberCastPairingModal: React.FC = () => {
  const isPairing = useSberCastStore((s) => s.isPairing);
  const pairingDevice = useSberCastStore((s) => s.pairingDevice);
  const cancelPairing = useSberCastStore((s) => s.cancelPairing);

  const model = detectSpeakerModel(pairingDevice);

  // Handle ESC key to cancel pairing
  useEffect(() => {
    if (!isPairing) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelPairing();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPairing, cancelPairing]);

  if (!isPairing) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(5, 5, 10, 0.82)',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        animation: 'fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          cancelPairing();
        }
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '430px',
          height: '320px',
          background: '#12121A',
          borderRadius: '24px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 32px 72px rgba(0, 0, 0, 0.9)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button Top Right */}
        <button
          type="button"
          onClick={cancelPairing}
          title="Закрыть"
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            zIndex: 10,
            background: 'rgba(255, 255, 255, 0.06)',
            border: 'none',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'rgba(255, 255, 255, 0.6)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)';
            e.currentTarget.style.color = '#FFFFFF';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header Texts */}
        <div
          style={{
            padding: '28px 24px 0',
            textAlign: 'center',
            position: 'relative',
            zIndex: 3,
          }}
        >
          <h2
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: '#FFFFFF',
              letterSpacing: '-0.3px',
              margin: 0,
            }}
          >
            Подтвердите подключение
          </h2>
          <div
            style={{
              fontSize: '14px',
              color: 'rgba(255, 255, 255, 0.65)',
              margin: '6px 0 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <span>Нажмите на</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.12)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '13px',
                border: '1px solid rgba(255, 255, 255, 0.22)',
              }}
            >
              +
            </span>
          </div>
        </div>

        {/* Full-width Speaker Panel Background at the bottom */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '210px',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {/* Speaker Vector Illustration zoomed into the top control panel */}
          <svg
            viewBox={SPEAKER_CONFIGS[model].viewBox}
            preserveAspectRatio="xMidYMax meet"
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              transform: 'translateY(2px)',
            }}
          >
            {model === 'sberboom' && <SberBoomPaths />}
            {model === 'sberboom-2' && <SberBoom2Paths />}
            {model === 'sberboom-home' && <SberBoomHomePaths />}
            {model === 'sberboom-mini' && <SberBoomMiniPaths />}
          </svg>
        </div>
      </div>
    </div>
  );
};
