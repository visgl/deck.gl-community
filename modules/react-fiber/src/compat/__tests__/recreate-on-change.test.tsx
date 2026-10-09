import {render, waitFor} from '@testing-library/react';
import {createRef} from 'react';
import {describe, expect, it, vi} from 'vitest';
import type {DeckGLRef} from '../mapbox';

const mapboxOverlay = vi.hoisted(() =>
  vi.fn(function MapboxOverlay(props: unknown) {
    return {finalize: vi.fn(), props, setProps: vi.fn()};
  })
);

vi.mock('@deck.gl/mapbox', () => ({MapboxOverlay: mapboxOverlay}));

const {DeckGL} = await import('../mapbox');

describe('compat recreateOnChange', () => {
  it('points ref.deck at the replacement overlay after interleaved changes', async () => {
    const ref = createRef<DeckGLRef>();
    const {rerender, unmount} = render(<DeckGL ref={ref} interleaved={false} />);
    await waitFor(() => expect(ref.current?.deck).toBe(mapboxOverlay.mock.results[0]?.value));
    const firstOverlay = mapboxOverlay.mock.results[0]?.value;

    rerender(<DeckGL ref={ref} interleaved />);

    await waitFor(() => expect(ref.current?.deck).toBe(mapboxOverlay.mock.results[1]?.value));
    expect(firstOverlay.finalize).toHaveBeenCalledOnce();
    expect(mapboxOverlay).toHaveBeenLastCalledWith(expect.objectContaining({interleaved: true}));

    unmount();
  });
});
