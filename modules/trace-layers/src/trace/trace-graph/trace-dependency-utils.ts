import type {
  TraceCrossProcessDependency,
  TraceDependency,
  TraceDependencyId,
  TraceLocalDependency
} from './trace-types';

type TraceDependencyProcess = {
  /** Optional legacy local dependency objects for ingestion/export compatibility. */
  localDependencies?: readonly TraceLocalDependency[];
};

// DEPENDENCIES

/** Builds a dependency lookup keyed by each dependency's start and end span ids. */
export function buildSpanDependencyMap(
  processes: Readonly<TraceDependencyProcess[]>,
  crossDependencies: Readonly<TraceCrossProcessDependency[]>
): Record<string, TraceDependency[]> {
  const map: Record<string, TraceDependency[]> = {};
  const appendDependency = (spanId: string, dependency: TraceDependency) => {
    const dependencies = map[spanId] ?? [];
    dependencies.push(dependency);
    map[spanId] = dependencies;
  };

  processes.forEach(process => {
    (process.localDependencies ?? []).forEach(dependency => {
      appendDependency(dependency.startSpanId, dependency);
      if (dependency.endSpanId !== dependency.startSpanId) {
        appendDependency(dependency.endSpanId, dependency);
      }
    });
  });
  crossDependencies.forEach(dependency => {
    appendDependency(dependency.startSpanId, dependency);
    if (dependency.endSpanId !== dependency.startSpanId) {
      appendDependency(dependency.endSpanId, dependency);
    }
  });

  return map;
}

/** Builds a graph-global dependency map keyed by stable dependency id. */
export function getGlobalDependencyMap(
  ranks: Readonly<TraceDependencyProcess[]>,
  crossDependencies: Readonly<TraceCrossProcessDependency[]>
) {
  const map = {} as Record<TraceDependencyId, TraceLocalDependency | TraceCrossProcessDependency>;
  ranks.forEach(rank => {
    (rank.localDependencies ?? []).forEach(dep => {
      map[dep.dependencyId] = dep;
    });
  });
  crossDependencies.forEach(dep => {
    map[dep.dependencyId] = dep;
  });
  return map;
}

/** Returns the wait duration attached to a local or cross-process dependency. */
export function getDependencyDurationMs(dep: Readonly<TraceDependency>): number {
  let durationMs = 0;
  if (dep.type === 'trace-local-dependency') {
    durationMs = dep.waitTimeMs;
  } else if (dep.type === 'trace-cross-process-dependency') {
    durationMs = dep.waitTimeMs;
  }
  return durationMs;
}
