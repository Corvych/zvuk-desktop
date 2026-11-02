/**
 * Monet Palette Engine (Material You style adaptive color & gradient system)
 * Extracts multiple key distinct vibrant colors from album artwork / avatars,
 * and generates cohesive multi-stop gradients, volumetric lighting, and tonal accents.
 */

export interface MonetTheme {
  accentColor: string;      // High-contrast readable color for typography & highlights: "rgb(r, g, b)"
  accentHex: string;        // Hex representation: "#rrggbb"
  glowRgb: string;          // Primary key color RGB for volumetric glow & blooms: "r, g, b"
  secondaryRgb: string;     // Secondary key color RGB: "r, g, b"
  tertiaryRgb: string;      // Tertiary key color RGB: "r, g, b"
  rawSeedRgb: string;       // Direct sampled primary color: "r, g, b"
  palette: string[];        // Array of key hex colors: ["#rrggbb", "#rrggbb", "#rrggbb"]
  gradient: string;         // Multi-stop CSS linear-gradient: "linear-gradient(135deg, ...)"
  gradientRadial: string;   // Atmospheric CSS radial-gradient: "radial-gradient(circle, ...)"
}

export function parseHexToRgb(hex: string): [number, number, number] | null {
  let cleaned = hex.trim().replace(/^#/, '');
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (cleaned.length !== 6) return null;
  const num = parseInt(cleaned, 16);
  if (isNaN(num)) return null;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;

  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rf:
        h = (gf - bf) / d + (gf < bf ? 6 : 0);
        break;
      case gf:
        h = (bf - rf) / d + 2;
        break;
      case bf:
        h = (rf - gf) / d + 4;
        break;
    }
    h *= 60;
  }

  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const normH = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((normH / 60) % 2) - 1));
  const m = l - c / 2;

  let rf = 0;
  let gf = 0;
  let bf = 0;

  if (normH < 60) {
    rf = c;
    gf = x;
  } else if (normH < 120) {
    rf = x;
    gf = c;
  } else if (normH < 180) {
    gf = c;
    bf = x;
  } else if (normH < 240) {
    gf = x;
    bf = c;
  } else if (normH < 300) {
    rf = x;
    bf = c;
  } else {
    rf = c;
    bf = x;
  }

  return [
    Math.round((rf + m) * 255),
    Math.round((gf + m) * 255),
    Math.round((bf + m) * 255),
  ];
}

export interface ColorEntry {
  h: number;
  s: number;
  l: number;
  rgb: [number, number, number];
}

/**
 * Checks whether two colors are perceptually distinct enough to be separate gradient stops.
 */
export function areColorsDistinct(c1: ColorEntry, c2: ColorEntry): boolean {
  // Angular hue difference (0 .. 180)
  const diffH = Math.min(Math.abs(c1.h - c2.h), 360 - Math.abs(c1.h - c2.h));
  // Lightness difference
  const diffL = Math.abs(c1.l - c2.l);
  // Euclidean RGB distance
  const dr = c1.rgb[0] - c2.rgb[0];
  const dg = c1.rgb[1] - c2.rgb[1];
  const db = c1.rgb[2] - c2.rgb[2];
  const rgbDist = Math.sqrt(dr * dr + dg * dg + db * db);

  return diffH >= 26 || (diffL >= 0.28 && c1.s > 0.18 && c2.s > 0.18) || rgbDist >= 62;
}

/**
 * Constructs a cohesive Material You / Monet theme and gradient from multiple key colors.
 */
export function buildMonetThemeFromMultiColors(colors: ColorEntry[]): MonetTheme {
  const primary = colors[0] || { h: 140, s: 0.6, l: 0.5, rgb: [70, 200, 110] };

  // 1. Check if the palette is completely monochrome / grayscale
  const maxSat = Math.max(...colors.map((c) => c.s));
  if (maxSat < 0.16) {
    const [gr, gg, gb] = hslToRgb(215, 0.05, 0.68);
    const [sr, sg, sb] = hslToRgb(215, 0.05, 0.50);
    const [tr, tg, tb] = hslToRgb(215, 0.04, 0.35);

    const pHex = rgbToHex(gr, gg, gb);
    const sHex = rgbToHex(sr, sg, sb);
    const tHex = rgbToHex(tr, tg, tb);

    return {
      accentColor: 'rgb(235, 240, 248)',
      accentHex: '#ebf0f8',
      glowRgb: `${gr}, ${gg}, ${gb}`,
      secondaryRgb: `${sr}, ${sg}, ${sb}`,
      tertiaryRgb: `${tr}, ${tg}, ${tb}`,
      rawSeedRgb: `${gr}, ${gg}, ${gb}`,
      palette: [pHex, sHex, tHex],
      gradient: `linear-gradient(135deg, rgb(${gr}, ${gg}, ${gb}) 0%, rgb(${sr}, ${sg}, ${sb}) 50%, rgb(${tr}, ${tg}, ${tb}) 100%)`,
      gradientRadial: `radial-gradient(circle at 30% 30%, rgba(${gr}, ${gg}, ${gb}, 0.55) 0%, rgba(${sr}, ${sg}, ${sb}, 0.28) 50%, rgba(${tr}, ${tg}, ${tb}, 0.06) 100%)`,
    };
  }

  // 2. Process Primary Key Color
  const boostS1 = Math.max(0.42, Math.min(0.96, primary.s * 1.2));
  // Accent for text: L ~ 0.70 - 0.78 for WCAG high contrast on dark surfaces
  const accentL = Math.max(0.68, Math.min(0.80, primary.l > 0.4 ? primary.l * 1.15 : 0.70));
  const [ar, ag, ab] = hslToRgb(primary.h, boostS1, accentL);
  // Glow RGB: midtone ~ 0.52 for volumetric bloom
  const [gr, gg, gb] = hslToRgb(primary.h, Math.max(0.55, boostS1), 0.52);

  // 3. Process Secondary Key Color (either extracted from cover or synthesized)
  let sr: number, sg: number, sb: number;
  if (colors.length > 1) {
    const secondary = colors[1];
    const boostS2 = Math.max(0.40, Math.min(0.94, secondary.s * 1.15));
    const targetL2 = Math.max(0.42, Math.min(0.62, secondary.l));
    [sr, sg, sb] = hslToRgb(secondary.h, boostS2, targetL2);
  } else {
    // Harmonic rotation +35 deg
    [sr, sg, sb] = hslToRgb((primary.h + 35) % 360, Math.max(0.44, boostS1 * 0.85), 0.48);
  }

  // 4. Process Tertiary Key Color
  let tr: number, tg: number, tb: number;
  if (colors.length > 2) {
    const tertiary = colors[2];
    const boostS3 = Math.max(0.38, Math.min(0.92, tertiary.s * 1.1));
    const targetL3 = Math.max(0.38, Math.min(0.58, tertiary.l));
    [tr, tg, tb] = hslToRgb(tertiary.h, boostS3, targetL3);
  } else {
    // Harmonic rotation -30 deg or +70 deg
    const h3 = colors.length > 1 ? (colors[1].h + 32) % 360 : (primary.h - 30 + 360) % 360;
    [tr, tg, tb] = hslToRgb(h3, Math.max(0.40, boostS1 * 0.75), 0.44);
  }

  const p1Hex = rgbToHex(gr, gg, gb);
  const p2Hex = rgbToHex(sr, sg, sb);
  const p3Hex = rgbToHex(tr, tg, tb);

  const gradient = `linear-gradient(135deg, rgb(${gr}, ${gg}, ${gb}) 0%, rgb(${sr}, ${sg}, ${sb}) 50%, rgb(${tr}, ${tg}, ${tb}) 100%)`;
  const gradientRadial = `radial-gradient(circle at 30% 30%, rgba(${gr}, ${gg}, ${gb}, 0.58) 0%, rgba(${sr}, ${sg}, ${sb}, 0.32) 52%, rgba(${tr}, ${tg}, ${tb}, 0.08) 100%)`;

  return {
    accentColor: `rgb(${ar}, ${ag}, ${ab})`,
    accentHex: rgbToHex(ar, ag, ab),
    glowRgb: `${gr}, ${gg}, ${gb}`,
    secondaryRgb: `${sr}, ${sg}, ${sb}`,
    tertiaryRgb: `${tr}, ${tg}, ${tb}`,
    rawSeedRgb: `${gr}, ${gg}, ${gb}`,
    palette: [p1Hex, p2Hex, p3Hex],
    gradient,
    gradientRadial,
  };
}

/**
 * Backward-compatible single HSL builder.
 */
export function buildMonetThemeFromHsl(h: number, s: number, l: number): MonetTheme {
  const rgb = hslToRgb(h, s, l);
  return buildMonetThemeFromMultiColors([{ h, s, l, rgb }]);
}

/**
 * Evaluates candidate colors from a comma-separated palette string
 * and extracts up to 3 distinct key colors to generate the theme and gradient.
 */
export function extractMonetThemeFromPalette(
  paletteString?: string | null,
  fallbackRgb = '112, 220, 85'
): MonetTheme {
  if (!paletteString || typeof paletteString !== 'string') {
    return buildDefaultTheme(fallbackRgb);
  }

  const rawHexes = paletteString
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('#'));

  if (rawHexes.length === 0) {
    return buildDefaultTheme(fallbackRgb);
  }

  const parsed: ColorEntry[] = [];
  for (const hex of rawHexes) {
    const rgb = parseHexToRgb(hex);
    if (!rgb) continue;
    const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    parsed.push({ h, s, l, rgb });
  }

  if (parsed.length === 0) {
    return buildDefaultTheme(fallbackRgb);
  }

  // Check if entire palette is grayscale
  const maxSat = Math.max(...parsed.map((c) => c.s));
  if (maxSat < 0.16) {
    return buildMonetThemeFromHsl(215, 0.05, 0.65);
  }

  // Score candidate colors: favors saturated, well-balanced midtones
  const scored = parsed
    .filter((c) => c.l >= 0.06 && c.l <= 0.94)
    .map((c) => {
      const lightnessScore = 1.0 - Math.abs(c.l - 0.52) * 1.6;
      const saturationScore = c.s * 2.5;
      const score = saturationScore + lightnessScore;
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return buildMonetThemeFromHsl(215, 0.05, 0.65);
  }

  // Select up to 3 distinct key colors from the palette
  const distinctColors: ColorEntry[] = [scored[0]];

  for (let i = 1; i < scored.length && distinctColors.length < 3; i++) {
    const candidate = scored[i];
    const isDistinctFromAll = distinctColors.every((selected) =>
      areColorsDistinct(candidate, selected)
    );
    if (isDistinctFromAll) {
      distinctColors.push(candidate);
    }
  }

  return buildMonetThemeFromMultiColors(distinctColors);
}

function buildDefaultTheme(fallbackRgb: string): MonetTheme {
  const parts = fallbackRgb.split(',').map((p) => parseInt(p.trim(), 10));
  const r = parts[0] ?? 112;
  const g = parts[1] ?? 220;
  const b = parts[2] ?? 85;
  const [h, s, l] = rgbToHsl(r, g, b);
  return buildMonetThemeFromHsl(h, s, l);
}

// In-memory cache for image-extracted themes
const imageThemeCache = new Map<string, MonetTheme>();

/**
 * Asynchronously extracts Monet theme and gradient from an image URL via offscreen canvas.
 * Samples distinct color clusters directly from the image pixels.
 */
export async function extractMonetFromImage(
  imageUrl?: string | null,
  fallbackPalette?: string | null
): Promise<MonetTheme> {
  if (fallbackPalette && typeof fallbackPalette === 'string' && fallbackPalette.trim().length > 0) {
    const theme = extractMonetThemeFromPalette(fallbackPalette);
    if (imageUrl) {
      imageThemeCache.set(imageUrl, theme);
    }
    return theme;
  }

  if (!imageUrl) {
    return buildDefaultTheme('112, 220, 85');
  }

  if (imageThemeCache.has(imageUrl)) {
    return imageThemeCache.get(imageUrl)!;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          const fallback = fallbackPalette
            ? extractMonetThemeFromPalette(fallbackPalette)
            : buildDefaultTheme('112, 220, 85');
          resolve(fallback);
          return;
        }

        const size = 32;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        let totalSat = 0;
        let validPixels = 0;

        // Bucket pixel colors with step quantizing to group similar tones
        interface Bucket {
          rgb: [number, number, number];
          h: number;
          s: number;
          l: number;
          count: number;
        }
        const bucketMap = new Map<string, Bucket>();

        for (let i = 0; i < data.length; i += 4 * 2) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;

          const [h, s, l] = rgbToHsl(r, g, b);
          totalSat += s;
          validPixels++;

          // Quantize to step of 20
          const qr = Math.round(r / 20) * 20;
          const qg = Math.round(g / 20) * 20;
          const qb = Math.round(b / 20) * 20;
          const key = `${qr},${qg},${qb}`;

          const existing = bucketMap.get(key);
          if (existing) {
            existing.count++;
          } else {
            bucketMap.set(key, { rgb: [qr, qg, qb], h, s, l, count: 1 });
          }
        }

        // Grayscale / monochrome detection
        const avgSat = validPixels > 0 ? totalSat / validPixels : 0;
        if (avgSat < 0.16) {
          const silverTheme = buildMonetThemeFromHsl(215, 0.05, 0.72);
          imageThemeCache.set(imageUrl, silverTheme);
          resolve(silverTheme);
          return;
        }

        // Score buckets by population weight and chromatic vibrance
        const scoredBuckets = Array.from(bucketMap.values())
          .filter((b) => b.l >= 0.06 && b.l <= 0.94 && b.s >= 0.14)
          .map((b) => {
            const lightnessScore = 1.0 - Math.abs(b.l - 0.52) * 1.5;
            const saturationScore = b.s * 2.6;
            const popScore = Math.log10(b.count + 1);
            const score = (saturationScore + lightnessScore) * 1.4 + popScore;
            return { ...b, score };
          })
          .sort((a, b) => b.score - a.score);

        if (scoredBuckets.length === 0) {
          const silverTheme = buildMonetThemeFromHsl(215, 0.05, 0.65);
          imageThemeCache.set(imageUrl, silverTheme);
          resolve(silverTheme);
          return;
        }

        // Select top 3 distinct color clusters from the image
        const distinctColors: ColorEntry[] = [
          { h: scoredBuckets[0].h, s: scoredBuckets[0].s, l: scoredBuckets[0].l, rgb: scoredBuckets[0].rgb },
        ];

        for (let i = 1; i < scoredBuckets.length && distinctColors.length < 3; i++) {
          const candidate = scoredBuckets[i];
          const entry: ColorEntry = { h: candidate.h, s: candidate.s, l: candidate.l, rgb: candidate.rgb };
          const isDistinct = distinctColors.every((selected) => areColorsDistinct(entry, selected));
          if (isDistinct) {
            distinctColors.push(entry);
          }
        }

        const theme = buildMonetThemeFromMultiColors(distinctColors);
        imageThemeCache.set(imageUrl, theme);
        resolve(theme);
      } catch {
        const fallback = fallbackPalette
          ? extractMonetThemeFromPalette(fallbackPalette)
          : buildDefaultTheme('112, 220, 85');
        resolve(fallback);
      }
    };

    img.onerror = () => {
      const fallback = fallbackPalette
        ? extractMonetThemeFromPalette(fallbackPalette)
        : buildDefaultTheme('112, 220, 85');
      resolve(fallback);
    };

    img.src = imageUrl;
  });
}
