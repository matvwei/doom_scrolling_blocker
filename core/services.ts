import type { YouTubeScope } from './config';
import { translate, type Language } from './i18n';

export type ServiceId = 'youtube' | 'instagram' | 'tiktok';

export const SERVICE_IDS: readonly ServiceId[] = ['youtube', 'instagram', 'tiktok'];

export function isServiceId(id: string): id is ServiceId {
  return (SERVICE_IDS as readonly string[]).includes(id);
}

/** Отображаемое имя встроенного сервиса с учётом области YouTube. */
export function builtinLabel(
  id: ServiceId,
  youtubeScope: YouTubeScope,
  language: Language = 'ru',
): string {
  return id === 'youtube' && youtubeScope === 'all'
    ? translate(language, 'youtubeAllLabel')
    : SERVICES[id].label;
}

export interface ServiceDef {
  id: ServiceId;
  label: string;
  shortLabel: string;
  hosts: readonly string[];
  matchesPath: (pathname: string) => boolean;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export const SERVICES: Record<ServiceId, ServiceDef> = {
  youtube: {
    id: 'youtube',
    label: 'YouTube Shorts',
    shortLabel: 'YouTube',
    hosts: ['www.youtube.com', 'm.youtube.com'],
    matchesPath: (pathname) => pathname === '/shorts' || pathname.startsWith('/shorts/'),
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram Reels',
    shortLabel: 'Instagram',
    hosts: ['www.instagram.com', 'instagram.com'],
    matchesPath: (pathname) => {
      if (pathname === '/') return true;
      return (
        matchesPrefix(pathname, '/reels') ||
        matchesPrefix(pathname, '/reel')
      );
    },
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    shortLabel: 'TikTok',
    hosts: ['www.tiktok.com', 'tiktok.com'],
    matchesPath: () => true,
  },
};
