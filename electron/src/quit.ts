export const EXIT_HANGUP_TIMEOUT_MS = 3_000;

export interface CoreQuitTarget {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  once(event: 'exit', listener: () => void): unknown;
  off(event: 'message', listener: (message: unknown) => void): unknown;
  off(event: 'exit', listener: () => void): unknown;
}

export function endCoreCalls(
  core: CoreQuitTarget | null,
  timeoutMs = EXIT_HANGUP_TIMEOUT_MS
): Promise<void> {
  if (!core) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      core.off('message', onMessage);
      core.off('exit', finish);
      resolve();
    };

    const onMessage = (message: unknown) => {
      if (typeof message === 'object' && message !== null && 'callsEnded' in message) {
        finish();
      }
    };

    const timer = setTimeout(finish, timeoutMs);
    core.on('message', onMessage);
    core.once('exit', finish);

    try {
      core.postMessage('end-calls');
    } catch {
      finish();
    }
  });
}

export function createQuitGuard(
  finish: () => Promise<void>
): (event: { preventDefault: () => void }, quit: () => void) => boolean {
  let done = false;
  let running = false;

  return (event, quit) => {
    if (done) return false;
    event.preventDefault();
    if (running) return true;
    running = true;
    void finish().finally(() => {
      done = true;
      running = false;
      quit();
    });
    return true;
  };
}
