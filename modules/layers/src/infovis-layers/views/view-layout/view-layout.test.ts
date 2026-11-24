import {OrthographicView} from '@deck.gl/core';
import {describe, expect, it} from 'vitest';

import {buildViewsFromViewLayout, ViewLayoutItem} from '.';

describe('buildViewsFromViewLayout', () => {
  it('splits remaining row width evenly across children without explicit widths', () => {
    const layout = new ViewLayoutItem({
      type: 'row',
      children: [
        new OrthographicView({id: 'fixed', width: 100}),
        new OrthographicView({id: 'flex-a'}),
        new OrthographicView({id: 'flex-b'})
      ]
    });

    const compiled = buildViewsFromViewLayout({
      layout,
      width: 400,
      height: 120
    });

    expect(compiled.rectsById.fixed).toEqual({x: 0, y: 0, width: 100, height: 120});
    expect(compiled.rectsById['flex-a']).toEqual({x: 100, y: 0, width: 150, height: 120});
    expect(compiled.rectsById['flex-b']).toEqual({x: 250, y: 0, width: 150, height: 120});
  });

  it('splits remaining column height evenly across children without explicit heights', () => {
    const layout = new ViewLayoutItem({
      type: 'column',
      children: [
        new OrthographicView({id: 'header', height: 40}),
        new OrthographicView({id: 'body-a'}),
        new OrthographicView({id: 'body-b'})
      ]
    });

    const compiled = buildViewsFromViewLayout({
      layout,
      width: 200,
      height: 200
    });

    expect(compiled.rectsById.header).toEqual({x: 0, y: 0, width: 200, height: 40});
    expect(compiled.rectsById['body-a']).toEqual({x: 0, y: 40, width: 200, height: 80});
    expect(compiled.rectsById['body-b']).toEqual({x: 0, y: 120, width: 200, height: 80});
  });

  it('resolves overlay children against the same parent bounds', () => {
    const layout = new ViewLayoutItem({
      type: 'overlay',
      children: [new OrthographicView({id: 'base'}), new OrthographicView({id: 'top'})]
    });

    const compiled = buildViewsFromViewLayout({
      layout,
      width: 320,
      height: 180
    });

    expect(compiled.rectsById.base).toEqual({x: 0, y: 0, width: 320, height: 180});
    expect(compiled.rectsById.top).toEqual({x: 0, y: 0, width: 320, height: 180});
  });

  it('resolves raw view expressions against the current parent bounds', () => {
    const layout = new ViewLayoutItem({
      type: 'overlay',
      children: [
        new OrthographicView({
          id: 'calc-view',
          x: 10,
          y: '10%',
          width: 'calc(50% - 20px)',
          height: '50%'
        })
      ]
    });

    const compiled = buildViewsFromViewLayout({
      layout,
      width: 300,
      height: 200
    });

    expect(compiled.rectsById['calc-view']).toEqual({x: 10, y: 20, width: 130, height: 100});
  });

  it('supports nested items and reuses unchanged compiled views by id', () => {
    const layout = new ViewLayoutItem({
      type: 'column',
      children: [
        new ViewLayoutItem({
          type: 'row',
          height: 50,
          children: [
            new ViewLayoutItem({type: 'spacer', width: 80}),
            new OrthographicView({id: 'header'})
          ]
        }),
        new ViewLayoutItem({
          type: 'row',
          children: [
            new OrthographicView({id: 'legend', width: 80}),
            new OrthographicView({id: 'main'})
          ]
        })
      ]
    });

    const first = buildViewsFromViewLayout({
      layout,
      width: 300,
      height: 200
    });
    const second = buildViewsFromViewLayout({
      layout,
      width: 300,
      height: 200,
      previous: first
    });

    expect(second.rectsById.header).toEqual({x: 80, y: 0, width: 220, height: 50});
    expect(second.rectsById.legend).toEqual({x: 0, y: 50, width: 80, height: 150});
    expect(second.rectsById.main).toEqual({x: 80, y: 50, width: 220, height: 150});
    expect(second.views.find(view => view.props.id === 'main')).toBe(
      first.views.find(view => view.props.id === 'main')
    );
  });
});
