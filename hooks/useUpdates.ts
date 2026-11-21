import { useEffect, useState } from 'react';
import { getInstalledVersion, requestAutomaticUpdate } from '../adapters/updates';
import { fetchLatestRelease, isNewerVersion } from '../core/updates';

export interface UpdateData {
  currentVersion: string;
  latestVersion: string | null;
  checking: boolean;
  updateAvailable: boolean;
  automaticUpdate: boolean;
}

export function useUpdates(): UpdateData {
  const [data, setData] = useState<UpdateData>({
    currentVersion: getInstalledVersion(),
    latestVersion: null,
    checking: true,
    updateAvailable: false,
    automaticUpdate: false,
  });

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      requestAutomaticUpdate(),
      fetchLatestRelease().catch(() => null),
    ]).then(([automaticStatus, release]) => {
      if (cancelled) return;
      const automaticUpdate = automaticStatus === 'update_available';
      const githubUpdate =
        release !== null && isNewerVersion(release.version, getInstalledVersion());
      setData({
        currentVersion: getInstalledVersion(),
        latestVersion: release?.version ?? null,
        checking: false,
        updateAvailable: automaticUpdate || githubUpdate,
        automaticUpdate,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
