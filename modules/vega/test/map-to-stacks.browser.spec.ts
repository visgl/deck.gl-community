// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it} from 'vitest';
import type {Spec} from 'vega';
import {createVegaView} from '../../../examples/vega/create-vega-view';
import spec from '../../../examples/vega/map-to-stacks/spec.json';

it('moves stable city records into sector stacks with GPU interpolation and interrupted return', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:760px;height:480px';
  document.body.append(host);
  const example = createVegaView(host, spec as unknown as Spec);
  try {
    await example.ready;
    const view = example.view;
    const deck = view.presenter.deckgl;
    const getLayer = (): any => deck.layerManager.getLayers().find(l => l.id === 'LAYER_CUBES');
    await expect
      .poll(
        () =>
          Boolean(
            getLayer()?.getAttributeManager()?.getAttributes().instancePositions?.getBuffer()
          ),
        {timeout: 15000}
      )
      .toBe(true);
    const layer = getLayer();
    const timeline = layer.context.timeline;
    timeline.pause();
    const advanceTimeline = (time: number) => {
      timeline.setTime(time);
      getLayer().getAttributeManager().attributeTransitionManager.run();
      deck.redraw('map-to-stacks GPU readback');
    };
    const readAttribute = (name: string) => {
      const bytes = getLayer()
        .getAttributeManager()
        .getAttributes()
        [name].getBuffer()
        .readSyncWebGL();
      const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      // deck.gl packs float64 positions as interleaved xyz high/low float32 values.
      return name === 'instancePositions'
        ? Float32Array.from({length: 198 * 3}, (_, i) => values[Math.floor(i / 3) * 6 + (i % 3)])
        : values;
    };
    advanceTimeline(timeline.getTime() + 2000);
    const mapCubes = view.presenter
      .getCubeData()
      .map(cube => ({...cube, position: [...cube.position]}));
    expect(mapCubes).toHaveLength(198);
    const ordinals = mapCubes.map(cube => cube.ordinal);
    expect(new Set(ordinals).size).toBe(198);
    const mapPositions = Array.from(readAttribute('instancePositions'));
    const mapSizes = Array.from(readAttribute('instanceSizes'));
    expect(mapPositions[0]).toBeCloseTo(mapCubes[0].position[0], 3);
    expect(deck.props.getTooltip({object: mapCubes[0]} as any).text).toContain('City: Seattle');
    const cube = mapCubes[126];
    const [pickX, pickY] = deck
      .getViewports()[0]
      .project([cube.position[0] + cube.size[0] / 2, cube.position[1] + cube.size[1] / 2, 0]);
    await expect
      .poll(() => deck.pickObject({x: pickX, y: pickY, radius: 1})?.layer.id)
      .toBe('LAYER_CUBES');
    const select = host.querySelector<HTMLSelectElement>('select')!;
    select.value = 'stacks';
    select.dispatchEvent(new Event('change'));
    await expect.poll(() => view.presenter.getCubeData()[0].size[0]).toBe(8);
    await expect
      .poll(() =>
        getLayer()
          .getAttributeManager()
          .attributeTransitionManager.hasAttribute('instancePositions')
      )
      .toBe(true);
    await expect
      .poll(() =>
        getLayer().getAttributeManager().attributeTransitionManager.hasAttribute('instanceSizes')
      )
      .toBe(true);
    const stacks = view.presenter.getCubeData();
    expect(stacks.map(cube => cube.ordinal)).toEqual(ordinals);
    expect(stacks.map(cube => cube.color)).toEqual(mapCubes.map(cube => cube.color));
    const records = view.data('records');
    expect(records.filter(record => record.region === 'South')).toHaveLength(63);
    for (const region of ['West', 'Midwest', 'South', 'Northeast']) {
      const ranks = records
        .filter(record => record.region === region)
        .map(record => record.rank)
        .sort((a, b) => a - b);
      expect(ranks).toEqual(Array.from({length: ranks.length}, (_, i) => i + 1));
    }
    const start = timeline.getTime();
    advanceTimeline(start + 600);
    const middle = Array.from(readAttribute('instancePositions'));
    const middleSizes = Array.from(readAttribute('instanceSizes'));
    for (let i = 0; i < 198; i++) {
      for (let axis = 0; axis < 2; axis++) {
        expect(middle[i * 3 + axis]).toBeCloseTo(
          (mapPositions[i * 3 + axis] + stacks[i].position[axis]) / 2,
          2
        );
        expect(middleSizes[i * 3 + axis]).toBeCloseTo(
          (mapSizes[i * 3 + axis] + stacks[i].size[axis]) / 2,
          2
        );
      }
    }
    // Interrupt at the midpoint: the new transition starts at the rendered GPU pose.
    await view.signal('layout', 'map').runAsync();
    await expect.poll(() => view.presenter.getCubeData()[0].size[0]).toBe(6);
    await expect.poll(() => getLayer().props.data[0].size[0]).toBe(6);
    advanceTimeline(start + 600);
    readAttribute('instancePositions').forEach((value, i) =>
      expect(value).toBeCloseTo(middle[i], 2)
    );
    advanceTimeline(start + 1900);
    readAttribute('instancePositions').forEach((value, i) =>
      expect(value).toBeCloseTo(mapPositions[i], 2)
    );
    expect(view.presenter.getCubeData().map(cube => cube.ordinal)).toEqual(ordinals);
    await view.signal('layout', 'stacks').runAsync();
    await expect.poll(() => getLayer().props.data[0].size[0]).toBe(8);
    advanceTimeline(start + 3200);
    readAttribute('instancePositions').forEach((value, i) =>
      expect(value).toBeCloseTo(stacks[Math.floor(i / 3)].position[i % 3], 2)
    );
    host.style.width = '400px';
    window.dispatchEvent(new Event('resize'));
    await expect.poll(() => view.width()).toBe(370);
    await expect
      .poll(() => view.presenter.getCubeData()[0].size[0])
      .toBeCloseTo((8 * 370) / 700, 3);
    expect(view.presenter.getCubeData().map(cube => cube.ordinal)).toEqual(ordinals);
    expect(view.data('records')).toHaveLength(198);
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
  } finally {
    example.finalize();
    host.remove();
  }
}, 60000);
