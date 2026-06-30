import {describe, expect, it} from 'vitest';

import {DEFAULT_TRACE_FONT_FAMILY, DEFAULT_TRACE_STYLE, makeTraceStyle} from './trace-style';

describe('trace style', () => {
  it('uses a standard default font family for OSS Tracevis deck text', () => {
    expect(DEFAULT_TRACE_FONT_FAMILY).toBe('system-ui, sans-serif');
    expect(DEFAULT_TRACE_STYLE.fontFamily).toBe(DEFAULT_TRACE_FONT_FAMILY);
  });

  it('lets callers configure the deck text font family', () => {
    const traceStyle = makeTraceStyle({
      fontFamily: '"Brand Sans", system-ui, sans-serif'
    });

    expect(traceStyle.fontFamily).toBe('"Brand Sans", system-ui, sans-serif');
  });
});
