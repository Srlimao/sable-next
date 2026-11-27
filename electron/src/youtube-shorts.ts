import type { YoutubeShortsSequenceResult } from '../../src/lib/platform/youtube-shorts-types';

const VIDEO_ID_RE = /^[\w-]{11}$/;
const SEQUENCE_ENDPOINT =
  'https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence?prettyPrint=false';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const INNERTUBE_CLIENT = {
  clientName: 'WEB',
  clientVersion: '2.20250101.00.00',
  hl: 'en',
  gl: 'US',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function encodeShortsSequenceParams(videoId: string): string | null {
  if (!VIDEO_ID_RE.test(videoId)) return null;
  const idBytes = Buffer.from(videoId, 'utf8');
  return Buffer.concat([
    Buffer.from([0x0a, idBytes.length]),
    idBytes,
    Buffer.from([0x2a, 0x02, 0x18, 0x0c]),
  ]).toString('base64');
}

export function parseShortsSequenceResponse(raw: unknown): YoutubeShortsSequenceResult {
  if (!isRecord(raw)) return { videoIds: [], continuation: null };

  const seen = new Set<string>();
  const videoIds: string[] = [];
  if (Array.isArray(raw.entries)) {
    for (const entry of raw.entries) {
      if (!isRecord(entry) || !isRecord(entry.command)) continue;
      const endpoint = entry.command.reelWatchEndpoint;
      if (!isRecord(endpoint) || typeof endpoint.videoId !== 'string') continue;
      if (!VIDEO_ID_RE.test(endpoint.videoId) || seen.has(endpoint.videoId)) continue;
      seen.add(endpoint.videoId);
      videoIds.push(endpoint.videoId);
    }
  }

  let continuation: string | null = null;
  if (isRecord(raw.continuationEndpoint) && isRecord(raw.continuationEndpoint.continuationCommand)) {
    const token = raw.continuationEndpoint.continuationCommand.token;
    if (typeof token === 'string' && token !== '') {
      continuation = token;
    }
  }

  return { videoIds, continuation };
}

export async function fetchYoutubeShortsSequence(
  params: { videoId: string; continuation?: string | null },
  fetcher: typeof fetch = fetch
): Promise<YoutubeShortsSequenceResult> {
  const token =
    typeof params.continuation === 'string' && params.continuation.trim() !== ''
      ? params.continuation
      : null;

  let body: Record<string, unknown>;
  if (token !== null) {
    body = { context: { client: INNERTUBE_CLIENT }, continuation: token };
  } else {
    const sequenceParams = encodeShortsSequenceParams(params.videoId);
    if (sequenceParams === null) return { videoIds: [], continuation: null };
    body = { context: { client: INNERTUBE_CLIENT }, sequenceParams };
  }

  try {
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(5000)
        : undefined;
    const response = await fetcher(SEQUENCE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': DESKTOP_UA,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return { videoIds: [], continuation: null };
    const json: unknown = await response.json();
    return parseShortsSequenceResponse(json);
  } catch (error) {
    console.debug('[sable electron] failed to fetch YouTube Shorts sequence', error);
    return { videoIds: [], continuation: null };
  }
}
