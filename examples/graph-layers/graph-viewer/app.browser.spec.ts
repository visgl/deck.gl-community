// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck} from '@deck.gl/core';
import {D3ForceLayout} from '@deck.gl-community/graph-layers';
import {expect, test, vi} from 'vitest';
import {mountGraphViewerExample} from './app';

test('keeps the loading overlay visible across frames while an async layout is pending', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:800px;height:600px';
  document.body.append(host);
  // Hold the worker response while retaining the real layout-start event and deck rendering.
  const engageWorker = vi
    .spyOn(D3ForceLayout.prototype, '_engageWorker')
    .mockImplementation(() => {});
  const setProps = vi.spyOn(Deck.prototype, 'setProps');
  const unmount = mountGraphViewerExample(host, {graphType: 'graph'});
  try {
    await vi.waitFor(() => expect(engageWorker).toHaveBeenCalled(), {timeout: 10_000});
    const layout = engageWorker.mock.contexts[0];
    const deck = setProps.mock.contexts[0];
    const afterRender = vi.fn(deck.props.onAfterRender);
    deck.setProps({onAfterRender: afterRender});
    deck.redraw('pending layout overlay regression');
    await vi.waitFor(() => expect(afterRender).toHaveBeenCalled(), {timeout: 10_000});
    const overlay = [...host.querySelectorAll('div')].find(
      element => element.textContent === 'Computing layout...'
    )!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.style.display).toBe('flex');
    layout.getProps().onLayoutDone?.({bounds: null});
    expect(overlay.hidden).toBe(true);
    expect(overlay.style.display).toBe('none');
  } finally {
    unmount();
    host.remove();
    vi.restoreAllMocks();
  }
}, 30_000);
