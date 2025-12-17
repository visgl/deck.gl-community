import {describe, it, expect} from 'vitest';
import {HorizonGraphLayer, MultiHorizonGraphLayer} from '../src';

describe('@deck.gl-community/timeline-layers', () => {
  it('exports HorizonGraph layers', () => {
    expect(HorizonGraphLayer).toBeDefined();
    expect(MultiHorizonGraphLayer).toBeDefined();
  });
});
