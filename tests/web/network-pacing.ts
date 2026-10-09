/* Author: ramanpal singh | URL: https://kwebby.com */
import type { BrowserContext } from '@playwright/test';
import { setTimeout as sleep } from 'node:timers/promises';

// The production API allows 300 requests/minute. Browser automation can traverse
// dozens of screens in seconds, so dispatch real requests at a human-scale pace.
// Leave room for server-rendered API reads, which browser routing cannot observe.
const intervalMs = 350;
const installed = new WeakSet<BrowserContext>();
let nextDispatch = 0;

export async function paceApiRequests(context: BrowserContext): Promise<void> {
  if (installed.has(context)) return;
  installed.add(context);
  const closed = new AbortController();
  context.on('close', () => closed.abort());
  await context.route('**/api/v1/**', async (route) => {
    const current = performance.now();
    const scheduled = Math.max(current, nextDispatch);
    nextDispatch = scheduled + intervalMs;
    try {
      if (scheduled > current) await sleep(scheduled - current, undefined, { signal: closed.signal });
      if (!closed.signal.aborted) await route.fallback();
    } catch (error) {
      // Navigation can abort a fetch while it waits for its pacing slot. A page
      // interceptor can also finish that route first; there is nothing to send
      // again. Other routing errors remain failures and HTTP responses are real.
      const alreadyHandled = error instanceof Error && error.message.includes('Route is already handled!');
      if (!closed.signal.aborted && !alreadyHandled) throw error;
    }
  });
}
