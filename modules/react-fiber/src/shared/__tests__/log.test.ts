import {log as deckLog} from '@deck.gl/core';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {log, RECONCILER_LOG_LEVEL} from '../log';

describe('reconciler log', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes trace messages through the deck.gl log at the reconciler level', () => {
    const emit = vi.fn<() => void>();
    const deckLogSpy = vi.spyOn(deckLog, 'log').mockReturnValue(emit);
    const metadata = {type: 'scatterplotLayer'};

    log.withMetadata(metadata).debug('createInstance');
    log.debug('createTextInstance');

    expect(deckLogSpy).toHaveBeenNthCalledWith(
      1,
      RECONCILER_LOG_LEVEL,
      '[react-fiber] createInstance',
      metadata
    );
    expect(deckLogSpy).toHaveBeenNthCalledWith(
      2,
      RECONCILER_LOG_LEVEL,
      '[react-fiber] createTextInstance'
    );
    expect(emit).toHaveBeenCalledTimes(2);
  });
});
