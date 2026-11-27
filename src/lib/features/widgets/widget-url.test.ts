import { expect, test } from 'vitest';

import type { RoomWidget } from './widget-content.js';
import {
  attachScalarToken,
  needsScalarToken,
  templateWidgetUrl,
  WIDGET_CLIENT_ID,
} from './widget-url.js';

const vars = {
  userId: '@kris:example.org',
  roomId: '!abc:example.org',
  displayName: 'Kris',
  avatarUrl: 'mxc://example.org/avatar',
};

function widget(url: string, data: Record<string, unknown> = {}): RoomWidget {
  return { id: 'widget-1', type: 'grafana', url, name: 'Dashboard', data };
}

test('substitutes every template variable', () => {
  const url = templateWidgetUrl(
    widget(
      'https://widget.example/app?user=$matrix_user_id&room=$matrix_room_id&name=$matrix_display_name&avatar=$matrix_avatar_url&wid=$matrix_widget_id'
    ),
    vars
  );
  const parsed = new URL(url);
  expect(parsed.searchParams.get('user')).toBe(vars.userId);
  expect(parsed.searchParams.get('room')).toBe(vars.roomId);
  expect(parsed.searchParams.get('name')).toBe(vars.displayName);
  expect(parsed.searchParams.get('avatar')).toBe(vars.avatarUrl);
  expect(parsed.searchParams.get('wid')).toBe('widget-1');
});

test('substitutes the custom keys a widget carries in its own data', () => {
  const url = templateWidgetUrl(
    widget('https://widget.example/app?conf=$conferenceId&domain=$domain', {
      conferenceId: 'standup',
      domain: 'meet.example.org',
    }),
    vars
  );
  const parsed = new URL(url);
  expect(parsed.searchParams.get('conf')).toBe('standup');
  expect(parsed.searchParams.get('domain')).toBe('meet.example.org');
});

test('a widget cannot override a supplied variable through its own data', () => {
  const url = templateWidgetUrl(
    widget('https://widget.example/app?user=$matrix_user_id', {
      matrix_user_id: '@attacker:example.org',
    }),
    vars
  );
  expect(new URL(url).searchParams.get('user')).toBe(vars.userId);
});

test('substitutes the client identity variables', () => {
  const url = templateWidgetUrl(
    widget(
      'https://widget.example/app?client=$org.matrix.msc2873.client_id&device=$org.matrix.msc3819.matrix_device_id&base=$org.matrix.msc4039.matrix_base_url'
    ),
    { ...vars, deviceId: 'DEVICE1', baseUrl: 'https://matrix.example.org' }
  );
  const parsed = new URL(url);
  expect(parsed.searchParams.get('client')).toBe(WIDGET_CLIENT_ID);
  expect(parsed.searchParams.get('device')).toBe('DEVICE1');
  expect(parsed.searchParams.get('base')).toBe('https://matrix.example.org');
});

test('falls back to the user id when there is no display name', () => {
  const url = templateWidgetUrl(widget('https://widget.example/app?name=$matrix_display_name'), {
    ...vars,
    displayName: '',
  });
  expect(new URL(url).searchParams.get('name')).toBe(vars.userId);
});

test('adds a widgetId query parameter when absent', () => {
  const url = templateWidgetUrl(widget('https://widget.example/app'), vars);
  expect(new URL(url).searchParams.get('widgetId')).toBe('widget-1');
});

test('leaves an existing widgetId query parameter alone', () => {
  const url = templateWidgetUrl(widget('https://widget.example/app?widgetId=already-set'), vars);
  expect(new URL(url).searchParams.get('widgetId')).toBe('already-set');
});

test('percent-encodes a value that would otherwise inject a query parameter', () => {
  const url = templateWidgetUrl(widget('https://widget.example/app?name=$matrix_display_name'), {
    ...vars,
    displayName: 'Kris&admin=true',
  });
  const parsed = new URL(url);
  expect(parsed.searchParams.get('name')).toBe('Kris&admin=true');
  expect(parsed.searchParams.has('admin')).toBe(false);
});

test('percent-encodes a value that would otherwise break out of the query string', () => {
  const url = templateWidgetUrl(widget('https://widget.example/app?name=$matrix_display_name'), {
    ...vars,
    displayName: '#evil=1',
  });
  const parsed = new URL(url);
  expect(parsed.searchParams.get('name')).toBe('#evil=1');
  expect(parsed.hash).toBe('');
});

test('returns the templated string unchanged if the result is not a valid url', () => {
  const url = templateWidgetUrl(widget('not a url $matrix_user_id'), vars);
  expect(url).toBe(`not a url ${encodeURIComponent(vars.userId)}`);
});

test('detects widget urls that need a scalar token', () => {
  expect(
    needsScalarToken('https://scalar.vector.im/api/widgets/youtube.html?url=https%3A%2F%2Fyoutu.be%2Fabc')
  ).toBe(true);
  expect(
    needsScalarToken('https://integrations.element.io/api/widgets/youtube.html?widgetId=w1')
  ).toBe(true);
  expect(needsScalarToken('https://custom.example.org/api/widgets/etherpad.html')).toBe(true);
  expect(
    needsScalarToken('https://scalar.vector.im/api/widgets/youtube.html?scalar_token=already')
  ).toBe(false);
  expect(needsScalarToken('https://widget.example/app?user=$matrix_user_id')).toBe(false);
  expect(needsScalarToken('not a url')).toBe(false);
});

test('attaches scalar_token only to matching or Element Scalar alias origins', () => {
  const manager = 'https://scalar.vector.im/?scalar_token=s3&room_id=%21r%3Aexample.org';
  const sameOrigin = attachScalarToken(
    'https://scalar.vector.im/api/widgets/youtube.html?widgetId=w1',
    manager
  );
  expect(new URL(sameOrigin).searchParams.get('scalar_token')).toBe('s3');

  const alias = attachScalarToken(
    'https://integrations.element.io/api/widgets/youtube.html?widgetId=w1',
    manager
  );
  expect(new URL(alias).searchParams.get('scalar_token')).toBe('s3');

  const unrelated = 'https://evil.example.org/api/widgets/youtube.html?widgetId=w1';
  expect(attachScalarToken(unrelated, manager)).toBe(unrelated);

  const elementWidget = 'https://integrations.element.io/api/widgets/youtube.html?widgetId=w1';
  expect(
    attachScalarToken(
      elementWidget,
      'https://custom.example.org/?scalar_token=secret&room_id=%21r%3Aexample.org'
    )
  ).toBe(elementWidget);

  expect(attachScalarToken(elementWidget, 'https://scalar.vector.im/?room_id=%21r')).toBe(
    elementWidget
  );
});
