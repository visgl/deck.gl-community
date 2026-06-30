import * as arrow from 'apache-arrow';

import {
  getIndexedAccessRow,
  getIndexedRelativeAccessRow,
  normalizeIndexedArrowIndexes
} from './indexed-arrow-helpers';

/**
 * Readonly indexed view over one Arrow child vector.
 */
export class IndexedArrowVector<T extends arrow.DataType> {
  /** Backing Arrow vector in raw row order. */
  readonly vector: arrow.Vector<T>;
  /** Raw row indexes exposed by this indexed view. */
  readonly indexes: Int32Array;

  /**
   * Builds one indexed Arrow child-vector view.
   */
  constructor(vector: arrow.Vector<T>, indexes: readonly number[] | Int32Array) {
    this.vector = vector;
    this.indexes = normalizeIndexedArrowIndexes(indexes, vector.length);
  }

  /**
   * Number of visible values exposed through this indexed vector.
   */
  get length(): number {
    return this.indexes.length;
  }

  /**
   * Resolves one value by view-local row index.
   */
  get(rowIndex: number): T['TValue'] | null {
    const rawIndex = getIndexedAccessRow(this.indexes, rowIndex);
    return rawIndex === null ? null : this.vector.get(rawIndex);
  }

  /**
   * Resolves one value by relative view-local row index.
   */
  at(rowIndex: number): T['TValue'] | null {
    const normalizedIndex = getIndexedRelativeAccessRow(this.length, rowIndex);
    return normalizedIndex === null ? null : this.get(normalizedIndex);
  }

  /**
   * Returns one sliced indexed view over the same backing Arrow vector.
   */
  slice(begin?: number, end?: number): IndexedArrowVector<T> {
    return new IndexedArrowVector(this.vector, this.indexes.slice(begin, end));
  }

  /**
   * Materializes the visible indexed values into a JavaScript array.
   */
  toArray(): Array<T['TValue'] | null> {
    return Array.from(this);
  }

  /**
   * Iterates over visible values in indexed row order.
   */
  *[Symbol.iterator](): IterableIterator<T['TValue'] | null> {
    for (let rowIndex = 0; rowIndex < this.length; rowIndex += 1) {
      yield this.get(rowIndex);
    }
  }
}
