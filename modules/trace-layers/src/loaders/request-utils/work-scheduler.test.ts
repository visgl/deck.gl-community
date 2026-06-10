import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {log} from '../../trace/log';
import {WorkScheduler} from './work-scheduler';

vi.mock('../../trace/log', () => ({
  getHeapUsageProbeFields: vi.fn(() => ({usedJSHeapSize: 123})),
  log: {
    makeModestObject: vi.fn((value: unknown) => value),
    probe: vi.fn(() => () => {})
  }
}));

/** Flushes promise callbacks queued by the scheduler. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

/** Advances the scheduler's timeout plus browser-yield fallbacks used in tests. */
async function advanceSchedulerYield(delayMs: number): Promise<void> {
  await flushMicrotasks();
  await vi.advanceTimersByTimeAsync(delayMs);
  for (let i = 0; i < 5; i += 1) {
    await flushMicrotasks();
    await vi.runOnlyPendingTimersAsync();
  }
}

describe('WorkScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('scheduler', {yield: vi.fn(async () => {})});
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      globalThis.setTimeout(() => callback(performance.now()), 0)
    );
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) =>
      globalThis.setTimeout(
        () => callback({didTimeout: false, timeRemaining: () => 50} as IdleDeadline),
        0
      )
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('runs queued work one at a time with a delay between jobs', async () => {
    const scheduler = new WorkScheduler({delayMs: 100});
    const order: string[] = [];
    let finishFirst: (() => void) | undefined;

    const first = scheduler.run({actionName: 'first action'}, async () => {
      order.push('first-start');
      await new Promise<void>(resolve => {
        finishFirst = resolve;
      });
      order.push('first-end');
      return 1;
    });
    const second = scheduler.run({actionName: 'second action'}, () => {
      order.push('second');
      return 2;
    });

    await flushMicrotasks();
    expect(order).toEqual(['first-start']);

    finishFirst?.();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(await first).toBe(1);
    expect(order).toEqual(['first-start', 'first-end']);

    await vi.advanceTimersByTimeAsync(99);
    expect(order).toEqual(['first-start', 'first-end']);

    await vi.advanceTimersByTimeAsync(1);
    await advanceSchedulerYield(0);
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('continues draining after a queued job rejects', async () => {
    const scheduler = new WorkScheduler({delayMs: 100});
    const order: string[] = [];

    const first = scheduler.run({actionName: 'first action'}, () => {
      order.push('first');
      throw new Error('failed');
    });
    const second = scheduler.run({actionName: 'second action'}, () => {
      order.push('second');
      return 2;
    });

    await expect(first).rejects.toThrow('failed');
    expect(order).toEqual(['first']);

    await advanceSchedulerYield(100);
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(['first', 'second']);
  });

  it('emits badged schedule start and complete probes for named work', async () => {
    const scheduler = new WorkScheduler({id: 'test-scheduler', delayMs: 100});
    const probeSpy = vi.mocked(log.probe);

    await expect(
      scheduler.run({actionName: 'test action', badgeColor: 'purple'}, () => 7)
    ).resolves.toBe(7);

    expect(probeSpy).toHaveBeenCalledTimes(3);
    expect(probeSpy.mock.calls.map(call => call[1])).toEqual([
      '%ctest action%c %c[schedule]%c',
      '%ctest action%c %c[start]%c',
      expect.stringMatching(/^%ctest action%c %c\[complete\]%c %c.*%c$/)
    ]);
    expect(probeSpy.mock.calls[0]?.[2]).toContain('background:#7c3aed');
    expect(probeSpy.mock.calls[0]?.[0]).toBe(1);
    expect(probeSpy.mock.calls[1]?.[0]).toBe(1);
    expect(probeSpy.mock.calls[2]?.[0]).toBe(0);
    expect(probeSpy.mock.calls[0]?.[4]).toContain('background:#6b7280');
    expect(probeSpy.mock.calls[1]?.[4]).toContain('background:#b45309');
    expect(probeSpy.mock.calls[2]?.[4]).toContain('background:#047857');
    expect(probeSpy.mock.calls[2]?.[6]).toContain('background:#047857');
    expect(probeSpy.mock.calls[0]).toHaveLength(7);
    expect(probeSpy.mock.calls[1]).toHaveLength(7);
    expect(probeSpy.mock.calls[2]).toHaveLength(9);
    expect(probeSpy.mock.calls[2]?.at(-1)).toMatchObject({
      durationMs: expect.any(Number),
      usedJSHeapSize: 123
    });
  });

  it('runs synchronous work immediately with colored probes', () => {
    const scheduler = new WorkScheduler({id: 'test-scheduler', delayMs: 100});
    const probeSpy = vi.mocked(log.probe);
    const order: string[] = [];

    const result = scheduler.runSync({actionName: 'sync action', badgeColor: 'orange'}, () => {
      order.push('sync');
      return 9;
    });

    expect(result).toBe(9);
    expect(order).toEqual(['sync']);
    expect(probeSpy).toHaveBeenCalledTimes(3);
    expect(probeSpy.mock.calls.map(call => call[1])).toEqual([
      '%csync action%c %c[schedule]%c',
      '%csync action%c %c[start]%c',
      expect.stringMatching(/^%csync action%c %c\[complete\]%c %c.*%c$/)
    ]);
    expect(probeSpy.mock.calls[0]?.[2]).toContain('background:#b45309');
  });

  it('emits a post-idle heap probe after the configured gap', async () => {
    const scheduler = new WorkScheduler({id: 'test-scheduler', delayMs: 100});
    const probeSpy = vi.mocked(log.probe);

    await expect(scheduler.run({actionName: 'test action'}, () => 7)).resolves.toBe(7);
    expect(probeSpy.mock.calls.map(call => call[1])).toEqual([
      '%ctest action%c %c[schedule]%c',
      '%ctest action%c %c[start]%c',
      expect.stringMatching(/^%ctest action%c %c\[complete\]%c %c.*%c$/)
    ]);

    await advanceSchedulerYield(100);
    expect(probeSpy.mock.calls.at(-1)?.[0]).toBe(0);
    expect(probeSpy.mock.calls.at(-1)?.[1]).toBe('%ctest action%c %c[idle]%c');
    expect(probeSpy.mock.calls.at(-1)?.[4]).toContain('background:#2563eb');
    expect(probeSpy.mock.calls.at(-1)).toHaveLength(7);
    expect(probeSpy.mock.calls.at(-1)?.at(-1)).toMatchObject({
      durationSinceFinishMs: expect.any(Number),
      idleDelayMs: 100,
      usedJSHeapSize: 123
    });
  });
});
