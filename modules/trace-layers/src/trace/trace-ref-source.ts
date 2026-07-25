/**
 * Minimal immutable row-ref sequence contract shared by dataset, graph, and prepared-scene paths.
 *
 * Arrays structurally satisfy this contract. Columnar sources can implement it from borrowed
 * Arrow columns or numeric descriptors without retaining one JavaScript value per canonical row.
 */
export type TraceRefSource<TRef> = {
  /** Number of refs represented by this sequence. */
  readonly length: number;
  /** Returns one ref by source row index without materializing the full sequence. */
  at(index: number): TRef | undefined;
  /** Iterates refs in source order. */
  [Symbol.iterator](): Iterator<TRef>;
};

/** Shared empty ref source used for missing or empty canonical process rows. */
export const EMPTY_TRACE_REF_SOURCE = Object.freeze({
  length: 0,
  at: (_index: number) => undefined,
  *[Symbol.iterator](): Iterator<never> {}
}) as TraceRefSource<never>;
