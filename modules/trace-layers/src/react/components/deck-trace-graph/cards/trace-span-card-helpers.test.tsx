import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {formatUserDataValue} from './trace-span-card-helpers';

describe('formatUserDataValue', () => {
  it('formats Arrow-like list and map values as readable JSON', () => {
    const rendered = renderSpanDataValue(
      new Map<string, unknown>([
        ['refs', new BigUint64Array([1n, 2n])],
        ['labels', new Set(['source', 'target'])],
        ['nested', createIterableSpanData(['a', 'b'])]
      ])
    );

    expect(rendered).toContain('&quot;refs&quot;');
    expect(rendered).toContain('&quot;1&quot;');
    expect(rendered).toContain('&quot;2&quot;');
    expect(rendered).toContain('&quot;labels&quot;');
    expect(rendered).toContain('&quot;source&quot;');
    expect(rendered).toContain('&quot;nested&quot;');
    expect(rendered).toContain('&quot;a&quot;');
  });
});

function renderSpanDataValue(value: unknown): string {
  const rendered = formatUserDataValue(value);
  return typeof rendered === 'string' ? rendered : renderToStaticMarkup(<>{rendered}</>);
}

function createIterableSpanData(values: readonly string[]): Iterable<string> {
  return {
    [Symbol.iterator]: () => values[Symbol.iterator]()
  };
}
