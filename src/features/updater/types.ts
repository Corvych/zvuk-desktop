export interface GitHubAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
  content_type?: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at: string;
  html_url: string;
  assets: GitHubAsset[];
}

export interface UpdateInfo {
  version: string;
  tagName: string;
  name: string;
  body: string;
  publishedAt: string | null;
  htmlUrl: string;
  downloadUrl: string;
  assetName?: string;
  assetSize?: number;
  isPrerelease: boolean;
}

export interface CheckUpdateResult {
  hasUpdate: boolean;
  currentVersion: string;
  updateInfo: UpdateInfo | null;
}

export interface DownloadProgressPayload {
  downloaded: number;
  total: number;
  percentage: number;
}

