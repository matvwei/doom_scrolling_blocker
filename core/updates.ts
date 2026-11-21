export const GITHUB_RELEASES_URL =
  'https://github.com/matvwei/doom_scrolling_blocker/releases/latest';

const LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/matvwei/doom_scrolling_blocker/releases/latest';

export interface GitHubRelease {
  version: string;
  url: string;
}

function versionParts(version: string): number[] | null {
  const match = /^v?(\d+(?:\.\d+){0,3})(?:[-+].*)?$/.exec(version.trim());
  if (!match) return null;
  const parts = match[1]!.split('.').map(Number);
  while (parts.length < 4) parts.push(0);
  return parts;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = versionParts(candidate);
  const currentParts = versionParts(current);
  if (!candidateParts || !currentParts) return false;

  for (let index = 0; index < currentParts.length; index += 1) {
    const difference = candidateParts[index]! - currentParts[index]!;
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export async function fetchLatestRelease(
  fetcher: typeof fetch = fetch,
): Promise<GitHubRelease> {
  const response = await fetcher(LATEST_RELEASE_API_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`);

  const data = (await response.json()) as { tag_name?: unknown };
  if (typeof data.tag_name !== 'string' || !versionParts(data.tag_name)) {
    throw new Error('GitHub release has no valid version tag');
  }
  return { version: data.tag_name.replace(/^v/, ''), url: GITHUB_RELEASES_URL };
}
