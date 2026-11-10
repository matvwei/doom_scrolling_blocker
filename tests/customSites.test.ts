import { describe, expect, it } from 'vitest';
import {
  contentScriptMatchesForUrl,
  normalizeCustomSiteUrl,
  parseCustomSiteUrl,
  requestPatternForUrl,
  ruleMatchesUrl,
} from '../core/customSites';

describe('parseCustomSiteUrl', () => {
  it('принимает http/https домены с путями', () => {
    expect(parseCustomSiteUrl('https://example.com')).toEqual({ scheme: 'https', domain: 'example.com', pathPrefix: null });
    expect(parseCustomSiteUrl('http://example.com/')).toEqual({ scheme: 'http', domain: 'example.com', pathPrefix: null });
    expect(parseCustomSiteUrl('https://example.com/foo')).toEqual({ scheme: 'https', domain: 'example.com', pathPrefix: '/foo' });
    expect(parseCustomSiteUrl('https://example.com/foo/')).toEqual({ scheme: 'https', domain: 'example.com', pathPrefix: '/foo' });
    expect(parseCustomSiteUrl('https://WWW.Example.COM/FOO')).toEqual({ scheme: 'https', domain: 'www.example.com', pathPrefix: '/FOO' });
  });

  it('отбрасывает query и hash из правила', () => {
    expect(parseCustomSiteUrl('https://example.com/foo?x=1#frag')).toEqual({ scheme: 'https', domain: 'example.com', pathPrefix: '/foo' });
  });

  it('отклоняет некорректные и опасные URL', () => {
    expect(parseCustomSiteUrl('')).toBeNull();
    expect(parseCustomSiteUrl('   ')).toBeNull();
    expect(parseCustomSiteUrl('example.com')).toBeNull(); // без схемы
    expect(parseCustomSiteUrl('ftp://example.com')).toBeNull();
    expect(parseCustomSiteUrl('javascript:alert(1)')).toBeNull();
    expect(parseCustomSiteUrl('data:text/html,x')).toBeNull();
    expect(parseCustomSiteUrl('chrome://extensions/')).toBeNull();
    expect(parseCustomSiteUrl('https://user:pass@example.com/')).toBeNull();
    expect(parseCustomSiteUrl('https://example.com:8080/')).toBeNull();
    expect(parseCustomSiteUrl('not a url')).toBeNull();
  });

  it('принимает дефолтные порты и localhost', () => {
    expect(parseCustomSiteUrl('https://example.com:443/')).toEqual({ scheme: 'https', domain: 'example.com', pathPrefix: null });
    expect(parseCustomSiteUrl('http://localhost/')).toEqual({ scheme: 'http', domain: 'localhost', pathPrefix: null });
    expect(parseCustomSiteUrl('http://127.0.0.1/')).toEqual({ scheme: 'http', domain: '127.0.0.1', pathPrefix: null });
  });

  it('localhost с нестандартным портом не выражается в match-паттернах', () => {
    expect(parseCustomSiteUrl('http://localhost:3000')).toBeNull();
  });
});

describe('normalizeCustomSiteUrl', () => {
  it('приводит адреса к каноническому виду', () => {
    expect(normalizeCustomSiteUrl('https://Example.com/')).toBe('https://example.com/');
    expect(normalizeCustomSiteUrl('https://example.com/foo/')).toBe('https://example.com/foo');
    expect(normalizeCustomSiteUrl('https://example.com:443')).toBe('https://example.com/');
    expect(normalizeCustomSiteUrl('https://example.com/foo?a=1#b')).toBe('https://example.com/foo');
  });

  it('возвращает null для неподходящих адресов', () => {
    expect(normalizeCustomSiteUrl('ftp://example.com')).toBeNull();
    expect(normalizeCustomSiteUrl('https://example.com:9000/x')).toBeNull();
  });
});

describe('ruleMatchesUrl', () => {
  const domainRule = parseCustomSiteUrl('https://example.com')!;
  const pathRule = parseCustomSiteUrl('https://example.com/foo')!;

  it('домен: точный хост, поддомены, любые пути', () => {
    expect(ruleMatchesUrl(domainRule, new URL('https://example.com/'))).toBe(true);
    expect(ruleMatchesUrl(domainRule, new URL('https://example.com/a/b?c=1'))).toBe(true);
    expect(ruleMatchesUrl(domainRule, new URL('https://www.example.com/'))).toBe(true);
    expect(ruleMatchesUrl(domainRule, new URL('https://deep.sub.example.com/x'))).toBe(true);
  });

  it('домен: чужие домены и поддомены-префиксы не совпадают', () => {
    expect(ruleMatchesUrl(domainRule, new URL('https://notexample.com/'))).toBe(false);
    expect(ruleMatchesUrl(domainRule, new URL('https://example.com.evil.com/'))).toBe(false);
  });

  it('раздел: path prefix с границей компонента пути', () => {
    expect(ruleMatchesUrl(pathRule, new URL('https://example.com/foo'))).toBe(true);
    expect(ruleMatchesUrl(pathRule, new URL('https://example.com/foo/'))).toBe(true);
    expect(ruleMatchesUrl(pathRule, new URL('https://example.com/foo/bar'))).toBe(true);
    expect(ruleMatchesUrl(pathRule, new URL('https://sub.example.com/foo/bar'))).toBe(true);
    expect(ruleMatchesUrl(pathRule, new URL('https://example.com/foobar'))).toBe(false);
    expect(ruleMatchesUrl(pathRule, new URL('https://example.com/fo'))).toBe(false);
    expect(ruleMatchesUrl(pathRule, new URL('https://example.com/'))).toBe(false);
  });

  it('схема правила строгая', () => {
    expect(ruleMatchesUrl(pathRule, new URL('http://example.com/foo'))).toBe(false);
    const httpRule = parseCustomSiteUrl('http://example.com/foo')!;
    expect(ruleMatchesUrl(httpRule, new URL('http://example.com/foo'))).toBe(true);
    expect(ruleMatchesUrl(httpRule, new URL('https://example.com/foo'))).toBe(false);
  });
});

describe('match-паттерны', () => {
  it('requestPatternForUrl: wildcard-хост для многоуровневых доменов', () => {
    expect(requestPatternForUrl('https://example.com')).toBe('https://*.example.com/*');
    expect(requestPatternForUrl('https://example.com/foo')).toBe('https://*.example.com/*');
    expect(requestPatternForUrl('http://localhost/')).toBe('http://localhost/*');
    expect(requestPatternForUrl('http://127.0.0.1/')).toBe('http://127.0.0.1/*');
    expect(requestPatternForUrl('ftp://example.com')).toBeNull();
  });

  it('contentScriptMatchesForUrl: домен — один паттерн, раздел — точный + префикс', () => {
    expect(contentScriptMatchesForUrl('https://example.com')).toEqual(['https://*.example.com/*']);
    expect(contentScriptMatchesForUrl('https://example.com/foo')).toEqual([
      'https://*.example.com/foo',
      'https://*.example.com/foo/*',
    ]);
    expect(contentScriptMatchesForUrl('bad url')).toEqual([]);
  });
});
