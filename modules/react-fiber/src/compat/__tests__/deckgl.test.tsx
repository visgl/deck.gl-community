import {render, waitFor} from '@testing-library/react';
import {createRef, useLayoutEffect} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {DeckGLProps, DeckGLRef} from '../types';

const deck = vi.hoisted(() => ({
  pickMultipleObjects: vi.fn(() => ['multiple']),
  pickObject: vi.fn(() => 'object'),
  pickObjectAsync: vi.fn(async () => 'async-object'),
  pickObjects: vi.fn(() => ['objects']),
  pickObjectsAsync: vi.fn(async () => ['async-objects'])
}));

vi.mock('../../dom/components', () => ({
  DeckGL: ({
    children,
    onDeckglChange
  }: {
    children: React.ReactNode;
    onDeckglChange?: (deck: unknown) => void;
  }) => {
    useLayoutEffect(() => {
      onDeckglChange?.(deck);
      return () => onDeckglChange?.(null);
    }, [onDeckglChange]);

    return <>{children}</>;
  }
}));

const {DeckGL} = await import('../deckgl');

describe('DeckGL compatibility adapter', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('exposes the bounded ref surface and delegates picking after initialization', async () => {
    const ref = createRef<DeckGLRef>();
    render(<DeckGL ref={ref} initialViewState={{latitude: 0, longitude: 0, zoom: 1}} />);

    await waitFor(() => expect(ref.current?.deck).toBe(deck));
    expect(Object.keys(ref.current ?? {}).sort()).toEqual([
      'deck',
      'pickMultipleObjects',
      'pickObject',
      'pickObjectAsync',
      'pickObjects',
      'pickObjectsAsync'
    ]);
    expect(ref.current?.pickObject({x: 1, y: 2})).toBe('object');
    expect(ref.current?.pickObjects({x: 1, y: 2, width: 1, height: 1})).toEqual(['objects']);
    expect(ref.current?.pickMultipleObjects({x: 1, y: 2, radius: 1, depth: 1})).toEqual([
      'multiple'
    ]);
    await expect(ref.current?.pickObjectAsync({x: 1, y: 2})).resolves.toBe('async-object');
    await expect(ref.current?.pickObjectsAsync({x: 1, y: 2, width: 1, height: 1})).resolves.toEqual(
      ['async-objects']
    );
  });

  it('provides only the supported deck context value', async () => {
    const receivedValues: unknown[] = [];
    function ContextProvider({children, value}: React.ProviderProps<{deck: unknown}>) {
      receivedValues.push(value);
      return <>{children}</>;
    }

    render(
      <DeckGL ContextProvider={ContextProvider}>
        <layer layer={{id: 'layer'} as never} />
      </DeckGL>
    );

    await waitFor(() => expect(receivedValues).toContainEqual({deck}));
    expect(receivedValues.at(-1)).toEqual({deck});
  });

  it('warns only in development for unsupported renderer props and function children', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.NODE_ENV = 'development';

    render(
      <DeckGL
        {...({canvas: document.createElement('canvas'), children: () => null} as DeckGLProps)}
      />
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('DeckGL compat does not support canvas')
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('does not support function children')
    );

    warn.mockClear();
    process.env.NODE_ENV = 'production';
    render(
      <DeckGL
        {...({canvas: document.createElement('canvas'), children: () => null} as DeckGLProps)}
      />
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
