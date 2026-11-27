import { isRecord } from '#lib/guards.js';
import { loadDetails } from '#lib/features/room/media/embeds/youtube.js';

import type { WatchTogetherItem, WatchTogetherItemKind } from './watch-together-protocol.js';

const VIDEO_ID_RE = /^[\w-]{11}$/;
const TIMESTAMP_RE = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/;
const EXTRA_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

export const YOUTUBE_EMBED_ORIGINS = new Set([
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
]);

export interface ParsedYoutubeInput {
  id: string;
  start: number | null;
  kind: WatchTogetherItemKind;
}

function parseTimestampSec(value: string | null): number | null {
  if (!value) return null;
  const match = TIMESTAMP_RE.exec(value.trim());
  if (!match) return null;
  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(total) && total > 0 ? total : null;
}

export function parseYoutubeInput(input: string): ParsedYoutubeInput | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (VIDEO_ID_RE.test(trimmed)) return { id: trimmed, start: null, kind: 'video' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  let candidate: string | null;
  let kind: WatchTogetherItemKind = 'video';

  if (parsed.hostname === 'youtu.be') {
    candidate = segments[0] ?? null;
  } else if (EXTRA_HOSTS.has(parsed.hostname)) {
    if (segments[0] === 'shorts') {
      candidate = segments[1] ?? null;
      kind = 'short';
    } else if (segments[0] === 'live') {
      candidate = segments[1] ?? null;
      kind = 'live';
    } else if (segments[0] === 'embed') {
      candidate = segments[1] ?? null;
    } else if (parsed.pathname === '/watch') {
      candidate = parsed.searchParams.get('v');
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (candidate === null || !VIDEO_ID_RE.test(candidate)) return null;
  return {
    id: candidate,
    start: parseTimestampSec(parsed.searchParams.get('t') ?? parsed.searchParams.get('start')),
    kind,
  };
}

export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

export function youtubeWatchUrl(videoId: string, kind: WatchTogetherItemKind = 'video'): string {
  if (kind === 'short') return `https://www.youtube.com/shorts/${videoId}`;
  if (kind === 'live') return `https://www.youtube.com/live/${videoId}`;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubeSyncEmbedUrl(
  videoId: string,
  startSec = 0,
  kind: WatchTogetherItemKind = 'video'
): string {
  const url = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  url.searchParams.set('enablejsapi', '1');
  url.searchParams.set('playsinline', '1');
  url.searchParams.set('rel', '0');
  url.searchParams.set('iv_load_policy', '3');
  if (kind !== 'live' && startSec >= 1) url.searchParams.set('start', String(Math.floor(startSec)));
  return url.toString();
}

export async function resolveYoutubeItem(
  videoId: string,
  addedBy: string,
  options: { kind?: WatchTogetherItemKind; fetcher?: typeof fetch } = {}
): Promise<WatchTogetherItem> {
  const kind = options.kind ?? 'video';
  const fetcher = options.fetcher ?? fetch;
  const fallbackThumb = youtubeThumbnailUrl(videoId);
  try {
    const details = await loadDetails(videoId, false, 'original', 'middle');
    if (details !== null) {
      return {
        id: crypto.randomUUID(),
        source: 'youtube',
        kind,
        videoId,
        title: details.title,
        author: details.author,
        thumbnailUrl: details.thumbnailUrl,
        addedBy,
      };
    }
  } catch (error) {
    console.debug('[sable watch-together] embed metadata unavailable', error);
  }

  try {
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(3000)
        : undefined;
    const response = await fetcher(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeWatchUrl(videoId))}&format=json`,
      signal ? { signal } : undefined
    );
    if (response.ok) {
      const json: unknown = await response.json();
      if (isRecord(json) && typeof json.title === 'string' && json.title !== '') {
        const resolvedKind: WatchTogetherItemKind =
          kind === 'video' &&
          typeof json.width === 'number' &&
          typeof json.height === 'number' &&
          json.height > json.width
            ? 'short'
            : kind;
        return {
          id: crypto.randomUUID(),
          source: 'youtube',
          kind: resolvedKind,
          videoId,
          title: json.title,
          author: typeof json.author_name === 'string' ? json.author_name : null,
          thumbnailUrl:
            typeof json.thumbnail_url === 'string' && json.thumbnail_url.startsWith('https://')
              ? json.thumbnail_url
              : fallbackThumb,
          addedBy,
        };
      }
    }
  } catch (error) {
    console.debug('[sable watch-together] oEmbed metadata unavailable', error);
  }

  return {
    id: crypto.randomUUID(),
    source: 'youtube',
    kind,
    videoId,
    title: videoId,
    author: null,
    thumbnailUrl: fallbackThumb,
    addedBy,
  };
}

export function postYoutubeListening(iframe: HTMLIFrameElement, id: number): void {
  iframe.contentWindow?.postMessage(
    JSON.stringify({ event: 'listening', id, channel: 'widget' }),
    '*'
  );
}

export function postYoutubeCommand(
  iframe: HTMLIFrameElement,
  func: string,
  args: unknown[] = []
): void {
  iframe.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
}

export type YoutubePlayerMessage =
  | { kind: 'ready' }
  | { kind: 'state'; playerState: number }
  | {
      kind: 'info';
      playerState: number | null;
      currentTime: number | null;
      duration: number | null;
      videoId: string | null;
      title: string | null;
      isAd: boolean | null;
      isLive: boolean | null;
    }
  | { kind: 'error'; code: number };

export function parseYoutubeMessage(event: MessageEvent): YoutubePlayerMessage | null {
  if (!YOUTUBE_EMBED_ORIGINS.has(event.origin)) return null;
  let payload: unknown = event.data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (!isRecord(payload) || typeof payload.event !== 'string') return null;

  if (payload.event === 'onReady') return { kind: 'ready' };
  if (payload.event === 'onStateChange' && typeof payload.info === 'number') {
    return { kind: 'state', playerState: payload.info };
  }
  if (payload.event === 'onError' && typeof payload.info === 'number') {
    return { kind: 'error', code: payload.info };
  }
  if (payload.event === 'infoDelivery' && isRecord(payload.info)) {
    const { playerState, currentTime, duration, videoData, adState, adVideoId } = payload.info;
    const data = isRecord(videoData) ? videoData : null;
    return {
      kind: 'info',
      playerState: typeof playerState === 'number' ? playerState : null,
      currentTime: typeof currentTime === 'number' && Number.isFinite(currentTime) ? currentTime : null,
      duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : null,
      videoId: data && typeof data.video_id === 'string' && data.video_id !== '' ? data.video_id : null,
      title: data && typeof data.title === 'string' && data.title !== '' ? data.title : null,
      isAd:
        typeof adState === 'number'
          ? adState > 0
          : typeof adVideoId === 'string'
            ? adVideoId !== ''
            : null,
      isLive:
        data && typeof data.isLive === 'boolean'
          ? data.isLive
          : typeof payload.info.isLive === 'boolean'
            ? payload.info.isLive
            : null,
    };
  }
  return null;
}
