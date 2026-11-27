import { expect, test } from 'vitest';

import { applyYoutubeEmbedReferer, YOUTUBE_EMBED_REFERER } from './youtube-referer.js';

test('adds an https Referer header when absent or non-https', () => {
  expect(applyYoutubeEmbedReferer({})).toEqual({ Referer: YOUTUBE_EMBED_REFERER });
  expect(applyYoutubeEmbedReferer({ referer: 'sable-app://app/' })).toEqual({
    Referer: YOUTUBE_EMBED_REFERER,
  });
});

test('preserves an existing https Referer header', () => {
  const existing = { Referer: 'https://sable.moe/room' };
  expect(applyYoutubeEmbedReferer(existing)).toBe(existing);
});
