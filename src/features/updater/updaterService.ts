import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '../../api';
import type { GitHubRelease, UpdateInfo, CheckUpdateResult } from './types';

export const GITHUB_REPO = 'Corvych/zvuk-desktop';
export const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`;

/**
 * Returns current application version.
 */
export async function getAppVersion(): Promise<string> {
  if (isTauri()) {
    try {
      const v = await getVersion();
      if (v) return v;
    } catch {
      // Fallback below
    }
  }
  if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
    return __APP_VERSION__;
  }
  return '0.0.4';
}

/**
 * Compares two semver version strings (e.g. "0.0.5" vs "0.0.4").
 * Returns:
 *  1 if v1 > v2
 * -1 if v1 < v2
 *  0 if v1 === v2
 */
export function compareVersions(v1: string, v2: string): number {
  const clean1 = v1.replace(/^[vV]/, '').trim();
  const clean2 = v2.replace(/^[vV]/, '').trim();

  const [main1, pre1] = clean1.split('-');
  const [main2, pre2] = clean2.split('-');

  const parts1 = main1.split('.').map((p) => parseInt(p, 10) || 0);
  const parts2 = main2.split('.').map((p) => parseInt(p, 10) || 0);

  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] ?? 0;
    const num2 = parts2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }

  // Handle prereleases (release without pre is newer than release with pre)
  if (pre1 && !pre2) return -1;
  if (!pre1 && pre2) return 1;
  if (pre1 && pre2) {
    return pre1.localeCompare(pre2);
  }

  return 0;
}

/**
 * Formats byte size into human readable string.
 */
export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

/**
 * Formats ISO date string into Russian locale.
 */
export function formatReleaseDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * Checks GitHub releases for updates.
 */
export async function fetchGitHubReleases(): Promise<GitHubRelease[]> {
  const response = await fetch(GITHUB_RELEASES_URL, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'zvuk-desktop',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API returned status ${response.status}: ${response.statusText}`);
  }

  const releases: GitHubRelease[] = await response.json();
  return releases;
}

/**
 * Extracts best UpdateInfo from a GitHubRelease.
 */
export function extractUpdateInfo(release: GitHubRelease): UpdateInfo {
  const version = release.tag_name.replace(/^[vV]/, '');

  // Look for preferred Windows installer (.exe setup, then .msi, then any asset)
  const exeAsset = release.assets.find((a) => a.name.toLowerCase().endsWith('.exe'));
  const msiAsset = release.assets.find((a) => a.name.toLowerCase().endsWith('.msi'));
  const otherAsset = release.assets[0];

  const chosenAsset = exeAsset || msiAsset || otherAsset;

  return {
    version,
    tagName: release.tag_name,
    name: release.name || `Релиз ${release.tag_name}`,
    body: release.body || '',
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    downloadUrl: chosenAsset ? chosenAsset.browser_download_url : release.html_url,
    assetName: chosenAsset?.name,
    assetSize: chosenAsset?.size,
    isPrerelease: release.prerelease,
  };
}

/**
 * Full check for updates against current app version.
 */
export async function checkAvailableUpdate(): Promise<CheckUpdateResult> {
  const currentVersion = await getAppVersion();
  const releases = await fetchGitHubReleases();

  // Filter out drafts
  const validReleases = releases.filter((r) => !r.draft);
  if (validReleases.length === 0) {
    return { hasUpdate: false, currentVersion, updateInfo: null };
  }

  // Sort releases by semver descending
  validReleases.sort((a, b) => {
    const vA = a.tag_name.replace(/^[vV]/, '');
    const vB = b.tag_name.replace(/^[vV]/, '');
    return compareVersions(vB, vA);
  });

  const newestRelease = validReleases[0];
  const newestVersion = newestRelease.tag_name.replace(/^[vV]/, '');

  const isNewer = compareVersions(newestVersion, currentVersion) > 0;

  if (isNewer) {
    const updateInfo = extractUpdateInfo(newestRelease);
    return {
      hasUpdate: true,
      currentVersion,
      updateInfo,
    };
  }

  return {
    hasUpdate: false,
    currentVersion,
    updateInfo: null,
  };
}
