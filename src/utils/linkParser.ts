import { resolveRedirect } from '../api';

export type ZvukObjectType = 'track' | 'artist' | 'release' | 'playlist';

export interface ParsedZvukLink {
  type: ZvukObjectType;
  id: string;
  cleanUrl: string;
  originalInput: string;
}

/**
 * Extracts a potential URL or URI scheme from raw text (e.g. from clipboard or drag/drop).
 */
export function extractUrlFromText(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();

  // 1. Direct standard URL match
  const urlMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) return urlMatch[0];

  // 2. Custom app protocol: zvukapp://... or zvuk://...
  const schemeMatch = trimmed.match(/(?:zvuk(?:app)?):\/\/[^\s"'<>]+/i);
  if (schemeMatch) return schemeMatch[0];

  // 3. URLs starting without protocol (e.g. zvuk.com/... or share.zvuk.com/...)
  const domainMatch = trimmed.match(
    /(?:(?:share\.)?zvuk\.com|zvk\.onelink\.me|[a-zA-Z0-9-]+\.onelink\.me)\/[^\s"'<>]+/i
  );
  if (domainMatch) return `https://${domainMatch[0]}`;

  return null;
}

function normalizeType(rawType: string): ZvukObjectType | null {
  const lower = rawType.toLowerCase().replace(/^(?:open[-_]?)/, '');
  if (lower === 'track') return 'track';
  if (lower === 'artist') return 'artist';
  if (lower === 'release' || lower === 'album') return 'release';
  if (lower === 'playlist') return 'playlist';
  return null;
}

function buildCleanUrl(type: ZvukObjectType, id: string): string {
  return `https://zvuk.com/${type}/${id}`;
}

/**
 * Synchronous parser for Zvuk links.
 * Handles:
 * 1. Direct zvuk.com links: https://zvuk.com/track/54100868 (with or without query params)
 * 2. Deep links: zvukapp://track/54100868
 * 3. AppsFlyer onelink parameters (af_web_dp, af_ios_url, af_android_url, or action_name + id)
 */
export function parseZvukLinkSync(input: string): ParsedZvukLink | null {
  const urlStr = extractUrlFromText(input);
  if (!urlStr) return null;

  // 1. Try matching standard web zvuk.com links: /track/123, /artist/123, /release/123, /album/123, /playlist/123
  const directMatch = urlStr.match(
    /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?zvuk\.com\/(track|artist|release|album|playlist)\/([a-zA-Z0-9_-]+)/i
  );
  if (directMatch) {
    const rawType = directMatch[1];
    const id = directMatch[2];
    const type = normalizeType(rawType);
    if (type && id) {
      return {
        type,
        id,
        cleanUrl: buildCleanUrl(type, id),
        originalInput: input,
      };
    }
  }

  // 2. Try matching custom deep link scheme: zvuk://... or zvukapp://...
  const deepMatch = urlStr.match(
    /(?:zvuk(?:app)?):\/\/(?:open\/)?(track|artist|release|album|playlist)\/([a-zA-Z0-9_-]+)/i
  );
  if (deepMatch) {
    const type = normalizeType(deepMatch[1]);
    const id = deepMatch[2];
    if (type && id) {
      return {
        type,
        id,
        cleanUrl: buildCleanUrl(type, id),
        originalInput: input,
      };
    }
  }

  // 3. Inspect query parameters (e.g. for zvk.onelink.me or zvuk links with query strings)
  try {
    const parsedUrl = new URL(urlStr.startsWith('zvuk') ? `https://${urlStr}` : urlStr);
    const searchParams = parsedUrl.searchParams;

    // Check embedded target URLs in params (af_web_dp, af_ios_url, af_android_url, af_dp)
    const embeddedCandidates = [
      searchParams.get('af_web_dp'),
      searchParams.get('af_ios_url'),
      searchParams.get('af_android_url'),
      searchParams.get('af_dp'),
    ];

    for (const cand of embeddedCandidates) {
      if (cand) {
        const decoded = decodeURIComponent(cand);
        // Recursively parse the embedded target URL
        const parsed = parseZvukLinkSync(decoded);
        if (parsed) {
          return {
            ...parsed,
            originalInput: input,
          };
        }
      }
    }

    // Check action_name + id parameters (e.g. action_name=open-track&id=175530947)
    const actionName = searchParams.get('action_name') || searchParams.get('action');
    const paramId = searchParams.get('id');
    if (actionName && paramId) {
      const type = normalizeType(actionName);
      if (type) {
        return {
          type,
          id: paramId,
          cleanUrl: buildCleanUrl(type, paramId),
          originalInput: input,
        };
      }
    }
  } catch {
    // URL parsing failed; not a valid URL
  }

  return null;
}

/**
 * Checks if a string looks like a redirecting Zvuk link (e.g. share.zvuk.com or onelink short link).
 */
export function isRedirectLink(input: string): boolean {
  const urlStr = extractUrlFromText(input);
  if (!urlStr) return false;
  return /share\.zvuk\.com|onelink\.me/i.test(urlStr);
}

/**
 * Comprehensive parser for Zvuk links.
 * If sync parsing succeeds, returns immediately.
 * If input is a short/redirect link (e.g. https://share.zvuk.com/cLQ0/4wc1wk8k),
 * resolves HTTP 301 via backend and parses the resolved target URL.
 */
export async function parseZvukLink(input: string): Promise<ParsedZvukLink | null> {
  if (!input) return null;

  // 1. Try sync parsing first
  const syncResult = parseZvukLinkSync(input);
  if (syncResult) return syncResult;

  // 2. If it's a redirect link, resolve 301 via backend
  const urlStr = extractUrlFromText(input);
  if (urlStr && isRedirectLink(urlStr)) {
    try {
      const resolvedUrl = await resolveRedirect(urlStr);
      if (resolvedUrl && resolvedUrl !== urlStr) {
        const resolvedParsed = parseZvukLinkSync(resolvedUrl);
        if (resolvedParsed) {
          return {
            ...resolvedParsed,
            originalInput: input,
          };
        }
      }
    } catch (err) {
      console.warn('[linkParser] Failed to resolve redirect for:', urlStr, err);
    }
  }

  return null;
}

