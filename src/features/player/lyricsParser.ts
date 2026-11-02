export interface LyricWord {
  text: string;
  time: number;
  endTime: number;
  hasSpaceAfter?: boolean;
}

export interface LyricLine {
  time?: number; // seconds
  endTime?: number;
  text: string;
  words: LyricWord[];
  hasEnhancedTimings: boolean;
  isInstrumental?: boolean;
}

interface WordBoundary {
  word: string;
  startIndex: number;
  endIndex: number;
  boundaryFrac: number;
  nextWordStartFrac: number;
  pauseWeight: number;
}

export function extractWordBoundaries(text: string): WordBoundary[] {
  const len = text.length;
  if (len === 0) return [];

  const regex = /\S+/g;
  const matches = [...text.matchAll(regex)];
  if (matches.length === 0) return [];

  const boundaries: WordBoundary[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const word = m[0];
    const startIndex = m.index!;
    const endIndex = startIndex + word.length;
    const boundaryFrac = endIndex / len;

    const nextMatch = matches[i + 1];
    const nextWordStartFrac = nextMatch ? nextMatch.index! / len : 1.0;

    const hasStrongPunctuation = /[,\.\?!:;\u2014\-]/.test(word[word.length - 1]);
    const hasEllipsis = word.includes('...') || word.includes('…');
    const pauseWeight = hasEllipsis ? 2.8 : hasStrongPunctuation ? 2.0 : 1.0;

    boundaries.push({
      word,
      startIndex,
      endIndex,
      boundaryFrac,
      nextWordStartFrac,
      pauseWeight,
    });
  }
  return boundaries;
}

/**
 * Parses NetEase Cloud Music YRC karaoke lyric format (inline tag style or JSON format).
 */
export function parseYrcLyrics(rawLyrics: string, isSynced: boolean): LyricLine[] {
  if (!rawLyrics || !rawLyrics.trim()) return [];

  const lines: LyricLine[] = [];
  const trimmed = rawLyrics.trim();

  // 1. Try parsing JSON format if it looks like JSON array or object
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const lyricArr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.lyric)
        ? parsed.lyric
        : null;

      if (Array.isArray(lyricArr) && lyricArr.length > 0) {
        for (const item of lyricArr) {
          if (!item || typeof item !== 'object') continue;
          const lineStartSec = (typeof item.t === 'number' ? item.t : 0) / 1000;
          const c = item.c;
          if (Array.isArray(c) && c.length > 0) {
            const words: LyricWord[] = [];
            let fullText = '';
            for (let j = 0; j < c.length; j++) {
              const charObj = c[j];
              const rawTx = charObj.tx ?? charObj.text ?? '';
              if (!rawTx) continue;
              const wStart = (typeof charObj.t === 'number' ? charObj.t : 0) / 1000;
              const wDur = (typeof charObj.d === 'number' ? charObj.d : 200) / 1000;
              const wEnd = wStart + wDur;

              const hasTrailingSpace = /\s+$/.test(rawTx);
              const cleanTx = rawTx.trim();
              if (!cleanTx) continue;

              const isCjk = /[\u4e00-\u9fa5\u3040-\u30ff]/.test(cleanTx);
              const hasSpaceAfter =
                hasTrailingSpace || (!isCjk && j < c.length - 1 && !cleanTx.endsWith('-'));

              fullText +=
                (fullText && !fullText.endsWith(' ') && (hasSpaceAfter || !isCjk) ? ' ' : '') + cleanTx;
              words.push({
                text: cleanTx,
                time: wStart,
                endTime: wEnd,
                hasSpaceAfter,
              });
            }

            if (words.length > 0) {
              const lastWord = words[words.length - 1];
              lines.push({
                time: lineStartSec,
                endTime: lastWord.endTime,
                text: fullText.trim(),
                words,
                hasEnhancedTimings: true,
              });
            }
          }
        }

        if (lines.length > 0) {
          if (isSynced) {
            const split = splitLinesOnWordBreaks(lines, 4.0);
            return insertInstrumentalBreaks(split, 4.0);
          }
          return lines;
        }
      }
    } catch {
      // Not JSON or parse error, fall through to inline tag style
    }
  }

  // 2. Parse inline tag style: [lineStartMs,lineDurMs](wordStartMs,wordDurMs,flag)text...
  const rawLines = rawLyrics.split('\n');
  const lineTagRegex = /^\[(\d+),(\d+)\](.*)$/;
  const wordTagRegex = /\((\d+),(\d+),\d+\)([^(\n]*)/g;

  for (const rawLine of rawLines) {
    const lTrim = rawLine.trim();
    if (!lTrim) continue;

    const lineMatch = lTrim.match(lineTagRegex);
    if (!lineMatch) {
      // Skip metadata headers like [ti:...], [ar:...], etc.
      continue;
    }

    const lineStartMs = parseInt(lineMatch[1], 10);
    const lineDurMs = parseInt(lineMatch[2], 10);
    const lineStartSec = lineStartMs / 1000;
    const lineEndSec = (lineStartMs + lineDurMs) / 1000;
    const content = lineMatch[3];

    const wordMatches = [...content.matchAll(wordTagRegex)];
    if (wordMatches.length > 0) {
      const words: LyricWord[] = [];
      let fullText = '';

      for (let j = 0; j < wordMatches.length; j++) {
        const wm = wordMatches[j];
        const wStartMs = parseInt(wm[1], 10);
        const wDurMs = parseInt(wm[2], 10);
        const rawWordText = wm[3];

        const wStartSec = wStartMs / 1000;
        const wEndSec = (wStartMs + wDurMs) / 1000;

        const hasTrailingSpace = /\s+$/.test(rawWordText);
        const cleanWordText = rawWordText.trim();
        if (!cleanWordText) continue;

        const isCjk = /[\u4e00-\u9fa5\u3040-\u30ff]/.test(cleanWordText);
        const hasSpaceAfter =
          hasTrailingSpace || (!isCjk && j < wordMatches.length - 1 && !cleanWordText.endsWith('-'));

        fullText +=
          (fullText && !fullText.endsWith(' ') && (hasSpaceAfter || !isCjk) ? ' ' : '') + cleanWordText;
        words.push({
          text: cleanWordText,
          time: wStartSec,
          endTime: wEndSec,
          hasSpaceAfter,
        });
      }

      if (words.length > 0) {
        const lastWord = words[words.length - 1];
        lines.push({
          time: lineStartSec,
          endTime: Math.max(lineEndSec, lastWord.endTime),
          text: fullText.trim(),
          words,
          hasEnhancedTimings: true,
        });
      }
    } else {
      const cleanText = content.replace(/\(\d+,\d+,\d+\)/g, '').trim();
      if (cleanText) {
        lines.push({
          time: lineStartSec,
          endTime: lineEndSec > lineStartSec ? lineEndSec : lineStartSec + 3.0,
          text: cleanText,
          words: cleanText
            .split(/\s+/)
            .map((w) => ({ text: w, time: 0, endTime: 0, hasSpaceAfter: true })),
          hasEnhancedTimings: false,
        });
      }
    }
  }

  if (lines.length > 0) {
    if (isSynced) {
      const split = splitLinesOnWordBreaks(lines, 4.0);
      return insertInstrumentalBreaks(split, 4.0);
    }
    return lines;
  }

  return [];
}

export function parseLyrics(rawLyrics: string, isSynced: boolean): LyricLine[] {
  if (!rawLyrics) return [];

  // 1. Check for TTML (Apple Music / Better Lyrics word-by-word or line sync)
  const isTtml = rawLyrics.includes('<tt') || /<p\s+begin=/i.test(rawLyrics);
  if (isTtml) {
    const parseTtmlTime = (str: string): number => {
      if (!str) return 0;
      const parts = str.trim().split(':');
      if (parts.length === 1) return parseFloat(parts[0]) || 0;
      if (parts.length === 2) return parseInt(parts[0], 10) * 60 + (parseFloat(parts[1]) || 0);
      if (parts.length === 3)
        return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + (parseFloat(parts[2]) || 0);
      return 0;
    };

    const pRegex = /<p\s+begin="([^"]+)"(?:[^>]*end="([^"]+)")?[^>]*>([\s\S]*?)<\/p>/gi;
    const spanRegex = /<span\s+begin="([^"]+)"(?:[^>]*end="([^"]+)")?[^>]*>([\s\S]*?)<\/span>/gi;
    const result: LyricLine[] = [];
    let pMatch: RegExpExecArray | null;

    while ((pMatch = pRegex.exec(rawLyrics)) !== null) {
      const lineStart = parseTtmlTime(pMatch[1]);
      const lineEnd = pMatch[2] ? parseTtmlTime(pMatch[2]) : undefined;
      const inner = pMatch[3];

      const spans = [...inner.matchAll(spanRegex)];
      if (spans.length > 0) {
        const words: LyricWord[] = [];
        let fullText = '';

        for (let j = 0; j < spans.length; j++) {
          const sp = spans[j];
          const wStart = parseTtmlTime(sp[1]);
          const wEnd = sp[2]
            ? parseTtmlTime(sp[2])
            : j < spans.length - 1
            ? parseTtmlTime(spans[j + 1][1])
            : lineEnd ?? wStart + 1.0;
          const wText = sp[3].replace(/<[^>]+>/g, '').trim();
          if (!wText) continue;

          fullText += (fullText ? ' ' : '') + wText;
          words.push({
            text: wText,
            time: wStart,
            endTime: wEnd,
            hasSpaceAfter: j < spans.length - 1 && !/[\u4e00-\u9fa5]/.test(wText),
          });
        }

        const cleanFull = fullText.trim();
        if (cleanFull) {
          result.push({
            time: lineStart,
            endTime: lineEnd ?? words[words.length - 1]?.endTime,
            text: cleanFull,
            words,
            hasEnhancedTimings: true,
          });
        }
      } else {
        const cleanText = inner.replace(/<[^>]+>/g, '').trim();
        if (cleanText) {
          result.push({
            time: lineStart,
            endTime: lineEnd,
            text: cleanText,
            words: cleanText.split(/\s+/).map((w) => ({ text: w, time: 0, endTime: 0, hasSpaceAfter: true })),
            hasEnhancedTimings: false,
          });
        }
      }
    }
    if (result.length > 0) {
      if (isSynced) {
        const split = splitLinesOnWordBreaks(result, 4.0);
        return insertInstrumentalBreaks(split, 4.0);
      }
      return result;
    }
  }

  // 2. Check for NetEase YRC format (inline tag style or JSON format)
  const isYrc =
    /\[\d+,\d+\]\s*\(\d+,\d+,\d+\)/.test(rawLyrics) ||
    /"c"\s*:\s*\[\s*\{[^}]*"tx"/.test(rawLyrics) ||
    /^\s*\[\s*\{\s*"t"\s*:/.test(rawLyrics) ||
    /^\s*\{\s*"version"\s*:/.test(rawLyrics);

  if (isYrc) {
    const yrcResult = parseYrcLyrics(rawLyrics, isSynced);
    if (yrcResult.length > 0) {
      return yrcResult;
    }
  }

  // 3. Standard or Enhanced LRC parsing
  const lines = rawLyrics.split('\n');
  const tempLines: { time?: number; rawText: string }[] = [];
  const lineTimeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  const tagOrWordRegex = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>([^<]*)/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      tempLines.push({ rawText: '' });
      continue;
    }

    const matches = [...trimmed.matchAll(lineTimeRegex)];
    if (matches.length > 0) {
      const cleanWithoutLineTags = trimmed.replace(lineTimeRegex, '').trim();
      if (!cleanWithoutLineTags) continue;

      for (const match of matches) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
        const totalSeconds = min * 60 + sec + ms / 1000;
        tempLines.push({ time: totalSeconds, rawText: cleanWithoutLineTags });
      }
    } else if (!isSynced) {
      tempLines.push({ rawText: trimmed });
    }
  }

  const sortedLines =
    isSynced && tempLines.some((r) => r.time !== undefined)
      ? tempLines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
      : tempLines;

  const result: LyricLine[] = [];
  for (let i = 0; i < sortedLines.length; i++) {
    const curr = sortedLines[i];
    const next = sortedLines[i + 1];
    const lineTime = curr.time;
    const rawText = curr.rawText;

    if (!rawText) continue;

    const enhancedMatches = [...rawText.matchAll(tagOrWordRegex)];
    if (enhancedMatches.length > 0) {
      const words: LyricWord[] = [];
      let fullText = '';

      for (let j = 0; j < enhancedMatches.length; j++) {
        const m = enhancedMatches[j];
        const min = parseInt(m[1], 10);
        const sec = parseInt(m[2], 10);
        const ms = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
        const wordStart = min * 60 + sec + ms / 1000;
        const wordText = m[4].trim();

        let wordEnd = wordStart + Math.max(0.25, wordText.length * 0.08);
        if (j < enhancedMatches.length - 1) {
          const nm = enhancedMatches[j + 1];
          const nMin = parseInt(nm[1], 10);
          const nSec = parseInt(nm[2], 10);
          const nMs = nm[3] ? parseInt(nm[3].padEnd(3, '0').slice(0, 3), 10) : 0;
          wordEnd = nMin * 60 + nSec + nMs / 1000;
        } else if (next && next.time !== undefined) {
          wordEnd = Math.min(next.time, wordStart + 2.5);
        }

        fullText += (fullText ? ' ' : '') + wordText;
        words.push({
          text: wordText,
          time: wordStart,
          endTime: wordEnd,
          hasSpaceAfter: j < enhancedMatches.length - 1,
        });
      }

      result.push({
        time: lineTime,
        endTime: next?.time ?? words[words.length - 1]?.endTime,
        text: fullText.trim(),
        words,
        hasEnhancedTimings: true,
      });
    } else {
      const cleanText = rawText.replace(/<[^>]+>/g, '').trim();
      const rawWords = cleanText.split(/\s+/).filter(Boolean);
      const lineDuration =
        next && next.time !== undefined && lineTime !== undefined
          ? Math.max(1.0, next.time - lineTime)
          : 3.5;

      const words: LyricWord[] = [];
      const boundaries = extractWordBoundaries(cleanText);

      if (lineTime !== undefined && boundaries.length === rawWords.length) {
        let totalPauseWeight = 0;
        for (const b of boundaries) {
          totalPauseWeight += b.pauseWeight;
        }

        let accumulatedTime = lineTime;
        for (let w = 0; w < boundaries.length; w++) {
          const b = boundaries[w];
          const weightFrac = totalPauseWeight > 0 ? b.pauseWeight / totalPauseWeight : 1 / boundaries.length;
          const wordSlot = lineDuration * weightFrac;
          const pronunciationTime = wordSlot * 0.85;

          const wStart = accumulatedTime;
          const wEnd = accumulatedTime + pronunciationTime;
          accumulatedTime += wordSlot;

          words.push({
            text: b.word,
            time: wStart,
            endTime: wEnd,
            hasSpaceAfter: w < boundaries.length - 1,
          });
        }
      } else {
        for (let w = 0; w < rawWords.length; w++) {
          words.push({
            text: rawWords[w],
            time: 0,
            endTime: 0,
            hasSpaceAfter: w < rawWords.length - 1,
          });
        }
      }

      result.push({
        time: lineTime,
        endTime: next?.time ?? (lineTime !== undefined ? lineTime + lineDuration : undefined),
        text: cleanText,
        words,
        hasEnhancedTimings: false,
      });
    }
  }

  if (isSynced && result.length > 0) {
    const split = splitLinesOnWordBreaks(result, 4.0);
    return insertInstrumentalBreaks(split, 4.0);
  }

  return result;
}

/**
 * Splits lines if there is a large instrumental gap (>= 4s) between words within a single line.
 */
export function splitLinesOnWordBreaks(lines: LyricLine[], minWordGap = 4.0): LyricLine[] {
  const result: LyricLine[] = [];
  for (const line of lines) {
    if (!line.hasEnhancedTimings || line.words.length <= 1) {
      result.push(line);
      continue;
    }

    let currentWords: LyricWord[] = [];
    let currentLineStart = line.time ?? line.words[0].time;

    for (let w = 0; w < line.words.length; w++) {
      const word = line.words[w];
      currentWords.push(word);

      if (w < line.words.length - 1) {
        const nextWord = line.words[w + 1];
        const gap = nextWord.time - word.endTime;
        if (gap >= minWordGap) {
          const textSlice = currentWords.map((cw) => cw.text).join(' ').trim();
          result.push({
            time: currentLineStart,
            endTime: word.endTime,
            text: textSlice,
            words: currentWords,
            hasEnhancedTimings: true,
          });
          currentWords = [];
          currentLineStart = nextWord.time;
        }
      }
    }

    if (currentWords.length > 0) {
      const textSlice = currentWords.map((cw) => cw.text).join(' ').trim();
      result.push({
        time: currentLineStart,
        endTime: line.endTime ?? currentWords[currentWords.length - 1].endTime,
        text: textSlice,
        words: currentWords,
        hasEnhancedTimings: true,
      });
    }
  }
  return result;
}

/**
 * Inserts instrumental break lines for song intros and interludes between lyric lines.
 */
export function insertInstrumentalBreaks(lines: LyricLine[], minBreakDuration = 4.0): LyricLine[] {
  if (lines.length === 0) return lines;

  const withBreaks: LyricLine[] = [];

  // 1. Intro break (before line 0):
  const firstLine = lines[0];
  if (firstLine.time !== undefined && firstLine.time >= minBreakDuration) {
    withBreaks.push({
      time: 0,
      endTime: firstLine.time,
      text: '',
      words: [],
      hasEnhancedTimings: false,
      isInstrumental: true,
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const curr = lines[i];
    withBreaks.push(curr);

    if (i < lines.length - 1) {
      const next = lines[i + 1];
      if (curr.time !== undefined && next.time !== undefined) {
        let currEnd = curr.endTime;
        if (currEnd === undefined && curr.words.length > 0) {
          const lastWord = curr.words[curr.words.length - 1];
          if (lastWord.endTime > 0) {
            currEnd = lastWord.endTime;
          }
        }
        if (currEnd === undefined) {
          const diff = next.time - curr.time;
          currEnd = curr.time + Math.min(3.8, Math.max(1.5, diff * 0.7));
        }

        const gap = next.time - currEnd;
        if (gap >= minBreakDuration) {
          withBreaks.push({
            time: currEnd,
            endTime: next.time,
            text: '',
            words: [],
            hasEnhancedTimings: false,
            isInstrumental: true,
          });
        }
      }
    }
  }

  return withBreaks;
}

