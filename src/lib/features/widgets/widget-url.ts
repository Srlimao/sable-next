import { runTemplate, type IWidget } from 'matrix-widget-api';

import type { RoomWidget } from './widget-content.js';

export interface WidgetTemplateVars {
  userId: string;
  roomId: string;
  displayName: string;
  avatarUrl: string;
  deviceId?: string;
  baseUrl?: string;
  clientTheme?: string;
  clientLanguage?: string;
}

export const WIDGET_CLIENT_ID = 'moe.sable.next';

const ELEMENT_SCALAR_HOSTS = new Set([
  'scalar.vector.im',
  'integrations.element.io',
  'scalar-staging.vector.im',
  'scalar-develop.riot.im',
]);

function isElementScalarHost(parsed: URL): boolean {
  return parsed.protocol === 'https:' && ELEMENT_SCALAR_HOSTS.has(parsed.hostname);
}

export function needsScalarToken(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.searchParams.has('scalar_token')) return false;
  return isElementScalarHost(parsed) || parsed.pathname.includes('/api/widgets/');
}

export function attachScalarToken(widgetUrl: string, managerUrl: string): string {
  let parsedWidget: URL;
  let parsedManager: URL;
  try {
    parsedWidget = new URL(widgetUrl);
    parsedManager = new URL(managerUrl);
  } catch {
    return widgetUrl;
  }
  const token = parsedManager.searchParams.get('scalar_token');
  if (!token) return widgetUrl;
  const sameOrigin = parsedWidget.origin === parsedManager.origin;
  const bothElementScalar = isElementScalarHost(parsedWidget) && isElementScalarHost(parsedManager);
  if (!sameOrigin && !bothElementScalar) return widgetUrl;
  parsedWidget.searchParams.set('scalar_token', token);
  return parsedWidget.toString();
}

export function templateWidgetUrl(widget: RoomWidget, vars: WidgetTemplateVars): string {
  const definition: IWidget = {
    id: widget.id,
    creatorUserId: vars.userId,
    type: widget.type,
    url: widget.url,
    name: widget.name,
    data: widget.data,
  };

  const resolved = runTemplate(widget.url, definition, {
    widgetRoomId: vars.roomId,
    currentUserId: vars.userId,
    userDisplayName: vars.displayName,
    userHttpAvatarUrl: vars.avatarUrl,
    clientId: WIDGET_CLIENT_ID,
    clientTheme: vars.clientTheme,
    clientLanguage: vars.clientLanguage,
    deviceId: vars.deviceId,
    baseUrl: vars.baseUrl,
  });

  try {
    const parsed = new URL(resolved);
    if (!parsed.searchParams.has('widgetId')) parsed.searchParams.set('widgetId', widget.id);
    return parsed.toString();
  } catch {
    return resolved;
  }
}
