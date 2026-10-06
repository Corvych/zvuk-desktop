import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../features/player/playerStore';

interface AuroraCanvasProps {
  className?: string;
}

const VERT_SHADER_SOURCE = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG_SHADER_SOURCE = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform float u_bass;
uniform float u_mid;
uniform float u_energy;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float x = uv.x;
  float y = 1.0 - uv.y; // 0 at top, 1 at bottom

  // Diagonal flow direction (curtains with natural silk tilt)
  float diag = x * 0.88 + y * 0.22;

  // Fluid fabric wave displacements (multi-frequency silk undulation)
  float t = u_time * 0.38;
  float w1 = sin(diag * 7.5 + y * 2.8 + t * 0.75) * 0.14;
  float w2 = cos(diag * 13.5 - y * 4.2 - t * 0.55) * 0.08;
  float w3 = sin(x * 22.0 + y * 6.5 + t * 1.1) * 0.035;

  float warp = diag + w1 + w2 + w3;

  // Sharp, elegant silk curtain folds / light ribbons
  float f1 = pow(cos(warp * 8.5 - t * 0.3) * 0.5 + 0.5, 2.4);
  float f2 = pow(sin((warp - 0.35) * 14.0 + t * 0.4) * 0.5 + 0.5, 3.2);
  float f3 = pow(cos((warp + 0.65) * 5.2 - t * 0.2) * 0.5 + 0.5, 1.8);
  float f4 = pow(sin((warp * 2.0 + y * 2.2) * 9.0 + t * 0.5) * 0.5 + 0.5, 2.5);

  // Micro-striations along the silk folds (subtle thread-like light lines)
  float micro = sin(warp * 48.0 + y * 14.0 + t * 0.8) * 0.5 + 0.5;
  micro = pow(micro, 4.5) * 0.14;

  // Combine folds with dimensional weighting
  float folds = f1 * 0.44 + f2 * 0.32 + f3 * 0.34 + f4 * 0.18 + micro;

  // Specular sheen along the crests (soft, velvety highlight)
  float sheen = pow(f1 * 0.7 + f2 * 0.5, 2.2) * 0.32;

  // Depth valley contrast
  float depth = smoothstep(0.06, 0.58, folds);

  // Smooth vertical decay from top to bottom
  float falloff = smoothstep(0.96, 0.08, y);
  falloff = pow(falloff, 1.35);

  // Ambient volumetric background glow
  float ambient = exp(-y * 2.4) * 0.36;

  // Audio-reactive intensity
  float intensity = (folds * 0.82 + ambient + sheen * 0.6) * falloff * depth;
  intensity *= (0.78 + u_bass * 0.42 + u_energy * 0.32);

  // Rich color grading: dark shadow emerald -> vibrant mid -> rich velvety crests
  vec3 shadowCol = u_color1 * 0.20;
  vec3 midCol = u_color1 * 0.90;
  vec3 crestCol = mix(u_color1 * 1.05, u_color2 * 0.95, 0.38);

  vec3 col = mix(shadowCol, midCol, clamp(folds * 1.1, 0.0, 1.0));
  col = mix(col, crestCol, clamp(sheen * 1.1, 0.0, 0.8));

  // Subtle organic grain
  float grain = (hash(gl_FragCoord.xy + fract(u_time * 0.1)) - 0.5) * 0.024;
  col += vec3(grain);

  float alpha = clamp(intensity * 1.25, 0.0, 0.92);
  gl_FragColor = vec4(col, alpha);
}
`;

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[AuroraCanvas] Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function parseRgb(str: string, fallback: [number, number, number]): [number, number, number] {
  const parts = str.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
  }
  return fallback;
}

export function AuroraCanvas({ className }: AuroraCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    } catch (e) {
      gl = null;
    }

    if (!gl) {
      // If WebGL is not available, render graceful 2D canvas fallback
      return fallbackRender2D(canvas, () => isPlaying);
    }

    const vertShader = createShader(gl, gl.VERTEX_SHADER, VERT_SHADER_SOURCE);
    const fragShader = createShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER_SOURCE);
    if (!vertShader || !fragShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[AuroraCanvas] Program link error:', gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    // Quad geometry covering full clip space (-1 to +1)
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const aPosition = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, 'u_resolution');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uColor1 = gl.getUniformLocation(program, 'u_color1');
    const uColor2 = gl.getUniformLocation(program, 'u_color2');
    const uBass = gl.getUniformLocation(program, 'u_bass');
    const uMid = gl.getUniformLocation(program, 'u_mid');
    const uEnergy = gl.getUniformLocation(program, 'u_energy');

    let animId: number;
    let lastTime = performance.now();
    let accumulatedTime = 0;

    const resize = () => {
      if (!canvas || !gl) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.floor(canvas.clientWidth * dpr);
      const height = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    window.addEventListener('resize', resize);
    resize();

    const render = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Speed up flow when music is playing, serene breathing when paused
      accumulatedTime += dt * (isPlaying ? 1.0 : 0.45);

      if (gl && canvas) {
        resize();

        // Read CSS variables set by Monet theme or wave moods
        const rootStyle = getComputedStyle(document.documentElement);
        const rgb1Str = rootStyle.getPropertyValue('--wave-mood-rgb') || '112, 220, 85';
        const rgb2Str = rootStyle.getPropertyValue('--aurora-secondary-rgb') || '56, 239, 125';

        const color1 = parseRgb(rgb1Str, [112 / 255, 220 / 255, 85 / 255]);
        const color2 = parseRgb(rgb2Str, [56 / 255, 239 / 255, 125 / 255]);

        const bass = parseFloat(rootStyle.getPropertyValue('--audio-bass')) || 0;
        const mid = parseFloat(rootStyle.getPropertyValue('--audio-mid')) || 0;
        const energy = parseFloat(rootStyle.getPropertyValue('--audio-energy')) || 0;

        gl.uniform2f(uResolution, canvas.width, canvas.height);
        gl.uniform1f(uTime, accumulatedTime);
        gl.uniform3f(uColor1, color1[0], color1[1], color1[2]);
        gl.uniform3f(uColor2, color2[0], color2[1], color2[2]);
        gl.uniform1f(uBass, bass);
        gl.uniform1f(uMid, mid);
        gl.uniform1f(uEnergy, energy);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      if (gl) {
        gl.deleteProgram(program);
        gl.deleteShader(vertShader);
        gl.deleteShader(fragShader);
        gl.deleteBuffer(positionBuffer);
      }
    };
  }, [isPlaying]);

  return <canvas ref={canvasRef} className={className} />;
}

function fallbackRender2D(canvas: HTMLCanvasElement, getIsPlaying: () => boolean) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let animId: number;
  let t = 0;

  const render2D = () => {
    t += getIsPlaying() ? 0.025 : 0.01;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(112, 220, 85, 0.45)');
    grad.addColorStop(0.5, 'rgba(112, 220, 85, 0.18)');
    grad.addColorStop(1, 'rgba(112, 220, 85, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Draw wavy silk folds
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      const xOffset = (w / 6) * i;
      ctx.strokeStyle = `rgba(140, 240, 110, ${0.15 + (i % 2) * 0.1})`;
      for (let y = 0; y < h; y += 10) {
        const x = xOffset + Math.sin(y * 0.01 + t + i) * 35 + Math.cos(y * 0.02 - t) * 20;
        if (y === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    animId = requestAnimationFrame(render2D);
  };

  animId = requestAnimationFrame(render2D);
  return () => cancelAnimationFrame(animId);
}
