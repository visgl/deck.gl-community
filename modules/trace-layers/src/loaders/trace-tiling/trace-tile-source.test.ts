import {describe, expect, it} from 'vitest';

import {TraceTileSource} from './trace-tile-source';

import type {TraceSpanTableRow, TraceTileTableInput} from './trace-tile-source';

describe('TraceTileSource', () => {
  it('returns metadata with normalized options and finite source spans', async () => {
    const source = new TraceTileSource(
      {
        spans: {
          rows: [
            span('a', 10, 20),
            span('invalid-end', 30, 30),
            span('invalid-start', Number.NaN, 40)
          ]
        },
        processes: {rows: [{processId: 'process-a', name: 'Process A'}]},
        threads: {rows: [{processId: 'process-a', threadId: 'thread-a', name: 'Thread A'}]}
      },
      {
        maxZoom: 99,
        indexMaxZoom: 99,
        maxSpansPerTile: 0
      }
    );

    await source.ready;
    const metadata = await source.getMetadata();

    expect(metadata).toMatchObject({
      minZoom: 0,
      maxZoom: 24,
      sourceSpanCount: 1,
      processCount: 1,
      threadCount: 1,
      timeRange: {startTimeMs: 10, endTimeMs: 20}
    });
    expect(metadata.options.indexMaxZoom).toBe(24);
    expect(metadata.options.maxSpansPerTile).toBe(1);
  });

  it('returns async and sync root tiles after ready', async () => {
    const source = new TraceTileSource(input([span('a', 0, 5), span('b', 5, 10)]));

    await source.ready;

    const syncTile = source.getTileSync({z: 0, x: 0, y: 0});
    const asyncTile = await source.getTile({z: 0, x: 0, y: 0});
    const tileData = await source.getTileData({index: {z: 0, x: 0, y: 0}});

    expect(syncTile?.shape).toBe('trace-tile-table');
    expect(syncTile?.spans.rows.map(row => row.spanId)).toEqual(['a', 'b']);
    expect(asyncTile).toEqual(syncTile);
    expect(tileData).toEqual(syncTile);
  });

  it('rejects non-zero y tile indexes', async () => {
    const source = new TraceTileSource(input([span('a', 0, 5)]));

    await source.ready;

    await expect(source.getTile({z: 0, x: 0, y: 1})).resolves.toBeNull();
    expect(source.getTileSync({z: 0, x: 0, y: 1})).toBeNull();
  });

  it('returns an empty root tile for empty input', async () => {
    const source = new TraceTileSource(input([]));

    await source.ready;
    const metadata = await source.getMetadata();
    const tile = source.getTileSync({z: 0, x: 0, y: 0});

    expect(metadata.timeRange).toEqual({startTimeMs: 0, endTimeMs: 0});
    expect(tile).toMatchObject({
      sourceSpanCount: 0,
      returnedSpanCount: 0,
      hiddenSpanCount: 0,
      timeRange: {startTimeMs: 0, endTimeMs: 0}
    });
  });

  it('computes 1D tile time bounds from z and x', async () => {
    const source = new TraceTileSource(input([span('a', 0, 100)]), {
      maxZoom: 4,
      indexMaxZoom: 2
    });

    await source.ready;
    const tile = source.getTileSync({z: 2, x: 1, y: 0});

    expect(tile?.timeRange).toEqual({startTimeMs: 25, endTimeMs: 50});
    expect(tile?.sourceSpanCount).toBe(1);
  });

  it('drills down on demand above the prebuilt index zoom', async () => {
    const source = new TraceTileSource(
      input([span('target', 66, 70), span('outside', 0, 10), span('bounds', 95, 100)]),
      {
        maxZoom: 4,
        indexMaxZoom: 0
      }
    );

    await source.ready;
    const tile = source.getTileSync({z: 3, x: 5, y: 0});

    expect(tile?.timeRange).toEqual({startTimeMs: 62.5, endTimeMs: 75});
    expect(tile?.spans.rows.map(row => row.spanId)).toEqual(['target']);
  });

  it('returns null for tiles beyond the clamped max zoom', async () => {
    const source = new TraceTileSource(input([span('a', 0, 10)]), {
      maxZoom: 2,
      indexMaxZoom: 5
    });

    await source.ready;
    const metadata = await source.getMetadata();

    expect(metadata.options.indexMaxZoom).toBe(2);
    expect(source.getTileSync({z: 3, x: 0, y: 0})).toBeNull();
  });

  it('clips spans crossing tile boundaries and marks continuation borders', async () => {
    const source = new TraceTileSource(input([span('crossing', 25, 75), span('bounds', 0, 100)]), {
      maxZoom: 2,
      indexMaxZoom: 1
    });

    await source.ready;
    const leftTile = source.getTileSync({z: 1, x: 0, y: 0});
    const rightTile = source.getTileSync({z: 1, x: 1, y: 0});
    const leftCrossing = leftTile?.spans.rows.find(row => row.spanId === 'crossing');
    const rightCrossing = rightTile?.spans.rows.find(row => row.spanId === 'crossing');

    expect(leftCrossing).toMatchObject({
      spanId: 'crossing',
      visibleStartTimeMs: 25,
      visibleEndTimeMs: 50,
      drawStartBorder: true,
      drawEndBorder: false
    });
    expect(rightCrossing).toMatchObject({
      spanId: 'crossing',
      visibleStartTimeMs: 50,
      visibleEndTimeMs: 75,
      drawStartBorder: false,
      drawEndBorder: true
    });
    expect(leftCrossing?.tileFragmentId).not.toBe(rightCrossing?.tileFragmentId);
  });

  it('selects stable lane-duration representatives and reports hidden spans', async () => {
    const source = new TraceTileSource(
      input([
        span('lane-0-short', 0, 10, 0),
        span('lane-0-long', 20, 80, 0),
        span('lane-1-long', 100, 190, 1),
        span('lane-1-short', 200, 210, 1),
        span('tiny', 300, 301, 2)
      ]),
      {
        maxSpansPerTile: 2,
        tileSize: 100,
        minSpanPixelWidth: 2
      }
    );

    await source.ready;
    const tile = source.getTileSync({z: 0, x: 0, y: 0});

    expect(tile?.spans.rows.map(row => row.spanId)).toEqual(['lane-0-long', 'lane-1-long']);
    expect(tile?.sourceSpanCount).toBe(5);
    expect(tile?.returnedSpanCount).toBe(2);
    expect(tile?.hiddenSpanCount).toBe(3);
    expect(tile?.lod).toMatchObject({
      zoom: 0,
      level: 0,
      representativeStrategy: 'lane-duration'
    });
  });

  it('supports duration-only representative selection', async () => {
    const source = new TraceTileSource(
      input([
        span('lane-0', 0, 20, 0),
        span('lane-1-longest', 30, 90, 1),
        span('lane-2', 100, 110, 2)
      ]),
      {
        maxSpansPerTile: 1,
        representativeStrategy: 'duration'
      }
    );

    await source.ready;
    const tile = source.getTileSync({z: 0, x: 0, y: 0});

    expect(tile?.spans.rows.map(row => row.spanId)).toEqual(['lane-1-longest']);
  });
});

function input(spans: readonly TraceSpanTableRow[]): TraceTileTableInput {
  return {
    spans: {rows: spans}
  };
}

function span(spanId: string, startTimeMs: number, endTimeMs: number, lane = 0): TraceSpanTableRow {
  return {
    spanId,
    processId: 'process-a',
    threadId: 'thread-a',
    startTimeMs,
    endTimeMs,
    lane,
    name: spanId
  };
}
