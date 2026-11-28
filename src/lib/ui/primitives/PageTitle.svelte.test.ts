// @vitest-environment happy-dom

import { render } from '@testing-library/svelte';
import { expect, test } from 'vitest';

import { DEFAULT_APP_NAME } from '#lib/deployment/default-app-name.js';
import PageTitle from './PageTitle.svelte';

test('updates the title without replacing its place in the stack', async () => {
  const room = render(PageTitle, { title: 'General' });
  const settings = render(PageTitle, { title: 'Account' });

  await room.rerender({ title: 'General (1)' });
  expect(document.title).toBe(`Account - ${DEFAULT_APP_NAME}`);

  await settings.rerender({ title: 'Appearance' });
  expect(document.title).toBe(`Appearance - ${DEFAULT_APP_NAME}`);

  settings.unmount();
  expect(document.title).toBe(`General (1) - ${DEFAULT_APP_NAME}`);
});

test('does not restore a page that unmounted below the current page', () => {
  document.title = DEFAULT_APP_NAME;
  const outgoing = render(PageTitle, { title: 'Account' });
  const incoming = render(PageTitle, { title: 'Appearance' });

  outgoing.unmount();
  expect(document.title).toBe(`Appearance - ${DEFAULT_APP_NAME}`);

  incoming.unmount();
  expect(document.title).toBe(DEFAULT_APP_NAME);
});

test('tracks pages with identical titles independently', () => {
  document.title = `General - ${DEFAULT_APP_NAME}`;
  const first = render(PageTitle, { title: 'Settings' });
  const second = render(PageTitle, { title: 'Settings' });

  first.unmount();
  expect(document.title).toBe(`Settings - ${DEFAULT_APP_NAME}`);

  second.unmount();
  expect(document.title).toBe(`General - ${DEFAULT_APP_NAME}`);
});
