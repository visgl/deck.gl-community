import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {RequestScheduler} from './request-scheduler';

/** Advances the scheduler's timer-backed queue refresh. */
async function flushSchedulerTimers(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

describe('RequestScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not grant more than maxRequests slots at once', async () => {
    const scheduler = new RequestScheduler({maxRequests: 2});
    const firstGrant = scheduler.scheduleRequest('first');
    const secondGrant = scheduler.scheduleRequest('second');
    const thirdGrant = scheduler.scheduleRequest('third');
    const granted: string[] = [];

    firstGrant.then(grant => {
      if (grant) {
        granted.push('first');
      }
    });
    secondGrant.then(grant => {
      if (grant) {
        granted.push('second');
      }
    });
    thirdGrant.then(grant => {
      if (grant) {
        granted.push('third');
      }
    });

    await flushSchedulerTimers();

    expect(granted).toEqual(['first', 'second']);
    expect(scheduler.activeRequestCount).toBe(2);
  });

  it('grants a queued request when an active request calls done', async () => {
    const scheduler = new RequestScheduler({maxRequests: 1});
    const firstGrantPromise = scheduler.scheduleRequest('first');
    const secondGrantPromise = scheduler.scheduleRequest('second');

    await flushSchedulerTimers();

    const firstGrant = await firstGrantPromise;
    let secondGrant = await Promise.race([secondGrantPromise, Promise.resolve('pending')]);
    expect(firstGrant).not.toBeNull();
    expect(secondGrant).toBe('pending');

    firstGrant?.done();
    await flushSchedulerTimers();

    const resolvedSecondGrant = await secondGrantPromise;
    expect(resolvedSecondGrant).toEqual({done: expect.any(Function)});
    expect(scheduler.activeRequestCount).toBe(1);
    resolvedSecondGrant?.done();
    await flushSchedulerTimers();
    expect(scheduler.activeRequestCount).toBe(0);
  });

  it('cancels queued requests whose priority becomes negative', async () => {
    const scheduler = new RequestScheduler({maxRequests: 1});
    let shouldCancelSecondRequest = false;
    const firstGrant = scheduler.scheduleRequest('first');
    const cancelledGrant = scheduler.scheduleRequest('second', () =>
      shouldCancelSecondRequest ? -1 : 0
    );

    await flushSchedulerTimers();
    shouldCancelSecondRequest = true;
    (await firstGrant)?.done();
    await flushSchedulerTimers();

    await expect(cancelledGrant).resolves.toBeNull();
    expect(scheduler.activeRequestCount).toBe(0);
  });

  it('grants immediately when throttling is disabled', async () => {
    const scheduler = new RequestScheduler({throttleRequests: false, maxRequests: 1});

    const grants = await Promise.all([
      scheduler.scheduleRequest('first'),
      scheduler.scheduleRequest('second')
    ]);

    expect(grants).toEqual([{done: expect.any(Function)}, {done: expect.any(Function)}]);
    expect(scheduler.activeRequestCount).toBe(0);
  });
});
