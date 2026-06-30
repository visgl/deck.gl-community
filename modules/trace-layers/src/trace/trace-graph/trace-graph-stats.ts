/** Calculated data from a trace graph. */
export type TraceGraphStats = {
  /** Number of processes represented in the graph. */
  processCount: number;
  /** Number of threads represented in the graph. */
  threadCount: number;
  /** Number of layout lanes represented in the graph. */
  laneCount: number;
  /** Number of spans represented in the graph. */
  spanCount: number;
  /** Number of process-local dependencies represented in the graph. */
  localDependencyCount: number;
  /** Number of spans that have not started. */
  notStartedSpanCount: number;
  /** Number of spans that have not finished. */
  unfinishedSpanCount: number;
  /** Number of spans dropped by ingestion. */
  droppedSpanCount: number;
  /** Total dependency count represented in the graph. */
  dependencyCount: number;
  /** Number of dependencies dropped by ingestion. */
  droppedDependencyCount: number;
  /** Number of cross-process dependencies represented in the graph. */
  crossDependencyCount: number;
  /** Number of cross-process dependencies dropped by ingestion. */
  droppedCrossDependencyCount: number;
};
