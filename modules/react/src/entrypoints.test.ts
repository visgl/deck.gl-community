// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {readFileSync} from 'fs';
import {BoxPanelContainer, SidebarPanelContainer} from '@deck.gl-community/panels';
import {describe, expect, it, vi} from 'vitest';
import {DeckCanvas, Panel} from './index';
import * as legacy from './legacy';

// Legacy icons register a browser custom element as a side effect.
vi.mock('boxicons', () => ({}));

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('@deck.gl-community/react entry points', () => {
  it('exports DeckCanvas from the package root', () => {
    expect(DeckCanvas).toBeTypeOf('function');
    expect(packageJson.exports['./deck-canvas']).toBeUndefined();
  });

  it('provides the supported React DOM exports from the legacy subpath', () => {
    expect(Object.keys(legacy).sort()).toEqual(['Button', 'Icon', 'Panel', 'useReactPanel']);
    expect(packageJson.exports['./legacy']).toEqual({
      types: './dist/legacy.d.ts',
      require: './dist/legacy.cjs',
      import: './dist/legacy.js'
    });
  });

  it('wraps a chosen panel component as a native Fiber widget', () => {
    const box = Panel({
      type: BoxPanelContainer,
      id: 'box',
      title: 'Tools',
      widthPx: 320
    });
    expect(box).toMatchObject({
      type: 'deckWidget',
      props: {
        widget: {
          id: 'box',
          component: expect.any(BoxPanelContainer),
          props: {title: 'Tools', widthPx: 320}
        }
      }
    });

    const sidebar = Panel({type: SidebarPanelContainer, id: 'sidebar', side: 'right'});
    expect(sidebar).toMatchObject({
      type: 'deckWidget',
      props: {widget: {id: 'sidebar', component: expect.any(SidebarPanelContainer)}}
    });
  });
});
