export type AutomaticUpdateStatus =
  | 'update_available'
  | 'no_update'
  | 'throttled'
  | 'unavailable';

export function getInstalledVersion(): string {
  return chrome.runtime.getManifest().version;
}

export async function requestAutomaticUpdate(): Promise<AutomaticUpdateStatus> {
  if (typeof chrome.runtime.requestUpdateCheck !== 'function') return 'unavailable';
  try {
    const result = await chrome.runtime.requestUpdateCheck();
    return result.status;
  } catch {
    return 'unavailable';
  }
}
