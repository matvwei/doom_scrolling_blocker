import { describe, expect, it } from 'vitest';
import { getDefaultConfig, type CustomSiteConfig } from '../core/config';
import { classifyUrl, isTrackedUrl, makeIsTracked } from '../core/matching';

const SHORTS_ONLY = getDefaultConfig(); // youtubeScope: 'shorts', customSites: []

const ALL_YOUTUBE = { ...getDefaultConfig(), youtubeScope: 'all' as const };

function site(id: string, url: string): CustomSiteConfig {
  return { id, name: id, url, enabled: true, sessionLimitMinutes: 15, dailyLimitMinutes: 45, action: 'warning', redirectUrl: '', message: 'm' };
}

describe('classifyUrl: встроенные сервисы (область «только Shorts»)', () => {
  it('распознаёт YouTube Shorts на десктопном и мобильном хосте', () => {
    expect(classifyUrl('https://www.youtube.com/shorts/abc123', SHORTS_ONLY)).toEqual({ id: 'youtube', kind: 'builtin' });
    expect(classifyUrl('https://m.youtube.com/shorts/xyz', SHORTS_ONLY)).toEqual({ id: 'youtube', kind: 'builtin' });
  });

  it('не трогает обычный YouTube', () => {
    expect(classifyUrl('https://www.youtube.com/', SHORTS_ONLY)).toBeNull();
    expect(classifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', SHORTS_ONLY)).toBeNull();
    expect(classifyUrl('https://www.youtube.com/feed/subscriptions', SHORTS_ONLY)).toBeNull();
    expect(classifyUrl('https://www.youtube.com/results?search_query=cat', SHORTS_ONLY)).toBeNull();
    expect(classifyUrl('https://studio.youtube.com/', SHORTS_ONLY)).toBeNull();
  });

  it('распознаёт /shorts и с id ролика, и без trailing slash', () => {
    expect(classifyUrl('https://www.youtube.com/shorts', SHORTS_ONLY)).toEqual({ id: 'youtube', kind: 'builtin' });
    expect(classifyUrl('https://www.youtube.com/shorts/', SHORTS_ONLY)).toEqual({ id: 'youtube', kind: 'builtin' });
    expect(classifyUrl('https://www.youtube.com/shorts/abc123/', SHORTS_ONLY)).toEqual({ id: 'youtube', kind: 'builtin' });
  });

  it('распознаёт ленту и Reels Instagram', () => {
    expect(classifyUrl('https://www.instagram.com/', SHORTS_ONLY)).toEqual({ id: 'instagram', kind: 'builtin' });
    expect(classifyUrl('https://www.instagram.com/reels/', SHORTS_ONLY)).toEqual({ id: 'instagram', kind: 'builtin' });
    expect(classifyUrl('https://www.instagram.com/reel/C1abcDEF/', SHORTS_ONLY)).toEqual({ id: 'instagram', kind: 'builtin' });
    expect(classifyUrl('https://instagram.com/reel/C1abcDEF/', SHORTS_ONLY)).toEqual({ id: 'instagram', kind: 'builtin' });
  });

  it('не трогает профили, посты и сообщения Instagram', () => {
    expect(classifyUrl('https://www.instagram.com/username/', SHORTS_ONLY)).toBeNull();
    expect(classifyUrl('https://www.instagram.com/direct/inbox/', SHORTS_ONLY)).toBeNull();
    expect(classifyUrl('https://www.instagram.com/p/C1abcDEF/', SHORTS_ONLY)).toBeNull();
  });

  it('распознаёт TikTok целиком', () => {
    expect(classifyUrl('https://www.tiktok.com/', SHORTS_ONLY)).toEqual({ id: 'tiktok', kind: 'builtin' });
    expect(classifyUrl('https://tiktok.com/foryou', SHORTS_ONLY)).toEqual({ id: 'tiktok', kind: 'builtin' });
  });

  it('возвращает null для прочих сайтов и некорректных URL', () => {
    expect(classifyUrl('https://example.com/shorts/1', SHORTS_ONLY)).toBeNull();
    expect(classifyUrl('not a url', SHORTS_ONLY)).toBeNull();
    expect(classifyUrl('', SHORTS_ONLY)).toBeNull();
    expect(classifyUrl('chrome://extensions/', SHORTS_ONLY)).toBeNull();
    expect(classifyUrl('ftp://www.youtube.com/shorts/1', SHORTS_ONLY)).toBeNull();
  });
});

describe('classifyUrl: область «весь YouTube»', () => {
  it('отслеживает обычные видео, главную и другие страницы YouTube', () => {
    expect(classifyUrl('https://www.youtube.com/watch?v=abc', ALL_YOUTUBE)).toEqual({ id: 'youtube', kind: 'builtin' });
    expect(classifyUrl('https://www.youtube.com/', ALL_YOUTUBE)).toEqual({ id: 'youtube', kind: 'builtin' });
    expect(classifyUrl('https://www.youtube.com/feed/subscriptions', ALL_YOUTUBE)).toEqual({ id: 'youtube', kind: 'builtin' });
    expect(classifyUrl('https://www.youtube.com/results?search_query=cat', ALL_YOUTUBE)).toEqual({ id: 'youtube', kind: 'builtin' });
    expect(classifyUrl('https://m.youtube.com/watch?v=abc', ALL_YOUTUBE)).toEqual({ id: 'youtube', kind: 'builtin' });
    expect(classifyUrl('https://www.youtube.com/shorts/abc', ALL_YOUTUBE)).toEqual({ id: 'youtube', kind: 'builtin' });
  });

  it('не распространяется на другие хосты youtube и прочие домены', () => {
    expect(classifyUrl('https://studio.youtube.com/', ALL_YOUTUBE)).toBeNull();
    expect(classifyUrl('https://music.youtube.com/', ALL_YOUTUBE)).toBeNull();
    expect(classifyUrl('https://example.com/watch?v=abc', ALL_YOUTUBE)).toBeNull();
  });

  it('область shorts (default) сохраняет прежнее поведение для /watch', () => {
    expect(classifyUrl('https://www.youtube.com/watch?v=abc', SHORTS_ONLY)).toBeNull();
  });
});

describe('classifyUrl: пользовательские сайты', () => {
  const WITH_CUSTOM = {
    ...getDefaultConfig(),
    customSites: [
      site('site-domain', 'https://news.example.com'),
      site('site-path', 'https://example.com/foo'),
    ],
  };

  it('правило домена ловит домен, поддомены и любые пути', () => {
    expect(classifyUrl('https://news.example.com/', WITH_CUSTOM)).toEqual({ id: 'site-domain', kind: 'custom' });
    expect(classifyUrl('https://news.example.com/article/1', WITH_CUSTOM)).toEqual({ id: 'site-domain', kind: 'custom' });
    expect(classifyUrl('https://a.b.news.example.com/x', WITH_CUSTOM)).toEqual({ id: 'site-domain', kind: 'custom' });
  });

  it('правило раздела ловит path prefix, но не соседние разделы', () => {
    expect(classifyUrl('https://example.com/foo', WITH_CUSTOM)).toEqual({ id: 'site-path', kind: 'custom' });
    expect(classifyUrl('https://example.com/foo/', WITH_CUSTOM)).toEqual({ id: 'site-path', kind: 'custom' });
    expect(classifyUrl('https://example.com/foo/bar', WITH_CUSTOM)).toEqual({ id: 'site-path', kind: 'custom' });
    expect(classifyUrl('https://sub.example.com/foo/bar', WITH_CUSTOM)).toEqual({ id: 'site-path', kind: 'custom' });
    expect(classifyUrl('https://example.com/foobar', WITH_CUSTOM)).toBeNull();
    expect(classifyUrl('https://example.com/', WITH_CUSTOM)).toBeNull();
  });

  it('учитывает схему правила строго', () => {
    const httpRule = { ...getDefaultConfig(), customSites: [site('http-site', 'http://example.com')] };
    expect(classifyUrl('http://example.com/page', httpRule)).toEqual({ id: 'http-site', kind: 'custom' });
    expect(classifyUrl('https://example.com/page', httpRule)).toBeNull();
  });

  it('custom-правило переопределяет встроенную классификацию', () => {
    const youtubeCustom = {
      ...getDefaultConfig(),
      customSites: [site('my-youtube', 'https://youtube.com')],
    };
    // Даже обычный /watch попадает под custom-правило, встроенный youtube не выигрывает.
    expect(classifyUrl('https://www.youtube.com/watch?v=abc', youtubeCustom)).toEqual({ id: 'my-youtube', kind: 'custom' });
  });

  it('при нескольких правилах одного домена выигрывает первое в списке', () => {
    const twoRules = {
      ...getDefaultConfig(),
      customSites: [site('first', 'https://example.com'), site('second', 'https://example.com/a')],
    };
    expect(classifyUrl('https://example.com/a/b', twoRules)).toEqual({ id: 'first', kind: 'custom' });
  });

  it('не ломает встроенные сервисы без пересечений', () => {
    expect(classifyUrl('https://www.tiktok.com/@user', WITH_CUSTOM)).toEqual({ id: 'tiktok', kind: 'builtin' });
    expect(classifyUrl('https://www.youtube.com/shorts/x', WITH_CUSTOM)).toEqual({ id: 'youtube', kind: 'builtin' });
  });
});

describe('isTrackedUrl / makeIsTracked', () => {
  it('отличает отслеживаемые зоны от обычных страниц', () => {
    expect(isTrackedUrl('https://www.youtube.com/shorts/abc', SHORTS_ONLY)).toBe(true);
    expect(isTrackedUrl('https://www.tiktok.com/@user', SHORTS_ONLY)).toBe(true);
    expect(isTrackedUrl('https://www.youtube.com/watch?v=abc', SHORTS_ONLY)).toBe(false);
    expect(isTrackedUrl('https://example.com/', SHORTS_ONLY)).toBe(false);
  });

  it('учитывает область YouTube и custom-сайты (защита redirect от циклов)', () => {
    expect(isTrackedUrl('https://www.youtube.com/watch?v=abc', ALL_YOUTUBE)).toBe(true);
    const custom = { ...getDefaultConfig(), customSites: [site('s', 'https://example.com')] };
    expect(makeIsTracked(custom)('https://example.com/')).toBe(true);
    expect(makeIsTracked(custom)('https://other.com/')).toBe(false);
  });
});
