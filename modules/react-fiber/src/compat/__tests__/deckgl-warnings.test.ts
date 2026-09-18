/** @vitest-environment jsdom */
import {render} from '@testing-library/react';
import {createElement, useLayoutEffect} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {DeckGLProps} from '../types';

vi.mock('../../dom/components', () => ({
  DeckGL: ({
    children,
    onDeckglChange
  }: {
    children: React.ReactNode;
    onDeckglChange?: (deck: unknown) => void;
  }) => {
    useLayoutEffect(() => {
      onDeckglChange?.(null);
    }, [onDeckglChange]);

    return createElement('div', null, children);
  }
}));

const {DeckGL} = await import('../deckgl');

describe('DeckGL compatibility adapter warnings', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('warns only in development for unsupported renderer props and function children', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const props = {
      canvas: document.createElement('canvas'),
      children: () => null
    } as DeckGLProps;

    process.env.NODE_ENV = 'development';
    render(createElement(DeckGL, props));

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('DeckGL compat does not support canvas')
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('does not support function children')
    );

    warn.mockClear();
    process.env.NODE_ENV = 'production';
    render(createElement(DeckGL, props));
    expect(warn).not.toHaveBeenCalled();
  });
});
