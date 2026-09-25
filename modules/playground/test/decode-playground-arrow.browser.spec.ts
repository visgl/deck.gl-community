// deck.gl-community
// SPDX-License-Identifier: MIT

import {
  Bool,
  DateDay,
  Field,
  Float64,
  Int64,
  List,
  Struct,
  Table,
  TimestampMicrosecond,
  TimestampMillisecond,
  Utf8,
  tableFromArrays,
  tableToIPC,
  vectorFromArray
} from 'apache-arrow';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {decodePlaygroundArrow} from '../src/runtime/decode-playground-arrow';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Arrow import worker', () => {
  it('decodes scalars, lists and nullable structs to plain JSON without losing int64 precision', async () => {
    const timestamp = 1704067200000;
    const table = new Table({
      label: vectorFromArray(['north', null]),
      id: vectorFromArray([9007199254740993n, -2n], new Int64()),
      position: vectorFromArray(
        [
          [1, 2],
          [3, 4]
        ],
        new List(new Field('item', new Float64(), true))
      ),
      details: vectorFromArray(
        [{active: true, tags: ['x']}, null],
        new Struct([
          new Field('active', new Bool()),
          new Field('tags', new List(new Field('item', new Utf8())))
        ])
      ),
      samples: vectorFromArray(
        [[{score: 1}, {score: 2}], [{score: 3}]],
        new List(new Field('item', new Struct([new Field('score', new Float64())])))
      ),
      date: vectorFromArray([new Date(timestamp), null], new DateDay()),
      timestamp: vectorFromArray([timestamp, timestamp + 1], new TimestampMillisecond())
    });
    const bytes = tableToIPC(table.concat(table));
    const original = bytes.slice();
    const terminate = vi.spyOn(Worker.prototype, 'terminate');

    const rows = await decodePlaygroundArrow(bytes, new AbortController().signal);

    const expected = [
      {
        label: 'north',
        id: '9007199254740993',
        position: [1, 2],
        details: {active: true, tags: ['x']},
        samples: [{score: 1}, {score: 2}],
        date: timestamp,
        timestamp
      },
      {
        label: null,
        id: '-2',
        position: [3, 4],
        details: null,
        samples: [{score: 3}],
        date: null,
        timestamp: timestamp + 1
      }
    ];
    expect(rows).toEqual([...expected, ...expected]);
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
    expect(bytes).toEqual(original);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('rejects malformed IPC, excessive rows, dictionary expansion and lossy timestamps', async () => {
    const rowBatch = tableFromArrays({value: new Int32Array(6000)});
    const dictionaryBatch = tableFromArrays({label: Array(3000).fill('x'.repeat(200))});
    const invalidInputs = [
      new Uint8Array([1, 2, 3, 4]),
      tableToIPC(rowBatch.concat(rowBatch)),
      tableToIPC(dictionaryBatch.concat(dictionaryBatch)),
      tableToIPC(new Table({timestamp: vectorFromArray([1], new TimestampMicrosecond())}))
    ];
    const terminate = vi.spyOn(Worker.prototype, 'terminate');
    for (const bytes of invalidInputs) {
      expect(bytes.byteLength).toBeLessThan(1024 * 1024);
      await expect(decodePlaygroundArrow(bytes, new AbortController().signal)).rejects.toThrow(
        'Invalid or unsupported Arrow data'
      );
    }
    expect(terminate).toHaveBeenCalledTimes(invalidInputs.length);
  });

  it('terminates an in-flight worker on abort and rejects pre-aborted or oversized input', async () => {
    const terminate = vi.spyOn(Worker.prototype, 'terminate');
    const controller = new AbortController();
    const bytes = tableToIPC(tableFromArrays({value: [1]}));
    const pending = decodePlaygroundArrow(bytes, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('Arrow decoding canceled');
    await expect(decodePlaygroundArrow(bytes, controller.signal)).rejects.toThrow(
      'Arrow decoding canceled'
    );
    await expect(
      decodePlaygroundArrow(new Uint8Array(1024 * 1024 + 1), new AbortController().signal)
    ).rejects.toThrow('Invalid Arrow input size');
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('terminates a worker that does not answer within five seconds', async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      class {
        terminate = terminate;
        postMessage() {}
      }
    );
    const pending = decodePlaygroundArrow(new Uint8Array([1]), new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow('Arrow decoding timed out');
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(terminate).toHaveBeenCalledOnce();
  });
});
