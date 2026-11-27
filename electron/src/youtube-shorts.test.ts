import { expect, test, vi } from 'vitest';

import {
  encodeShortsSequenceParams,
  fetchYoutubeShortsSequence,
  parseShortsSequenceResponse,
} from './youtube-shorts.js';

test('encodes valid 11-char video IDs and rejects invalid IDs', () => {
  const encoded = encodeShortsSequenceParams('dQw4w9WgXcQ');
  expect(encoded).toBe('CgtkUXc0dzlXZ1hjUSoCGAw=');
  expect(encodeShortsSequenceParams('short')).toBeNull();
  expect(encodeShortsSequenceParams('')).toBeNull();
});

test('parses unique video IDs and continuation token from InnerTube responses', () => {
  const result = parseShortsSequenceResponse({
    entries: [
      { command: { reelWatchEndpoint: { videoId: '1r5clrqOtf8' } } },
      { command: { reelWatchEndpoint: { videoId: '1r5clrqOtf8' } } },
      { command: { reelWatchEndpoint: { videoId: 'invalid' } } },
      { command: { reelWatchEndpoint: { videoId: 'muUXIuVt3Tw' } } },
    ],
    continuationEndpoint: {
      continuationCommand: { token: 'next-token-123' },
    },
  });

  expect(result).toEqual({
    videoIds: ['1r5clrqOtf8', 'muUXIuVt3Tw'],
    continuation: 'next-token-123',
  });
});

test('fetches seeded and continuation pages and handles HTTP errors gracefully', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          entries: [{ command: { reelWatchEndpoint: { videoId: '1r5clrqOtf8' } } }],
          continuationEndpoint: { continuationCommand: { token: 'tok-1' } },
        }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          entries: [{ command: { reelWatchEndpoint: { videoId: 'muUXIuVt3Tw' } } }],
        }),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 500,
    }) as unknown as typeof fetch;

  const page1 = await fetchYoutubeShortsSequence({ videoId: 'dQw4w9WgXcQ' }, fetcher);
  expect(page1).toEqual({ videoIds: ['1r5clrqOtf8'], continuation: 'tok-1' });
  expect(fetcher).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining('reel_watch_sequence'),
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"sequenceParams":"CgtkUXc0dzlXZ1hjUSoCGAw="'),
    })
  );

  const page2 = await fetchYoutubeShortsSequence(
    { videoId: 'dQw4w9WgXcQ', continuation: page1.continuation },
    fetcher
  );
  expect(page2).toEqual({ videoIds: ['muUXIuVt3Tw'], continuation: null });
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining('reel_watch_sequence'),
    expect.objectContaining({
      body: expect.stringContaining('"continuation":"tok-1"'),
    })
  );

  const failed = await fetchYoutubeShortsSequence({ videoId: 'dQw4w9WgXcQ' }, fetcher);
  expect(failed).toEqual({ videoIds: [], continuation: null });
});
