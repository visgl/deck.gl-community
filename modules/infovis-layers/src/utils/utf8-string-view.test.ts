import * as arrow from 'apache-arrow';
import {describe, expect, it} from 'vitest';

import {
  arrowFindUtf8,
  getArrowUtf8ColumnSource,
  getArrowUtf8RowView,
  getUtf8ColumnSourceRowView,
  makeUtf8StringView
} from './utf8-string-view';

describe('utf8-string-view', () => {
  it('finds matching Utf8 rows without materializing a lookup map', () => {
    const column = arrow.vectorFromArray(['alpha', null, '6149800612493239450'], new arrow.Utf8());

    expect(arrowFindUtf8(column, makeUtf8StringView('alpha'))).toBe(0);
    expect(arrowFindUtf8(column, makeUtf8StringView('6149800612493239450'))).toBe(2);
    expect(arrowFindUtf8(column, makeUtf8StringView('alpha'), 1)).toBe(-1);
    expect(arrowFindUtf8(column, makeUtf8StringView('missing'))).toBe(-1);
  });

  it('finds exact UTF-8 strings in Arrow columns', () => {
    const column = buildArrowUtf8Vector([
      'span-a',
      '6149800612493239450',
      'span-b',
      '6149800612493239450'
    ]);
    const view = makeUtf8StringView('6149800612493239450');

    expect(arrowFindUtf8(column, view)).toBe(1);
    expect(arrowFindUtf8(column, view, 2)).toBe(3);
    expect(arrowFindUtf8(column, view, 4)).toBe(-1);
  });

  it('falls back safely for nullable Arrow string columns', () => {
    const column = arrow.vectorFromArray(['span-a', null, 'span-c'], new arrow.Utf8());

    expect(arrowFindUtf8(column, makeUtf8StringView('span-c'))).toBe(2);
    expect(arrowFindUtf8(column, makeUtf8StringView('missing'))).toBe(-1);
  });

  it('fills a reusable row view for direct Utf8 values', () => {
    const column = buildArrowUtf8Vector(['alpha', '', 'gamma']);
    const out = makeEmptyUtf8View();

    expect(getArrowUtf8RowView(column, 0, out)).toBe(true);
    expect(readUtf8ViewBytes(out)).toEqual([97, 108, 112, 104, 97]);
    expect(getArrowUtf8RowView(column, 1, out)).toBe(true);
    expect(readUtf8ViewBytes(out)).toEqual([]);
    expect(getArrowUtf8RowView(column, 3, out)).toBe(false);
  });

  it('fills a reusable row view for nullable Utf8 values', () => {
    const column = arrow.vectorFromArray(['span-a', null, 'span-c'], new arrow.Utf8());
    const out = makeEmptyUtf8View();

    expect(getArrowUtf8RowView(column, 1, out)).toBe(false);
    expect(getArrowUtf8RowView(column, 2, out)).toBe(true);
    expect(readUtf8ViewBytes(out)).toEqual([115, 112, 97, 110, 45, 99]);
  });

  it('fills a reusable row view for sliced Utf8 values', () => {
    const column = buildArrowUtf8Vector(['skip', 'first', 'second']).slice(
      1,
      3
    ) as arrow.Vector<arrow.Utf8>;
    const out = makeEmptyUtf8View();

    expect(getArrowUtf8RowView(column, 0, out)).toBe(true);
    expect(readUtf8ViewBytes(out)).toEqual([102, 105, 114, 115, 116]);
    expect(getArrowUtf8RowView(column, 1, out)).toBe(true);
    expect(readUtf8ViewBytes(out)).toEqual([115, 101, 99, 111, 110, 100]);
    expect(arrowFindUtf8(column, makeUtf8StringView('second'))).toBe(1);
  });

  it('fills normalized column source row views for sliced Utf8 values', () => {
    const column = buildArrowUtf8Vector(['skip', 'first', 'second']).slice(
      1,
      3
    ) as arrow.Vector<arrow.Utf8>;
    const source = getArrowUtf8ColumnSource(column);
    const out = makeEmptyUtf8View();

    expect(source).not.toBeNull();
    expect(getUtf8ColumnSourceRowView(source!, 0, out)).toBe(true);
    expect(readUtf8ViewBytes(out)).toEqual([102, 105, 114, 115, 116]);
    expect(getUtf8ColumnSourceRowView(source!, 1, out)).toBe(true);
    expect(readUtf8ViewBytes(out)).toEqual([115, 101, 99, 111, 110, 100]);
  });

  it('fills a reusable row view for chunked Utf8 values', () => {
    const leftTable = new arrow.Table({
      name: arrow.vectorFromArray(['left'], new arrow.Utf8())
    });
    const rightTable = new arrow.Table({
      name: arrow.vectorFromArray(['right', 'last'], new arrow.Utf8())
    });
    const column = leftTable.concat(rightTable).getChild('name') as arrow.Vector<arrow.Utf8>;
    const out = makeEmptyUtf8View();

    expect(getArrowUtf8RowView(column, 0, out)).toBe(true);
    expect(readUtf8ViewBytes(out)).toEqual([108, 101, 102, 116]);
    expect(getArrowUtf8RowView(column, 2, out)).toBe(true);
    expect(readUtf8ViewBytes(out)).toEqual([108, 97, 115, 116]);
  });
});

function makeEmptyUtf8View() {
  return {data: new Uint8Array(), start: 0, end: 0};
}

function readUtf8ViewBytes(view: ReturnType<typeof makeEmptyUtf8View>): number[] {
  return Array.from(view.data.subarray(view.start, view.end));
}

function buildArrowUtf8Vector(values: readonly string[]): arrow.Vector<arrow.Utf8> {
  return arrow.vectorFromArray(values, new arrow.Utf8()) as arrow.Vector<arrow.Utf8>;
}
