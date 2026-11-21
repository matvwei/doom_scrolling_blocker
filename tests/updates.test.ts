import { describe, expect, it, vi } from 'vitest';
import {
  fetchLatestRelease,
  GITHUB_RELEASES_URL,
  isNewerVersion,
} from '../core/updates';

function fetchResponse(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('updates', () => {
  it('сравнивает числовые версии и теги с префиксом v', () => {
    expect(isNewerVersion('0.4.0', '0.3.0')).toBe(true);
    expect(isNewerVersion('v0.3.1', '0.3.0')).toBe(true);
    expect(isNewerVersion('1.0', '0.9.9')).toBe(true);
  });

  it('не считает обновлением текущую, старую или некорректную версию', () => {
    expect(isNewerVersion('0.3.0', '0.3.0')).toBe(false);
    expect(isNewerVersion('0.2.9', '0.3.0')).toBe(false);
    expect(isNewerVersion('latest', '0.3.0')).toBe(false);
  });

  it('получает последний стабильный релиз GitHub', async () => {
    const fetcher = fetchResponse({ tag_name: 'v0.4.0' });

    await expect(fetchLatestRelease(fetcher)).resolves.toEqual({
      version: '0.4.0',
      url: GITHUB_RELEASES_URL,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/matvwei/doom_scrolling_blocker/releases/latest',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('сообщает об ошибке ответа GitHub', async () => {
    await expect(fetchLatestRelease(fetchResponse({}, false, 503))).rejects.toThrow(
      'HTTP 503',
    );
  });

  it('отклоняет релиз без корректного тега версии', async () => {
    await expect(fetchLatestRelease(fetchResponse({ tag_name: 'latest' }))).rejects.toThrow(
      'valid version tag',
    );
  });
});
