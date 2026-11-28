import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createQuitGuard, endCoreCalls, type CoreQuitTarget } from './quit';

class FakeCoreProcess extends EventEmitter implements CoreQuitTarget {
  posted: unknown[] = [];

  postMessage(message: unknown): void {
    this.posted.push(message);
  }
}

describe('endCoreCalls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('resolves immediately when core is not started', async () => {
    await expect(endCoreCalls(null)).resolves.toBeUndefined();
  });

  test('requests call hangup and resolves once callsEnded arrives', async () => {
    const core = new FakeCoreProcess();
    let resolved = false;
    const pending = endCoreCalls(core).then(() => {
      resolved = true;
    });

    expect(core.posted).toEqual(['end-calls']);
    core.emit('message', { keyringUnavailable: 'unrelated' });
    await Promise.resolve();
    expect(resolved).toBe(false);

    core.emit('message', { callsEnded: true });
    await pending;
    expect(resolved).toBe(true);
    expect(core.listenerCount('message')).toBe(0);
    expect(core.listenerCount('exit')).toBe(0);
  });

  test('resolves early when the core process exits', async () => {
    const core = new FakeCoreProcess();
    const pending = endCoreCalls(core);
    core.emit('exit', 0);
    await expect(pending).resolves.toBeUndefined();
    expect(core.listenerCount('message')).toBe(0);
    expect(core.listenerCount('exit')).toBe(0);
  });

  test('resolves after timeout if the core never replies', async () => {
    const core = new FakeCoreProcess();
    let resolved = false;
    const pending = endCoreCalls(core, 500).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(resolved).toBe(true);
    expect(core.listenerCount('message')).toBe(0);
    expect(core.listenerCount('exit')).toBe(0);
  });
});

describe('createQuitGuard', () => {
  test('prevents default once, deduplicates concurrent quit calls, and lets re-entered quit proceed', async () => {
    let resolveBlocker!: () => void;
    const blocker = new Promise<void>((resolve) => {
      resolveBlocker = resolve;
    });
    const finish = vi.fn(() => blocker);
    const guard = createQuitGuard(finish);
    const quit = vi.fn();

    const first = { preventDefault: vi.fn() };
    expect(guard(first, quit)).toBe(true);
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();

    const second = { preventDefault: vi.fn() };
    expect(guard(second, quit)).toBe(true);
    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();

    resolveBlocker();
    await vi.waitFor(() => {
      expect(quit).toHaveBeenCalledOnce();
    });

    const finalEvent = { preventDefault: vi.fn() };
    expect(guard(finalEvent, quit)).toBe(false);
    expect(finalEvent.preventDefault).not.toHaveBeenCalled();
  });
});
