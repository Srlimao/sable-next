export const YOUTUBE_EMBED_URLS = [
  'https://www.youtube-nocookie.com/embed/*',
  'https://www.youtube.com/embed/*',
];

export const YOUTUBE_EMBED_REFERER = 'https://sable.moe/';

export function applyYoutubeEmbedReferer(
  headers: Record<string, string>
): Record<string, string> {
  const existingKey = Object.keys(headers).find((key) => key.toLowerCase() === 'referer');
  const existingValue = existingKey ? headers[existingKey] : undefined;
  if (existingValue && existingValue.startsWith('https://')) return headers;
  const filtered = Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'referer');
  return { ...Object.fromEntries(filtered), Referer: YOUTUBE_EMBED_REFERER };
}
