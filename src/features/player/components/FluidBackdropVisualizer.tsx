import { useEffect, useRef } from 'react';
import { sampleByteFrequencyData } from '../audioService';
import { useWindowFreezeStore, getIsWindowFrozen } from '../../../lib/windowFreezeStore';

export type BackdropMode = 'fluid' | 'lava' | 'off';

interface FluidBackdropVisualizerProps {
  glowRgb: string;
  secondaryRgb: string;
  tertiaryRgb: string;
  isPlaying: boolean;
  mode: BackdropMode;
}

const VERT_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// ─── SHADER 1: LIVING LIQUID SILK / EXPANSIVE FABRIC GRADIENT ────────────────
const FRAG_SHADER_FLUID = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_color3;
uniform float u_bass;
uniform float u_mid;
uniform float u_energy;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / u_resolution.y;

  vec2 p = uv - 0.5;
  p.x *= aspect;

  float t = u_time * 0.28;

  // Diagonal flow direction with natural breathing angle
  float flowAngle = 0.65 + 0.12 * sin(t * 0.22);
  vec2 flowDir = vec2(cos(flowAngle), sin(flowAngle));
  float flow = dot(p, flowDir);
  float perp = dot(p, vec2(-flowDir.y, flowDir.x));

  // Multi-frequency liquid silk wave displacements
  float wave1 = sin(flow * 3.8 + perp * 1.6 + t * 0.75) * 0.20;
  float wave2 = cos(flow * 6.5 - perp * 2.2 - t * 0.60) * 0.12;
  float wave3 = sin(perp * 8.0 + flow * 2.8 + t * 0.90 + u_bass * 0.45) * 0.08;
  float wave4 = cos(flow * 12.0 + perp * 4.5 + t * 1.1) * 0.04;

  float warp = flow + wave1 + wave2 + wave3 + wave4;

  // Fluid fabric folds (multi-layer organic silk curtains)
  float fold1 = pow(cos(warp * 4.6 - t * 0.42) * 0.5 + 0.5, 2.2);
  float fold2 = pow(sin((warp - 0.35) * 7.2 + t * 0.52) * 0.5 + 0.5, 2.6);
  float fold3 = pow(cos((warp + 0.65) * 3.2 - t * 0.28) * 0.5 + 0.5, 1.8);
  float fold4 = pow(sin((warp * 1.8 + perp * 2.0) * 5.4 + t * 0.45) * 0.5 + 0.5, 2.2);

  // Micro-striations along the silk folds (thread-like light lines)
  float micro = pow(sin(warp * 26.0 + perp * 7.0 + t * 0.85) * 0.5 + 0.5, 3.8) * 0.14 * (0.8 + u_mid * 0.6);

  // Combine folds with dimensional weighting
  float foldTotal = fold1 * 0.38 + fold2 * 0.30 + fold3 * 0.28 + fold4 * 0.20 + micro;

  // Specular velvety sheen along the crests
  float sheen = pow(fold1 * 0.65 + fold2 * 0.52, 2.4) * 0.40;

  // Expansive spatial gradient coordinate across the entire canvas (0.0 to 1.0)
  float gradT = clamp((uv.x * 0.68 + (1.0 - uv.y) * 0.68) + sin(t * 0.35 + warp * 0.7) * 0.22, 0.0, 1.0);

  // Multi-stop background gradient: Color1 -> Color2 -> Color3 (expansive field)
  vec3 baseGrad;
  if (gradT < 0.5) {
    baseGrad = mix(u_color1 * 0.32, u_color2 * 0.30, gradT * 2.0);
  } else {
    baseGrad = mix(u_color2 * 0.30, u_color3 * 0.32, (gradT - 0.5) * 2.0);
  }

  // Base silk ambient tint
  vec3 darkSilk = mix(u_color1, u_color3, 0.5) * 0.05 + vec3(0.012, 0.012, 0.018);

  // Dynamic crest colors mapping the gradient onto the folds
  float crestT = clamp(gradT + fold1 * 0.32 - 0.16, 0.0, 1.0);
  vec3 crestColor;
  if (crestT < 0.5) {
    crestColor = mix(u_color1 * 1.15, u_color2 * 1.10, crestT * 2.0);
  } else {
    crestColor = mix(u_color2 * 1.10, u_color3 * 1.18, (crestT - 0.5) * 2.0);
  }

  // Secondary counter-hue accent woven into the ripples
  vec3 accentWoven = mix(u_color3 * 1.12, u_color1 * 1.12, clamp(fold3 * 1.2, 0.0, 1.0));

  // Combine base gradient + illuminated folds
  vec3 col = darkSilk + baseGrad * 0.80;
  col += crestColor * foldTotal * (0.65 + u_bass * 0.32);
  col = mix(col, accentWoven, clamp(fold4 * 0.35, 0.0, 0.45));

  // Velvety sheen and iridescent highlights on fold ridges
  vec3 sheenCol = mix(crestColor * 1.15, vec3(1.0), 0.25);
  col += sheenCol * sheen * (0.30 + u_energy * 0.32);

  // Soft atmospheric tone mapping: ensures bright colors never wash out text
  col = col / (1.0 + col * 0.35);

  // Subtle film grain dither
  float grain = (hash(gl_FragCoord.xy + fract(u_time * 0.05)) - 0.5) * 0.022;
  col += vec3(grain);

  // Expansive, gentle vignette (keeps full screen expansive, softly fading only near extreme borders)
  float vignette = smoothstep(1.75, 0.55, length(p) * 1.15);
  col *= clamp(vignette * 1.08, 0.30, 1.0);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// ─── SHADER 2: RETRO-FUTURISTIC AUDIO-REACTIVE LAVA LAMP (METABALLS) ────────
const FRAG_SHADER_LAVA = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_color3;
uniform float u_bass;
uniform float u_mid;
uniform float u_energy;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Polynomial smooth min for organic liquid fusion
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Signed distance to an organic rounded wax bubble (pure fluid physics, no geometric star artifacts)
float sdBlob(vec2 p, vec2 center, float radius, float wobble, float t, float phase) {
  if (radius < 0.005) return 999.0;
  vec2 d = p - center;

  // Natural vertical buoyancy deformation (smooth, teardrop droplet shape)
  d.y *= 0.94;
  float r = length(d);
  float angle = atan(d.y, d.x);

  // Natural fluid surface tension oscillation (dipole mode: breathing smoothly between oval and round)
  // Replaces sin(angle * 4.0) which caused an artificial 4-pointed star
  float surfaceWobble = (sin(angle * 2.0 + t * 1.8 + phase) * 0.75 + cos(angle * 1.0 - t * 1.2 + phase) * 0.25) * wobble;
  return (r - radius - surfaceWobble);
}

// Seamless emergence scaling: smoothly buds wax out of bottom reservoir and merges into cooling dome
float blobScale(float y) {
  return smoothstep(-0.76, -0.40, y) * smoothstep(0.76, 0.40, y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / u_resolution.y;

  vec2 p = uv - 0.5;
  p.x *= aspect;

  float t = u_time * 0.24;

  // 1. Bottom molten wax reservoir & Top cooling dome
  float bottomPool = p.y - (-0.52 + 0.04 * sin(p.x * 2.2 + t * 0.5) + 0.025 * u_bass);
  float topPool = -(p.y - (0.52 + 0.03 * cos(p.x * 2.0 - t * 0.4)));

  // 2. Convection blobs - cycle across range [-0.82, 0.82] with seamless boundary scaling and lively groove
  // Blob 1: Main rising wax mass (center-left)
  float y1 = mod(t * 0.13 + 0.10, 1.64) - 0.82;
  vec2 c1 = vec2(sin(t * 0.18 + 0.8) * 0.22 * aspect, y1);
  float s1 = blobScale(y1);
  float b1 = sdBlob(p, c1, (0.22 + 0.045 * u_bass) * s1, 0.009 + 0.007 * u_bass, t, 0.0);

  // Blob 2: Substantial rising bubble (right)
  float y2 = mod(t * 0.15 + 0.65, 1.64) - 0.82;
  vec2 c2 = vec2(cos(t * 0.21 + 2.1) * 0.28 * aspect, y2);
  float s2 = blobScale(y2);
  float b2 = sdBlob(p, c2, (0.19 + 0.038 * u_bass) * s2, 0.008 + 0.006 * u_mid, t, 1.2);

  // Blob 3: Descending cooled wax bubble (left)
  float y3 = 0.82 - mod(t * 0.11 + 0.35, 1.64);
  vec2 c3 = vec2(sin(t * 0.16 + 4.1) * 0.32 * aspect, y3);
  float s3 = blobScale(y3);
  float b3 = sdBlob(p, c3, (0.18 + 0.030 * u_mid) * s3, 0.007, t, 2.5);

  // Blob 4: Rising buoyant droplet (center-right)
  float y4 = mod(t * 0.18 + 1.15, 1.64) - 0.82;
  vec2 c4 = vec2(-cos(t * 0.24 + 1.2) * 0.18 * aspect, y4);
  float s4 = blobScale(y4);
  float b4 = sdBlob(p, c4, (0.17 + 0.032 * u_energy) * s4, 0.008, t, 3.8);

  // Blob 5: Major rising droplet (center)
  float y5 = mod(t * 0.12 + 0.40, 1.64) - 0.82;
  vec2 c5 = vec2(cos(t * 0.18 - 1.0) * 0.18 * aspect, y5);
  float s5 = blobScale(y5);
  float b5 = sdBlob(p, c5, (0.22 + 0.045 * u_bass) * s5, 0.009 + 0.007 * u_bass, t, 4.4);

  // Blob 6: Descending cooled blob (right)
  float y6 = 0.82 - mod(t * 0.13 + 1.05, 1.64);
  vec2 c6 = vec2(-sin(t * 0.19 + 2.8) * 0.28 * aspect, y6);
  float s6 = blobScale(y6);
  float b6 = sdBlob(p, c6, (0.18 + 0.030 * u_mid) * s6, 0.007, t, 5.1);

  // Blob 7: Rising warm balloon (far left)
  float y7 = mod(t * 0.14 + 1.40, 1.64) - 0.82;
  vec2 c7 = vec2(-0.35 * aspect + sin(t * 0.22 + 0.5) * 0.12 * aspect, y7);
  float s7 = blobScale(y7);
  float b7 = sdBlob(p, c7, (0.18 + 0.035 * u_bass) * s7, 0.008 + 0.005 * u_bass, t, 0.7);

  // Blob 8: Rising warm balloon (far right)
  float y8 = mod(t * 0.16 + 0.90, 1.64) - 0.82;
  vec2 c8 = vec2(0.36 * aspect + cos(t * 0.20 + 3.4) * 0.12 * aspect, y8);
  float s8 = blobScale(y8);
  float b8 = sdBlob(p, c8, (0.18 + 0.035 * u_energy) * s8, 0.008, t, 1.9);

  // Blob 9: Descending cooled wax droplet (center-left)
  float y9 = 0.82 - mod(t * 0.12 + 0.70, 1.64);
  vec2 c9 = vec2(sin(t * 0.17 + 3.8) * 0.22 * aspect, y9);
  float s9 = blobScale(y9);
  float b9 = sdBlob(p, c9, (0.19 + 0.032 * u_bass) * s9, 0.007, t, 3.2);

  // Blob 10: Rising buoyant droplet (center-right)
  float y10 = mod(t * 0.14 + 0.25, 1.64) - 0.82;
  vec2 c10 = vec2(cos(t * 0.20 + 5.2) * 0.20 * aspect, y10);
  float s10 = blobScale(y10);
  float b10 = sdBlob(p, c10, (0.19 + 0.034 * u_bass) * s10, 0.008 + 0.006 * u_mid, t, 4.8);

  // 3. Smooth minimum fusion across all wax elements (wide, rich liquid bridges)
  float d = bottomPool;
  d = smin(d, topPool, 0.22);
  d = smin(d, b1, 0.26);
  d = smin(d, b2, 0.25);
  d = smin(d, b3, 0.24);
  d = smin(d, b4, 0.23);
  d = smin(d, b5, 0.28);
  d = smin(d, b6, 0.24);
  d = smin(d, b7, 0.24);
  d = smin(d, b8, 0.24);
  d = smin(d, b9, 0.25);
  d = smin(d, b10, 0.25);

  // 4. Color grading - soft, buttery color blending without harsh steps or jumps
  // Deep base fluid in the lamp (rich, velvety ambient tone)
  vec3 darkBase = mix(u_color1, u_color3, 0.5) * 0.05 + vec3(0.010, 0.010, 0.015);

  // Vertical thermal gradient + soft flowing harmonic wave for velvety smooth color transitions
  float thermalT = clamp((p.y + 0.52) + sin(p.x * 1.5 + t * 0.3) * 0.12, 0.0, 1.0);

  // Multi-stop continuous color interpolation across the lamp height
  vec3 warmWax;
  if (thermalT < 0.5) {
    warmWax = mix(u_color1 * 1.05, u_color2 * 1.0, smoothstep(0.0, 0.5, thermalT));
  } else {
    warmWax = mix(u_color2 * 1.0, u_color3 * 1.05, smoothstep(0.5, 1.0, thermalT));
  }

  // Gentle chromatic breathing across time (soft flowing highlights)
  float chromShift = sin(t * 0.35 + p.y * 1.5 + p.x * 0.8) * 0.5 + 0.5;
  warmWax = mix(warmWax, mix(u_color2, u_color1, 0.5) * 1.02, chromShift * 0.20);

  // Volumetric inside glow - solid, voluptuous wax drops
  float inside = smoothstep(0.012, -0.04, d);
  float core = smoothstep(-0.03, -0.15, d);
  vec3 waxCol = mix(warmWax * 0.72, warmWax * 1.15, core);
  waxCol += u_color1 * core * (0.22 + u_bass * 0.28);

  // Glossy rim highlight (Fresnel meniscus) - gentle, tinted meniscus
  float rim = smoothstep(0.032, 0.0, abs(d));
  waxCol += mix(warmWax, vec3(1.0), 0.35) * rim * 0.22;

  // Ambient fluid glow around blobs
  float halo = exp(-max(0.0, d) * 7.5);
  vec3 ambientGlow = warmWax * halo * (0.28 + 0.20 * u_bass);

  // Lamp bulb thermal under-glow at bottom
  float bulb = exp(-(p.y + 0.52) * 5.2) * (0.30 + 0.25 * u_bass);
  vec3 bulbGlow = u_color1 * bulb * 0.35;

  // Composite final color
  vec3 col = mix(darkBase + ambientGlow + bulbGlow, waxCol, inside);

  // Soft atmospheric tone mapping: ensures bright colors never wash out text
  col = col / (1.0 + col * 0.40);

  // Subtle film grain
  float grain = (hash(gl_FragCoord.xy + fract(u_time * 0.05)) - 0.5) * 0.020;
  col += vec3(grain);

  // Soft perimeter vignette
  float vignette = smoothstep(1.35, 0.35, length(uv - 0.5) * 1.38);
  col *= clamp(vignette * 1.05, 0.22, 1.0);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

interface ProgramInfo {
  program: WebGLProgram;
  vertShader: WebGLShader;
  fragShader: WebGLShader;
  aPosition: number;
  uResolution: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  uColor1: WebGLUniformLocation | null;
  uColor2: WebGLUniformLocation | null;
  uColor3: WebGLUniformLocation | null;
  uBass: WebGLUniformLocation | null;
  uMid: WebGLUniformLocation | null;
  uEnergy: WebGLUniformLocation | null;
}

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[FluidBackdropVisualizer] Shader error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function initProgram(gl: WebGLRenderingContext, fragSource: string): ProgramInfo | null {
  const vertShader = createShader(gl, gl.VERTEX_SHADER, VERT_SHADER);
  const fragShader = createShader(gl, gl.FRAGMENT_SHADER, fragSource);
  if (!vertShader || !fragShader) return null;

  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[FluidBackdropVisualizer] Link error:', gl.getProgramInfoLog(program));
    return null;
  }

  return {
    program,
    vertShader,
    fragShader,
    aPosition: gl.getAttribLocation(program, 'a_position'),
    uResolution: gl.getUniformLocation(program, 'u_resolution'),
    uTime: gl.getUniformLocation(program, 'u_time'),
    uColor1: gl.getUniformLocation(program, 'u_color1'),
    uColor2: gl.getUniformLocation(program, 'u_color2'),
    uColor3: gl.getUniformLocation(program, 'u_color3'),
    uBass: gl.getUniformLocation(program, 'u_bass'),
    uMid: gl.getUniformLocation(program, 'u_mid'),
    uEnergy: gl.getUniformLocation(program, 'u_energy'),
  };
}

function parseRgb(str: string, fallback: [number, number, number]): [number, number, number] {
  if (!str) return fallback;
  const parts = str.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    let r = parts[0] / 255;
    let g = parts[1] / 255;
    let b = parts[2] / 255;

    // Perceptual luminance calculation (ITU-R BT.709)
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    // Gracefully darken bright colors so foreground white text and lyrics remain sharp & legible
    const targetMaxLuma = 0.36;
    if (luma > targetMaxLuma) {
      const dimFactor = Math.pow(targetMaxLuma / luma, 0.85);
      r *= dimFactor;
      g *= dimFactor;
      b *= dimFactor;
    }

    return [r, g, b];
  }
  return fallback;
}

export function FluidBackdropVisualizer({
  glowRgb,
  secondaryRgb,
  tertiaryRgb,
  isPlaying,
  mode,
}: FluidBackdropVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const colorsRef = useRef({ glowRgb, secondaryRgb, tertiaryRgb });
  useEffect(() => {
    colorsRef.current = { glowRgb, secondaryRgb, tertiaryRgb };
  }, [glowRgb, secondaryRgb, tertiaryRgb]);

  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (mode === 'off') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
      });
    } catch {
      gl = null;
    }

    if (!gl) return;

    // Only compile the active shader program (lazy initialization based on mode)
    const activeProg = initProgram(gl, mode === 'lava' ? FRAG_SHADER_LAVA : FRAG_SHADER_FLUID);
    if (!activeProg) return;

    // Fullscreen quad buffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    let animId: number;
    let lastTime = performance.now();
    let accumulatedTime = 0;
    let lastFrameTime = 0;

    let smoothedBass = 0;
    let smoothedMid = 0;
    let smoothedEnergy = 0;

    // Interpolated palette colors for buttery smooth crossfades between tracks
    const curC1: [number, number, number] = parseRgb(colorsRef.current.glowRgb, [120 / 255, 70 / 255, 180 / 255]);
    const curC2: [number, number, number] = parseRgb(colorsRef.current.secondaryRgb, [200 / 255, 60 / 255, 120 / 255]);
    const curC3: [number, number, number] = parseRgb(colorsRef.current.tertiaryRgb, [50 / 255, 130 / 255, 210 / 255]);

    const freqArray = new Uint8Array(32);

    const resize = () => {
      if (!canvas || !gl) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.0);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    window.addEventListener('resize', resize);
    resize();

    let isRunning = true;

    const render = (now: number) => {
      // Complete freeze when minimized or tab hidden: do not queue next rAF frame
      if (getIsWindowFrozen() || document.hidden) {
        isRunning = false;
        return;
      }

      // Throttle: ≥75 FPS (11ms target, prevents frame drops on 60Hz/75Hz+ displays), ~12 FPS when window is blurred/unfocused (saving GPU/battery)
      const targetInterval = document.hasFocus() ? 11 : 80;
      if (now - lastFrameTime < targetInterval) {
        animId = requestAnimationFrame(render);
        return;
      }
      lastFrameTime = now;

      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      accumulatedTime += dt * (isPlayingRef.current ? 1.0 : 0.25);

      // Smooth color crossfade over ~1.2s without shader recompilation
      const targetC1 = parseRgb(colorsRef.current.glowRgb, [120 / 255, 70 / 255, 180 / 255]);
      const targetC2 = parseRgb(colorsRef.current.secondaryRgb, [200 / 255, 60 / 255, 120 / 255]);
      const targetC3 = parseRgb(colorsRef.current.tertiaryRgb, [50 / 255, 130 / 255, 210 / 255]);

      const cLerp = Math.min(1.0, dt * 2.2);
      for (let i = 0; i < 3; i++) {
        curC1[i] += (targetC1[i] - curC1[i]) * cLerp;
        curC2[i] += (targetC2[i] - curC2[i]) * cLerp;
        curC3[i] += (targetC3[i] - curC3[i]) * cLerp;
      }

      // Audio-reactive analysis
      let hasReal = false;

      if (sampleByteFrequencyData(freqArray)) {
        let sum = 0;
        for (let i = 0; i < 16; i++) sum += freqArray[i];

        // Noise gate: only react when there is actual audible signal
        if (sum > 4) {
          hasReal = true;
          const rawBass = (freqArray[0] + freqArray[1] + freqArray[2] + freqArray[3]) / (4 * 255);
          const rawMid = (freqArray[4] + freqArray[5] + freqArray[6] + freqArray[7]) / (4 * 255);
          const rawEnergy = rawBass * 0.6 + rawMid * 0.4;

          // Asymmetric attack/decay: lively snappy response on real beats, smooth decay
          const bassSpeed = rawBass > smoothedBass ? 0.28 : 0.12;
          const midSpeed = rawMid > smoothedMid ? 0.24 : 0.10;
          const energySpeed = rawEnergy > smoothedEnergy ? 0.26 : 0.10;

          smoothedBass += (rawBass - smoothedBass) * bassSpeed;
          smoothedMid += (rawMid - smoothedMid) * midSpeed;
          smoothedEnergy += (rawEnergy - smoothedEnergy) * energySpeed;
        }
      }

      if (!hasReal) {
        // True silence or quiet passages: decay to calm resting state (ZERO phantom hits)
        smoothedBass *= 0.88;
        smoothedMid *= 0.88;
        smoothedEnergy *= 0.88;

        if (smoothedBass < 0.005) smoothedBass = 0;
        if (smoothedMid < 0.005) smoothedMid = 0;
        if (smoothedEnergy < 0.005) smoothedEnergy = 0;
      }

      if (gl && canvas) {
        gl.useProgram(activeProg.program);

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(activeProg.aPosition);
        gl.vertexAttribPointer(activeProg.aPosition, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(activeProg.uResolution, canvas.width, canvas.height);
        gl.uniform1f(activeProg.uTime, accumulatedTime);
        gl.uniform3f(activeProg.uColor1, curC1[0], curC1[1], curC1[2]);
        gl.uniform3f(activeProg.uColor2, curC2[0], curC2[1], curC2[2]);
        gl.uniform3f(activeProg.uColor3, curC3[0], curC3[1], curC3[2]);
        gl.uniform1f(activeProg.uBass, smoothedBass);
        gl.uniform1f(activeProg.uMid, smoothedMid);
        gl.uniform1f(activeProg.uEnergy, smoothedEnergy);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    const unsub = useWindowFreezeStore.subscribe((state, prev) => {
      if (!state.isFrozen && prev.isFrozen) {
        if (!isRunning && gl && canvas) {
          isRunning = true;
          lastTime = performance.now();
          lastFrameTime = performance.now();
          animId = requestAnimationFrame(render);
        }
      }
    });

    return () => {
      unsub();
      cancelAnimationFrame(animId);
      ro.disconnect();
      window.removeEventListener('resize', resize);
      if (gl) {
        gl.deleteProgram(activeProg.program);
        gl.deleteShader(activeProg.vertShader);
        gl.deleteShader(activeProg.fragShader);
        gl.deleteBuffer(positionBuffer);
      }
    };
  }, [mode]);

  if (mode === 'off') return null;

  return (
    <canvas
      ref={canvasRef}
      className="fullscreen-fluid-backdrop-canvas"
      aria-hidden="true"
    />
  );
}
