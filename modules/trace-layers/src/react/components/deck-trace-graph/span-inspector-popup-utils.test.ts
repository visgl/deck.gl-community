import {describe, expect, it} from 'vitest';

import {
  clampSpanInspectorTabBodyHeightPx,
  clampSpanInspectorWidthPx,
  getSpanInspectorMaxTabBodyHeightPx,
  getSpanInspectorMaxWidthPx
} from './span-inspector-popup-utils';

describe('span-inspector-popup-utils', () => {
  it('clamps the tab-body height to the configured min and max range', () => {
    expect(clampSpanInspectorTabBodyHeightPx(80, 116, 220)).toBe(116);
    expect(clampSpanInspectorTabBodyHeightPx(180, 116, 220)).toBe(180);
    expect(clampSpanInspectorTabBodyHeightPx(280, 116, 220)).toBe(220);
  });

  it('clamps the popup width to the configured min and max range', () => {
    expect(clampSpanInspectorWidthPx(240, 320, 720)).toBe(320);
    expect(clampSpanInspectorWidthPx(480, 320, 720)).toBe(480);
    expect(clampSpanInspectorWidthPx(920, 320, 720)).toBe(720);
  });

  it('subtracts fixed popup chrome when resolving the maximum tab-body height', () => {
    const container = {
      getBoundingClientRect: () => ({
        height: 180,
        bottom: 300
      })
    } as HTMLDivElement;

    expect(getSpanInspectorMaxTabBodyHeightPx(400, container, 116)).toBe(224);
  });

  it('never returns less than the default minimum tab-body height', () => {
    expect(getSpanInspectorMaxTabBodyHeightPx(80, null, 116)).toBe(116);
  });

  it('uses the popup right edge to resolve the maximum popup width', () => {
    const container = {
      getBoundingClientRect: () => ({
        right: 500
      })
    } as HTMLDivElement;

    expect(getSpanInspectorMaxWidthPx(1200, container)).toBe(488);
  });

  it('never returns less than the default minimum popup width', () => {
    expect(getSpanInspectorMaxWidthPx(200, null)).toBe(320);
  });
});
