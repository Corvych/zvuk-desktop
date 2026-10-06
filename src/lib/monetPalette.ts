/**
 * Monet Palette Engine (Material You style adaptive color system)
 * Extracts vibrant seed colors from artist palettes/avatars and generates
 * harmonious tonal accents, volumetric glow RGBs, and secondary auroras.
 */

export interface MonetTheme {
  accentColor: string;      // High-contrast readable color for typography & highlights: "rgb(r, g, b)"
  accentHex: string;        // Hex representation: "#rrggbb"
  glowRgb: string;          // Rich mid-tone RGB for volumetric box-shadows & glows: "r, g, b"
  secondaryRgb: string;     // Harmonious analogous RGB for multi-stop auroras: "r, g, b"
  tertiaryRgb: string;      // Third harmonic tone: "r, g, b"
  rawSeedRgb: string;       // Direct sampled color: "r, g, b"
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

/**
 * Given an HSL seed color, creates a cohesive Material You / Monet theme
 * tailored for modern dark surfaces.
 */
export function buildMonetThemeFromHsl(h: number, s: number, l: number): MonetTheme {
  // If saturation is low (monochrome, black & white, or grayscale image)
  // Produce a crisp, elegant platinum / cool silver aesthetic instead of turning into red
  if (s < 0.16) {
    const [gr, gg, gb] = hslToRgb(215, 0.06, 0.68);
    const [sr, sg, sb] = hslToRgb(215, 0.05, 0.52);
    const [tr, tg, tb] = hslToRgb(215, 0.04, 0.38);

    return {
      accentColor: 'rgb(235, 240, 248)',
      accentHex: '#ebf0f8',
      glowRgb: `${gr}, ${gg}, ${gb}`,
      secondaryRgb: `${sr}, ${sg}, ${sb}`,
      tertiaryRgb: `${tr}, ${tg}, ${tb}`,
      rawSeedRgb: `${gr}, ${gg}, ${gb}`,
    };
  }

  // Boost chroma slightly so pastel or muted avatars come alive, but keep natural
  const boostS = Math.max(0.38, Math.min(0.96, s * 1.2));

  // 1. Accent for text on dark theme: Lightness ~ 0.68 - 0.76 ensures APCA/WCAG high readability
  const targetAccentL = Math.max(0.66, Math.min(0.78, l > 0.4 ? l * 1.15 : 0.68));
  const [ar, ag, ab] = hslToRgb(h, boostS, targetAccentL);

  // 2. Glow RGB: Rich midtone ~ 0.52 L provides strong saturated volumetric lighting
  const [gr, gg, gb] = hslToRgb(h, Math.max(0.55, boostS), 0.52);

  // 3. Secondary analogous hue (+28 degrees) for atmospheric gradient depth
  const [sr, sg, sb] = hslToRgb((h + 28) % 360, Math.max(0.42, boostS * 0.85), 0.48);

  // 4. Tertiary complementary/analogous hue (-24 degrees)
  const [tr, tg, tb] = hslToRgb((h - 24 + 360) % 360, Math.max(0.38, boostS * 0.75), 0.44);

  return {
    accentColor: `rgb(${ar}, ${ag}, ${ab})`,
    accentHex: rgbToHex(ar, ag, ab),
    glowRgb: `${gr}, ${gg}, ${gb}`,
    secondaryRgb: `${sr}, ${sg}, ${sb}`,
    tertiaryRgb: `${tr}, ${tg}, ${tb}`,
    rawSeedRgb: `${gr}, ${gg}, ${gb}`,
  };
}

/**
 * Evaluates candidate colors and selects the best Monet seed color.
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

  const parsed = rawHexes
    .map((hex) => {
      const rgb = parseHexToRgb(hex);
      if (!rgb) return null;
      const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      return { hex, rgb, h, s, l };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (parsed.length === 0) {
    return buildDefaultTheme(fallbackRgb);
  }

  // Check maximum saturation across the palette
  const maxSat = Math.max(...parsed.map((c) => c.s));
  if (maxSat < 0.18) {
    // Entire palette is monochrome / grayscale
    return buildMonetThemeFromHsl(215, 0.05, 0.65);
  }

  // Parse and score candidates that have genuine color
  let bestScore = -Infinity;
  let bestHsl: [number, number, number] | null = null;

  for (const item of parsed) {
    const { h, s, l } = item;

    // Discard near blacks, washed-out whites, and low-saturation grays
    if (l < 0.08 || l > 0.94 || s < 0.18) {
      continue;
    }

    // Monet scoring:
    // Higher saturation gets large bonus
    // Balanced lightness around 0.45-0.65 gets bonus
    const lightnessScore = 1 - Math.abs(l - 0.55) * 1.5;
    const saturationScore = s * 2.5;
    const score = saturationScore + lightnessScore;

    if (score > bestScore) {
      bestScore = score;
      bestHsl = [h, s, l];
    }
  }

  if (bestHsl && bestScore > 0.35) {
    return buildMonetThemeFromHsl(bestHsl[0], bestHsl[1], bestHsl[2]);
  }

  // If no vibrant candidate qualified, use silver/platinum
  return buildMonetThemeFromHsl(215, 0.05, 0.65);
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
 * Asynchronously extracts Monet theme from an image avatar URL via offscreen canvas.
 * Inspects real image pixel data first to detect black-and-white photos accurately.
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

        // Collect color buckets
        const hexMap = new Map<string, number>();
        for (let i = 0; i < data.length; i += 4 * 2) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;

          const [, s] = rgbToHsl(r, g, b);
          totalSat += s;
          validPixels++;

          // Quantize to reduce noise
          const qr = Math.round(r / 20) * 20;
          const qg = Math.round(g / 20) * 20;
          const qb = Math.round(b / 20) * 20;
          const hex = rgbToHex(qr, qg, qb);
          hexMap.set(hex, (hexMap.get(hex) || 0) + 1);
        }

        // If average saturation across the entire avatar is very low, it's black-and-white / grayscale!
        const avgSat = validPixels > 0 ? totalSat / validPixels : 0;
        if (avgSat < 0.16) {
          const silverTheme = buildMonetThemeFromHsl(215, 0.05, 0.72);
          imageThemeCache.set(imageUrl, silverTheme);
          resolve(silverTheme);
          return;
        }

        const sortedHexes = Array.from(hexMap.entries())
          .sort((a, b) => b[1] - a[1])
          .map((e) => e[0]);

        const theme = extractMonetThemeFromPalette(sortedHexes.join(','));
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
