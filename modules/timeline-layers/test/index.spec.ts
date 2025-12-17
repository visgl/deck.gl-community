import {describe, it, expect} from 'vitest';
import {
  HorizonGraphLayer,
  MultiHorizonGraphLayer,
  TimeAxisLayer,
  VerticalGridLayer,
  formatTimeMs
} from '../src';

describe('@deck.gl-community/timeline-layers', () => {
  it('exports HorizonGraph layers', () => {
    expect(HorizonGraphLayer).toBeDefined();
    expect(MultiHorizonGraphLayer).toBeDefined();
  });

  it('exports timeline utilities', () => {
    expect(TimeAxisLayer).toBeDefined();
    expect(VerticalGridLayer).toBeDefined();
    expect(formatTimeMs).toBeTypeOf('function');
  });
});
