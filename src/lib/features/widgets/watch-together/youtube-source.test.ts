import { expect, test, vi } from 'vitest';

vi.mock('#lib/features/room/media/embeds/youtube.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/features/room/media/embeds/youtube.js')>();
  return {
    ...actual,
    loadDetails: vi.fn().mockResolvedValue(null),
  };
});

import {
  parseYoutubeInput,
  parseYoutubeMessage,
  resolveYoutubeItem,
  youtubeSyncEmbedUrl,
} from './youtube-source.js';

test('parses YouTube watch, short, shorts, embed, live, and raw video IDs', () => {
  expect(parseYoutubeInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toEqual({
    id: 'dQw4w9WgXcQ',
    start: 90,
    kind: 'video',
  });
  expect(parseYoutubeInput('https://youtu.be/dQw4w9WgXcQ?t=15')).toEqual({
    id: 'dQw4w9WgXcQ',
    start: 15,
    kind: 'video',
  });
  expect(parseYoutubeInput('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({
    id: 'dQw4w9WgXcQ',
    start: null,
    kind: 'short',
  });
  expect(parseYoutubeInput('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({
    id: 'dQw4w9WgXcQ',
    start: null,
    kind: 'short',
  });
  expect(parseYoutubeInput('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42')).toEqual({
    id: 'dQw4w9WgXcQ',
    start: 42,
    kind: 'video',
  });
  expect(parseYoutubeInput('https://www.youtube.com/live/dQw4w9WgXcQ?t=1m30s')).toEqual({
    id: 'dQw4w9WgXcQ',
    start: 90,
    kind: 'live',
  });
  expect(parseYoutubeInput('dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ', start: null, kind: 'video' });
  expect(parseYoutubeInput('https://example.org/watch?v=dQw4w9WgXcQ')).toBeNull();
});

test('builds enablejsapi youtube-nocookie embed URLs and omits start for live streams', () => {
  const url = new URL(youtubeSyncEmbedUrl('dQw4w9WgXcQ', 27.9));
  expect(url.origin).toBe('https://www.youtube-nocookie.com');
  expect(url.pathname).toBe('/embed/dQw4w9WgXcQ');
  expect(url.searchParams.get('enablejsapi')).toBe('1');
  expect(url.searchParams.get('start')).toBe('27');

  const liveUrl = new URL(youtubeSyncEmbedUrl('dQw4w9WgXcQ', 45, 'live'));
  expect(liveUrl.searchParams.get('start')).toBeNull();
});

test('falls back to YouTube oEmbed, detects vertical Shorts, and falls back to videoId', async () => {
  const oembedFetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        title: 'Rick Astley - Never Gonna Give You Up',
        author_name: 'Rick Astley',
        thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        width: 200,
        height: 113,
      }),
  }) as unknown as typeof fetch;

  const item = await resolveYoutubeItem('dQw4w9WgXcQ', '@alice:example.org', {
    fetcher: oembedFetcher,
  });
  expect(item.kind).toBe('video');
  expect(item.title).toBe('Rick Astley - Never Gonna Give You Up');
  expect(item.author).toBe('Rick Astley');
  expect(item.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');

  const shortFetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        title: 'Vertical Short',
        author_name: 'Creator',
        width: 405,
        height: 720,
      }),
  }) as unknown as typeof fetch;
  const detectedShort = await resolveYoutubeItem('dQw4w9WgXcQ', '@alice:example.org', {
    fetcher: shortFetcher,
  });
  expect(detectedShort.kind).toBe('short');

  const failingFetcher = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
  const fallback = await resolveYoutubeItem('dQw4w9WgXcQ', '@alice:example.org', {
    kind: 'live',
    fetcher: failingFetcher,
  });
  expect(fallback.kind).toBe('live');
  expect(fallback.title).toBe('dQw4w9WgXcQ');
  expect(fallback.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
});

test('parses YouTube iframe postMessage payloads only from YouTube origins', () => {
  expect(
    parseYoutubeMessage(
      new MessageEvent('message', {
        origin: 'https://evil.example.org',
        data: JSON.stringify({ event: 'onReady' }),
      })
    )
  ).toBeNull();

  expect(
    parseYoutubeMessage(
      new MessageEvent('message', {
        origin: 'https://www.youtube-nocookie.com',
        data: JSON.stringify({
          event: 'infoDelivery',
          info: { playerState: 1, currentTime: 18.4, duration: 212 },
        }),
      })
    )
  ).toEqual({
    kind: 'info',
    playerState: 1,
    currentTime: 18.4,
    duration: 212,
    videoId: null,
    title: null,
    isAd: null,
    isLive: null,
  });

  expect(
    parseYoutubeMessage(
      new MessageEvent('message', {
        origin: 'https://www.youtube-nocookie.com',
        data: JSON.stringify({
          event: 'infoDelivery',
          info: {
            playerState: 1,
            currentTime: 2.1,
            adState: 1,
            videoData: { video_id: 'adVideo12345', title: 'Ad' },
          },
        }),
      })
    )
  ).toEqual({
    kind: 'info',
    playerState: 1,
    currentTime: 2.1,
    duration: null,
    videoId: 'adVideo12345',
    title: 'Ad',
    isAd: true,
    isLive: null,
  });

  expect(
    parseYoutubeMessage(
      new MessageEvent('message', {
        origin: 'https://www.youtube-nocookie.com',
        data: JSON.stringify({
          event: 'infoDelivery',
          info: {
            adVideoId: 'adVideo99999',
            videoData: { video_id: 'dQw4w9WgXcQ', isLive: true },
          },
        }),
      })
    )
  ).toEqual({
    kind: 'info',
    playerState: null,
    currentTime: null,
    duration: null,
    videoId: 'dQw4w9WgXcQ',
    title: null,
    isAd: true,
    isLive: true,
  });
});
